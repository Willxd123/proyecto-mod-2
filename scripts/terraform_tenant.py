"""Motor principal (integrante 2): ejecuta Terraform u OpenTofu para el tfvars de un tenant.

El tfvars lo genera el backend (POST /api/tenants/<tenant_id>/tfvars) en
output/tenants/<tenant_id>/terraform.tfvars.json con tenant_id, tenant_name, plan_type, region,
los 3 AMI IDs y la capacidad del plan. Este script agrega los datos del operador (cuenta, IP SSH,
ruta de la clave), selecciona el workspace del tenant (terraform workspace select -or-create
<tenant_id>) y ejecuta el motor con listas de argumentos (sin shell). No recibe ni imprime
credenciales: usa el perfil AWS configurado en la máquina.

  python scripts/terraform_tenant.py plan    --tfvars output/tenants/<tenant>/terraform.tfvars.json --account-id 123456789012 --ssh-cidr 1.2.3.4/32
  python scripts/terraform_tenant.py apply   ... --yes
  python scripts/terraform_tenant.py output  --tfvars ...
  python scripts/terraform_tenant.py destroy ... --confirm <tenant>
"""
import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from render_cloud_init import render
from security_scan import FILES, infrastructure_snapshot, scan_handoff, update_digest

ROOT = Path(__file__).resolve().parent.parent
ROLES = ('frontend', 'backend', 'database')
PLANS = ('basico', 'estandar', 'avanzado')
ENGINES = {'terraform': 'terraform', 'opentofu': 'tofu'}
# Cada motor tiene su raíz (y su lockfile); ambas usan infrastructure/terraform/modules/tenant.
ENGINE_DIRS = {'terraform': ROOT / 'infrastructure' / 'terraform', 'opentofu': ROOT / 'infrastructure' / 'opentofu'}
SLUG = re.compile(r'[a-z][a-z0-9-]{2,39}')
AMI = re.compile(r'ami-[a-f0-9]{17}')


def load_tfvars(path):
    """Valida el tfvars del tenant antes de invocar el motor; el módulo repite estas comprobaciones."""
    path = Path(path).resolve()
    tfvars = json.loads(path.read_text(encoding='utf-8'))
    if tfvars.get('engine', 'terraform') not in ENGINES:
        raise ValueError('Este motor solo atiende engine terraform u opentofu; Pulumi/CloudFormation son del integrante 3.')
    if not SLUG.fullmatch(str(tfvars.get('tenant_id', ''))):
        raise ValueError('tenant_id inválido.')
    if not str(tfvars.get('tenant_name', '')).strip():
        raise ValueError('tenant_name es obligatorio.')
    if tfvars.get('plan_type') not in PLANS:
        raise ValueError('plan_type debe ser basico, estandar o avanzado.')
    if not re.fullmatch(r'[a-z]{2}(-[a-z]+)+-\d', str(tfvars.get('region', ''))):
        raise ValueError('Región inválida.')
    for role in ROLES:
        if not AMI.fullmatch(str(tfvars.get(f'{role}_ami_id', ''))):
            raise ValueError(f'Falta la Golden AMI del rol {role} ({role}_ami_id).')
        capacity = (tfvars.get('plan_capacity') or {}).get(role) or {}
        if not isinstance(capacity.get('disk_gib'), int) or capacity['disk_gib'] < 12 or not capacity.get('instance_type'):
            raise ValueError(f'plan_capacity.{role} inválido (instance_type y disk_gib >= 12).')
    if any(key in tfvars for key in ('expected_account_id', 'ssh_private_key_path', 'ssh_ingress_cidrs')):
        raise ValueError('El tfvars del tenant no debe traer datos del operador; se agregan al ejecutar.')
    return path, tfvars


def ssh_cidr(value):
    """Solo IPs públicas concretas (/32): el bastión nunca queda abierto a internet."""
    network = ipaddress.ip_network(value, strict=True)
    if network.version != 4 or network.prefixlen != 32 or not network.is_global:
        raise ValueError(f'CIDR SSH no permitido: {value}. Use su IP pública con /32.')
    return str(network)


