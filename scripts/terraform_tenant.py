"""Motor principal (integrante 2): ejecuta Terraform u OpenTofu para un DeploymentRequest.

Cada tenant y motor tiene su propio estado y directorio de trabajo, por lo que dos tenants
nunca comparten estado. Los comandos se invocan con listas de argumentos (sin shell) y el
script no recibe ni imprime credenciales: usa el perfil AWS configurado en la máquina.

  python scripts/terraform_tenant.py plan    --request output/handoff/<tenant>/request.json --account-id 123456789012 --ssh-cidr 1.2.3.4/32
  python scripts/terraform_tenant.py apply   ... --yes
  python scripts/terraform_tenant.py output  --request ...
  python scripts/terraform_tenant.py destroy ... --confirm <tenant>
"""
import argparse
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
ROLES = ('frontend', 'backend', 'database')
ENGINES = {'terraform': 'terraform', 'opentofu': 'tofu'}
# Cada motor tiene su raíz (y su lockfile); ambas usan infrastructure/terraform/modules/tenant.
ENGINE_DIRS = {'terraform': ROOT / 'infrastructure' / 'terraform', 'opentofu': ROOT / 'infrastructure' / 'opentofu'}
SLUG = re.compile(r'[a-z][a-z0-9-]{2,39}')


def load_request(path):
    """Valida el contrato antes de invocar el motor; el módulo repite estas comprobaciones."""
    path = Path(path).resolve()
    request = json.loads(path.read_text(encoding='utf-8'))
    if request.get('schema_version') != 1 or request.get('provider') != 'aws':
        raise ValueError('Se esperaba un DeploymentRequest con schema_version=1 y provider=aws.')
    if request.get('deployable') is not True:
        raise ValueError('La solicitud tiene deployable=false: es un borrador y no puede aprovisionarse.')
    if request.get('engine') not in ENGINES:
        raise ValueError('Este motor solo atiende engine terraform u opentofu; Pulumi/CloudFormation son del integrante 3.')
    if not SLUG.fullmatch(str(request.get('tenant_slug', ''))):
        raise ValueError('tenant_slug inválido.')
    images = request.get('images') or {}
    for role in ROLES:
        image = images.get(role) or {}
        if image.get('region') != request.get('region') or not re.fullmatch(r'ami-[a-f0-9]{17}', str(image.get('ami_id', ''))):
            raise ValueError(f'Falta la Golden AMI del rol {role} en la región {request.get("region")}.')
        user_data = path.parent / Path(str((request.get('user_data') or {}).get(role, ''))).name
        if not user_data.is_file():
            raise ValueError(f'No se encontró el user-data de {role} junto a request.json.')
    return path, request


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


def paths(request):
    """Estado y datos de trabajo separados por motor y tenant (ignorados por Git)."""
    root = ENGINE_DIRS[request['engine']]
    slug = request['tenant_slug']
    return {
        'root': root,
        'state': root / 'state' / slug / 'terraform.tfstate',
        'work': root / '.work' / slug,
        'plugins': root / '.work' / 'plugin-cache',
        'inventories': ROOT / 'inventories',
    }


def build_tfvars(request_path, request, args):
    """Genera el tfvars del tenant: solo parámetros no secretos (la clave privada va como ruta)."""
    location = paths(request)
    return {
        'request_file': request_path.as_posix(),
        'expected_account_id': account_id(args.account_id),
        'member_id': args.member_id,
        'ssh_ingress_cidrs': [ssh_cidr(c) for c in args.ssh_cidr],
        'monitoring_cidrs': list(args.monitoring_cidr),
        'enable_nat_gateway': bool(args.enable_nat),
        'inventory_dir': location['inventories'].as_posix(),
        'ssh_private_key_path': args.ssh_private_key_path or '',
        'state_reference': {'backend': 'local', 'key_or_stack': location['state'].relative_to(ROOT).as_posix()},
    }