def account_id(value):
    if not re.fullmatch(r'\d{12}', value or ''):
        raise ValueError('Indique la cuenta AWS esperada (12 dígitos) con --account-id o AWS_EXPECTED_ACCOUNT_ID.')
    return value


def verify_handoff(tfvars, handoff_root=None):
    """Comprueba que el tfvars corresponda al mismo handoff desplegable que se escaneó."""
    allowed = {'tenant_id', 'tenant_name', 'plan_type', 'region', 'frontend_ami_id', 'backend_ami_id',
               'database_ami_id', 'plan_capacity', 'engine', 'request_id', 'key_pair_name'}
    if set(tfvars) != allowed or set(tfvars['plan_capacity']) != set(ROLES):
        raise ValueError('El tfvars incluye parámetros ajenos al contrato autorizado.')
    if any(set(tfvars['plan_capacity'][role]) != {'instance_type', 'disk_gib'} for role in ROLES):
        raise ValueError('La capacidad del tfvars no coincide con el contrato autorizado.')
    root = Path(handoff_root or ROOT / 'output' / 'handoff').resolve(strict=True)
    tenant = tfvars['tenant_id']
    directory = root / tenant
    if directory.is_symlink() or not directory.is_dir() or directory.resolve().parent != root:
        raise ValueError('No existe un handoff válido para el tenant.')
    content = {}
    digest = hashlib.sha256()
    for name in FILES:
        path = directory / name
        if path.is_symlink() or not path.is_file() or path.resolve().parent != directory:
            raise ValueError('El handoff está incompleto.')
        data = path.read_bytes()
        if len(data) > 1024 * 1024:
            raise ValueError('Archivo de handoff demasiado grande.')
        content[name] = data
        update_digest(digest, name, data)
    request = json.loads(content['request.json'])
    if not isinstance(request, dict) or request.get('schema_version') != 1 or request.get('provider') != 'aws':
        raise ValueError('Solicitud de despliegue inválida.')
    if request.get('deployable') is not True:
        raise ValueError('Una solicitud no desplegable no puede aprovisionarse.')
    expected = {
        'tenant_slug': tenant, 'institution_name': tfvars['tenant_name'], 'region': tfvars['region'],
        'engine': tfvars.get('engine', 'terraform'), 'request_id': tfvars.get('request_id'),
        'key_pair_name': tfvars.get('key_pair_name'),
    }
    if any(not value or request.get(field) != value for field, value in expected.items()):
        raise ValueError('La solicitud y el tfvars no corresponden al mismo despliegue.')
    plan = request.get('plan_snapshot')
    images = request.get('images')
    if not isinstance(plan, dict) or plan.get('slug') != tfvars['plan_type'] or not isinstance(plan.get('roles'), dict) or not isinstance(images, dict):
        raise ValueError('La solicitud no contiene el plan o las imágenes esperados.')
    if request.get('user_data') != {role: f'{role}.yaml' for role in ROLES}:
        raise ValueError('Las referencias cloud-init no coinciden.')
    for role in ROLES:
        capacity = plan['roles'].get(role)
        image = images.get(role)
        if (not isinstance(capacity, dict) or not isinstance(image, dict)
                or capacity.get('instance_type') != tfvars['plan_capacity'][role]['instance_type']
                or capacity.get('disk_gib') != tfvars['plan_capacity'][role]['disk_gib']
                or image.get('role') != role or image.get('provider') != 'aws'
                or image.get('region') != tfvars['region'] or image.get('ami_id') != tfvars[f'{role}_ami_id']):
            raise ValueError(f'La capacidad o AMI de {role} no coincide con la solicitud.')
        if content[f'{role}.yaml'].decode('utf-8').replace('\r\n', '\n') != render(tenant, role):
            raise ValueError(f'El cloud-init de {role} no coincide con la plantilla aprobada.')
    for name, data in infrastructure_snapshot(tfvars.get('engine', 'terraform')).items():
        update_digest(digest, name, data)
    result = scan_handoff(tenant, root=root)
    if result['status'] != 'clean' or result['content_sha256'] != digest.hexdigest():
        raise ValueError('El escaneo bloqueó la solicitud o su contenido cambió durante la comprobación.')
    return result['content_sha256']


def verify_implicit_inputs(root, env):
    if any(key.startswith(('TF_VAR_', 'TF_CLI_ARGS')) or key == 'TF_WORKSPACE' for key in env):
        raise ValueError('Retire TF_VAR_*, TF_CLI_ARGS* y TF_WORKSPACE antes del despliegue verificado.')
    names = ('terraform.tfvars', 'terraform.tfvars.json', '*.auto.tfvars', '*.auto.tfvars.json')
    if any(any(root.glob(pattern)) for pattern in names):
        raise ValueError('La raíz del motor contiene tfvars implícitos no autorizados.')


def paths(tfvars):
    """Workspace (estado) y datos de trabajo separados por motor y tenant (ignorados por Git)."""
    root = ENGINE_DIRS[tfvars.get('engine', 'terraform')]
    slug = tfvars['tenant_id']
    return {
        'root': root,
        'workspace': slug,
        'state': root / 'terraform.tfstate.d' / slug / 'terraform.tfstate',
        'work': root / '.work' / slug,
        'plugins': root / '.work' / 'plugin-cache',
        'inventories': ROOT / 'inventories',
    }


def operator_tfvars(tfvars, args):
    """Parámetros del operador: no secretos (la clave privada va solo como ruta)."""
    location = paths(tfvars)
    result = {
        'expected_account_id': account_id(args.account_id),
        'member_id': args.member_id,
        'ssh_ingress_cidrs': [ssh_cidr(c) for c in args.ssh_cidr],
        'monitoring_cidrs': list(args.monitoring_cidr),
        'enable_nat_gateway': bool(args.enable_nat),
        'inventory_dir': location['inventories'].as_posix(),
        'ssh_private_key_path': args.ssh_private_key_path or '',
        'state_reference': {'backend': 'local-workspace', 'key_or_stack': location['state'].relative_to(ROOT).as_posix()},
    }
    if args.enable_frontend_https:
        result['enable_frontend_https'] = True
    return result


def commands(binary, action, location, var_files, auto_approve):
    init = [binary, 'init', '-input=false']
    workspace = [binary, 'workspace', 'select', '-or-create=true', location['workspace']]
    common = ['-input=false', *[f'-var-file={f.as_posix()}' for f in var_files]]
    approve = ['-auto-approve'] if auto_approve else []
    final = {
        'plan': [binary, 'plan', *common, f'-out={(location["work"] / "tfplan").as_posix()}'],
        'apply': [binary, 'apply', *common, *approve],
        'destroy': [binary, 'destroy', *common, *approve],
        'output': [binary, 'output', '-json', 'provisioning_result'],
    }
    if action not in final:
        raise ValueError(action)
    return [init, workspace, final[action]]


def run(cmd, cwd, env, capture=False):
    result = subprocess.run(cmd, cwd=cwd, env=env, check=False, text=True,
                            stdout=subprocess.PIPE if capture else None)
    if result.returncode != 0:
        raise RuntimeError(f'{Path(cmd[0]).name} {cmd[1]} terminó con código {result.returncode}.')
    return result.stdout