def commands(binary, action, location, var_file, auto_approve):
    init = [binary, 'init', '-input=false', '-reconfigure', f'-backend-config=path={location["state"].as_posix()}']
    common = ['-input=false', f'-var-file={var_file.as_posix()}']
    if action == 'plan':
        return [init, [binary, 'plan', *common, f'-out={(location["work"] / "tfplan").as_posix()}']]
    if action == 'apply':
        return [init, [binary, 'apply', *common, *(['-auto-approve'] if auto_approve else [])]]
    if action == 'destroy':
        return [init, [binary, 'destroy', *common, *(['-auto-approve'] if auto_approve else [])]]
    if action == 'output':
        return [init, [binary, 'output', '-json', 'provisioning_result']]
    raise ValueError(action)


def run(cmd, cwd, env, capture=False):
    result = subprocess.run(cmd, cwd=cwd, env=env, check=False, text=True,
                            stdout=subprocess.PIPE if capture else None)
    if result.returncode != 0:
        raise RuntimeError(f'{Path(cmd[0]).name} {cmd[1]} terminó con código {result.returncode}.')
    return result.stdout


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('action', choices=['plan', 'apply', 'output', 'destroy'])
    parser.add_argument('--request', required=True, type=Path, help='request.json generado por prepare_handoff.py')
    parser.add_argument('--account-id', default=os.environ.get('AWS_EXPECTED_ACCOUNT_ID', ''))
    parser.add_argument('--ssh-cidr', action='append', default=[], help='IP pública del operador con /32; repetible.')
    parser.add_argument('--monitoring-cidr', action='append', default=[], help='CIDR del recolector Prometheus; repetible.')
    parser.add_argument('--ssh-private-key-path', default=os.environ.get('SSH_PRIVATE_KEY_PATH', ''), help='Solo la ruta local para el inventario.')
    parser.add_argument('--member-id', default=os.environ.get('MEMBER_ID', 'integrante-2'))
    parser.add_argument('--enable-nat', action='store_true', help='NAT Gateway para la subred privada (factura por hora).')
    parser.add_argument('--binary', help='Ruta a terraform/tofu si no está en el PATH.')
    parser.add_argument('--yes', action='store_true', help='apply sin confirmación interactiva (para el orquestador).')
    parser.add_argument('--confirm', default='', help='destroy: repetir el tenant_slug para confirmar.')
    args = parser.parse_args(argv)

    try:
        request_path, request = load_request(args.request)
        if args.action == 'destroy' and args.confirm != request['tenant_slug']:
            raise ValueError(f'Para eliminar, confirme con --confirm {request["tenant_slug"]}.')
        binary = args.binary or shutil.which(ENGINES[request['engine']])
        if not binary:
            raise ValueError(f'No se encontró {ENGINES[request["engine"]]} en el PATH.')
        location = paths(request)
        for key in ('work', 'plugins'):
            location[key].mkdir(parents=True, exist_ok=True)
        location['state'].parent.mkdir(parents=True, exist_ok=True)
        env = dict(os.environ, TF_DATA_DIR=str(location['work']), TF_PLUGIN_CACHE_DIR=str(location['plugins']), TF_IN_AUTOMATION='1')

        var_file = location['work'] / 'tenant.tfvars.json'
        if args.action != 'output':
            if not args.ssh_cidr:
                raise ValueError('Indique al menos un --ssh-cidr con su IP pública /32.')
            var_file.write_text(json.dumps(build_tfvars(request_path, request, args), indent=2) + '\n', encoding='utf-8')

        steps = commands(binary, args.action, location, var_file, args.yes or args.action == 'destroy')
        cwd = location['root']
        for cmd in steps[:-1]:
            run(cmd, cwd, env)
        if args.action == 'output' or args.action == 'apply':
            if args.action == 'apply':
                run(steps[-1], cwd, env)
            result = run(commands(binary, 'output', location, var_file, False)[-1], cwd, env, capture=True)
            target = request_path.parent / 'provisioning-result.json'
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