def initialize_local_backend_metadata(binary, location, env):
    metadata = location['work'] / 'terraform.tfstate'
    if metadata.exists():
        return
    with tempfile.TemporaryDirectory(prefix='tenant-local-backend-') as tmp:
        root = Path(tmp)
        (root / 'main.tf').write_text('terraform {\n  backend "local" {}\n}\n', encoding='utf-8')
        bootstrap_env = dict(env, TF_DATA_DIR=str(root / 'data'))
        run([binary, 'init', '-input=false'], root, bootstrap_env)
        source = root / 'data' / 'terraform.tfstate'
        with source.open('rb') as src, metadata.open('xb') as dst:
            shutil.copyfileobj(src, dst)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('action', choices=['plan', 'apply', 'output', 'destroy'])
    parser.add_argument('--tfvars', required=True, type=Path, help='terraform.tfvars.json generado por el backend')
    parser.add_argument('--account-id', default=os.environ.get('AWS_EXPECTED_ACCOUNT_ID', ''))
    parser.add_argument('--ssh-cidr', action='append', default=[], help='IP pública del operador con /32; repetible.')
    parser.add_argument('--monitoring-cidr', action='append', default=[], help='CIDR del recolector Prometheus; repetible.')
    parser.add_argument('--ssh-private-key-path', default=os.environ.get('SSH_PRIVATE_KEY_PATH', ''), help='Solo la ruta local para el inventario.')
    parser.add_argument('--member-id', default=os.environ.get('MEMBER_ID', 'integrante-2'))
    parser.add_argument('--enable-nat', action='store_true', help='NAT Gateway para la subred privada (factura por hora).')
    parser.add_argument('--enable-frontend-https', action='store_true', help='Abrir HTTPS del frontend; repetir en cada plan/apply o conservarlo en el tfvars del tenant.')
    parser.add_argument('--binary', help='Ruta a terraform/tofu si no está en el PATH.')
    parser.add_argument('--verify-handoff', action='store_true', help='Exigir solicitud desplegable coincidente y escaneo limpio (plan/apply).')
    parser.add_argument('--yes', action='store_true', help='apply sin confirmación interactiva (para el orquestador).')
    parser.add_argument('--confirm', default='', help='destroy: repetir el tenant_id para confirmar.')
    args = parser.parse_args(argv)

    try:
        tfvars_path, tfvars = load_tfvars(args.tfvars)
        if args.verify_handoff and args.action not in ('plan', 'apply'):
            raise ValueError('--verify-handoff solo admite plan o apply.')
        scanned = verify_handoff(tfvars) if args.verify_handoff else None
        engine = tfvars.get('engine', 'terraform')
        if args.action == 'destroy' and args.confirm != tfvars['tenant_id']:
            raise ValueError(f'Para eliminar, confirme con --confirm {tfvars["tenant_id"]}.')
        binary = args.binary or shutil.which(ENGINES[engine])
        if not binary:
            raise ValueError(f'No se encontró {ENGINES[engine]} en el PATH.')
        location = paths(tfvars)
        if scanned is not None:
            verify_implicit_inputs(location['root'], os.environ)
        for key in ('work', 'plugins'):
            location[key].mkdir(parents=True, exist_ok=True)
        env = dict(os.environ, TF_DATA_DIR=str(location['work']), TF_PLUGIN_CACHE_DIR=str(location['plugins']), TF_IN_AUTOMATION='1')
        operator_file = location['work'] / 'operator.tfvars.json'
        if args.action != 'output':
            if not args.ssh_cidr:
                raise ValueError('Indique al menos un --ssh-cidr con su IP pública /32.')
            operator_file.write_text(json.dumps(operator_tfvars(tfvars, args), indent=2) + '\n', encoding='utf-8')

        initialize_local_backend_metadata(binary, location, env)
        steps = commands(binary, args.action, location, [tfvars_path, operator_file], args.yes or args.action == 'destroy')
        cwd = location['root']
        for cmd in steps[:-1]:
            run(cmd, cwd, env)
        if scanned is not None:
            _, current = load_tfvars(tfvars_path)
            verify_implicit_inputs(location['root'], os.environ)
            if current != tfvars or verify_handoff(current) != scanned:
                raise ValueError('El tfvars, handoff o infraestructura cambió después del escaneo inicial.')
        if args.action in ('apply', 'output'):
            if args.action == 'apply':
                run(steps[-1], cwd, env)
            result = run(commands(binary, 'output', location, [], False)[-1], cwd, env, capture=True)
            target = tfvars_path.parent / 'provisioning-result.json'
            target.write_text(json.dumps(json.loads(result), indent=2) + '\n', encoding='utf-8')
            print(f'ProvisioningResult escrito en {target}')
        else:
            run(steps[-1], cwd, env)
    except (ValueError, RuntimeError, OSError, json.JSONDecodeError) as error:
        print(f'Error: {error}', file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
