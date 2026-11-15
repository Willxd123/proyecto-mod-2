"""Motor Pulumi independiente para solicitudes de handoff locales (RF-08).

Uso desde la raíz del monorepo (nada se ejecuta sin acción explícita):
  python scripts/pulumi_tenant.py validate --tenant <id> --account-id <12 dígitos> --ssh-cidr <IP/32>
  python scripts/pulumi_tenant.py create   --tenant <id> --account-id ... --ssh-cidr ... [--enable-https]
  python scripts/pulumi_tenant.py destroy  --tenant <id> --account-id ... --confirm <id>

`validate` solo hace una vista previa: no crea recursos. El estado de cada tenant vive en un stack propio
(`tenant-control-center/<tenant>`) dentro de un backend de archivos local, `output/pulumi-state`, que Git ignora.
El estado no contiene secretos del tenant ni credenciales AWS.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

from cloudformation_tenant import HANDOFF, ROLES, aws, check_account, inventory, load_handoff, preflight, ssh_cidr
from security_scan import ROOT, scan_handoff

PROGRAM = ROOT / 'infrastructure' / 'pulumi'
STATE = ROOT / 'output' / 'pulumi-state'
PROJECT = 'tenant-control-center'
# El worker de demostración lo define para mostrar en vivo los recursos que Pulumi crea o elimina.
LINE_SINK = None


def pulumi_binary():
    """Ruta del CLI de Pulumi: el PATH o la carpeta por defecto del instalador."""
    found = shutil.which('pulumi')
    if found:
        return found
    candidate = Path.home() / '.pulumi' / 'bin' / ('pulumi.exe' if os.name == 'nt' else 'pulumi')
    return str(candidate) if candidate.is_file() else None


def python_command():
    """Intérprete con pulumi y pulumi-aws: PULUMI_PYTHON o el entorno virtual infrastructure/pulumi/.venv."""
    configured = os.environ.get('PULUMI_PYTHON', '')
    if configured:
        return configured if Path(configured).is_file() else None
    for relative in ('.venv/Scripts/python.exe', '.venv/bin/python'):
        if (PROGRAM / relative).is_file():
            return str(PROGRAM / relative)
    return None


def ready():
    """True si existen el CLI y un intérprete con las bibliotecas necesarias (comprobación local, sin red)."""
    binary, python = pulumi_binary(), python_command()
    if not binary or not python:
        return False
    try:
        done = subprocess.run([python, '-c', 'import pulumi, pulumi_aws'], capture_output=True, timeout=60, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return False
    return done.returncode == 0


def engine_environment(request, **extra):
    """Entorno del CLI: backend local, sin credenciales en el estado y solo las entradas del tenant."""
    python = python_command()
    return dict(os.environ, PULUMI_BACKEND_URL='file://' + STATE.as_posix(), PULUMI_CONFIG_PASSPHRASE='',
                PULUMI_SKIP_UPDATE_CHECK='true', PULUMI_PYTHON_CMD=python or '', AWS_REGION=request['region'],
                AWS_DEFAULT_REGION=request['region'], TCC_TENANT_SLUG=request['tenant_slug'], **extra)


def pulumi(arguments, env, capture=True, timeout=3600):
    binary = pulumi_binary()
    if not binary:
        raise ValueError('No se encontró el CLI de Pulumi en el PATH ni en ~/.pulumi/bin.')
    if LINE_SINK and arguments[0] in ('up', 'destroy'):
        import live_log
        try:
            code = live_log.stream([binary, *arguments, '--non-interactive'], live_log.PulumiProgress(LINE_SINK), cwd=PROGRAM, env=env, timeout=timeout)
        except OSError as error:
            raise RuntimeError('No se pudo ejecutar Pulumi.') from error
        if code:
            raise RuntimeError(f'Pulumi {arguments[0]} falló (código {code}); revise el estado privado del tenant.')
        return ''
    try:
        done = subprocess.run([binary, *arguments, '--non-interactive'], cwd=PROGRAM, env=env, text=True,
                              capture_output=capture, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise RuntimeError('No se pudo ejecutar Pulumi.') from error
    if done.returncode:
        raise RuntimeError(f'Pulumi {arguments[0]} falló (código {done.returncode}); revise el estado privado del tenant.')
    return done.stdout if capture else ''


def ensure_stack(slug, env):
    STATE.mkdir(parents=True, exist_ok=True)
    pulumi(['login', 'file://' + STATE.as_posix()], env)
    pulumi(['stack', 'select', '--create', slug, '--secrets-provider', 'passphrase'], env)


def program_environment(request, tenant, cidr, zone, https):
    return engine_environment(request, TCC_HANDOFF_DIR=str(HANDOFF / tenant), TCC_SSH_CIDR=cidr, TCC_AVAILABILITY_ZONE=zone,
                              TCC_ENABLE_HTTPS='true' if https else 'false', TCC_BACKEND_PORT='8000')


def owner_path(tenant):
    directory = HANDOFF / tenant / 'pulumi'
    if directory.is_symlink() or (directory.exists() and not directory.is_dir()):
        raise ValueError('Directorio de salida no válido.')
    return directory / 'owner.json'


def read_owner(request, account):
    path = owner_path(request['tenant_slug'])
    if path.is_symlink() or not path.is_file():
        raise ValueError('Falta el registro local de propiedad del stack; no se operará por nombre.')
    owner = json.loads(path.read_text(encoding='utf-8'))
    if (not isinstance(owner, dict) or owner.get('account_id') != account or owner.get('request_id') != request['request_id']
            or owner.get('stack') != request['tenant_slug']):
        raise ValueError('El registro de propiedad no coincide con la cuenta o la solicitud.')
    return owner['stack']


def build_result(request, outputs):
    """Arma el ProvisioningResult con los datos reales de AWS y verifica identidad, red y etiquetas de las tres instancias."""
    ids = {role: outputs[f'{role}_id'] for role in ROLES}
    if len(set(ids.values())) != 3:
        raise ValueError('Los roles no corresponden a tres instancias distintas.')
    response = aws(request['region'], 'ec2', 'describe-instances', '--instance-ids', *ids.values())
    found = {item['InstanceId']: item for reservation in response.get('Reservations', []) for item in reservation.get('Instances', [])}
    if set(found) != set(ids.values()):
        raise ValueError('No se pudieron verificar las tres instancias.')
    nodes = {}
    for role in ROLES:
        instance = found[ids[role]]
        tags = {tag['Key']: tag['Value'] for tag in instance.get('Tags', [])}
        subnet = outputs['public_subnet_id'] if role == 'frontend' else outputs['private_subnet_id']
        expected = {'Project': 'proyecto-modulo-2', 'TenantId': request['tenant_slug'], 'RunId': request['request_id'], 'Role': role}
        if (instance.get('State', {}).get('Name') != 'running' or instance.get('VpcId') != outputs['vpc_id']
                or instance.get('SubnetId') != subnet or instance.get('ImageId') != request['images'][role]['ami_id']
                or any(tags.get(key) != value for key, value in expected.items())):
            raise ValueError(f'La identidad, red, AMI o etiquetas de {role} no coinciden.')
        nodes[role] = {'instance_id': ids[role], 'image_id': instance['ImageId'], 'private_ip': instance['PrivateIpAddress'],
                       'public_ip': instance.get('PublicIpAddress') if role == 'frontend' else None}
    if not nodes['frontend']['public_ip']:
        raise ValueError('El frontend no tiene IP pública.')
    return {'schema_version': 1, 'request_id': request['request_id'], 'tenant_slug': request['tenant_slug'], 'engine': 'pulumi',
            'region': request['region'], 'nodes': nodes,
            'network': {'vpc_id': outputs['vpc_id'], 'subnet_ids': [outputs['public_subnet_id'], outputs['private_subnet_id']],
                        'security_group_ids': [outputs[f'{role}_security_group_id'] for role in ROLES]},
            'state_reference': {'backend': 'pulumi-local', 'key_or_stack': f"{PROJECT}/{request['tenant_slug']}"}}


def write_outputs(request, result, key_path):
    directory = owner_path(request['tenant_slug']).parent
    directory.mkdir(parents=True, exist_ok=True)
    for name, value in {'provisioning-result.json': result, 'hosts.yml': inventory(request, result, key_path)}.items():
        temporary = directory / (name + '.tmp')
        temporary.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')
        os.replace(temporary, directory / name)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('action', choices=['validate', 'create', 'output', 'destroy'])
    parser.add_argument('--tenant', required=True)
    parser.add_argument('--account-id', required=True)
    parser.add_argument('--ssh-cidr')
    parser.add_argument('--ssh-private-key-path', default='')
    parser.add_argument('--enable-https', action='store_true')
    parser.add_argument('--confirm', default='')
    args = parser.parse_args(argv)
    try:
        if '\n' in args.ssh_private_key_path or '\r' in args.ssh_private_key_path:
            raise ValueError('Ruta SSH inválida.')
        request, _, digest, _, _ = load_handoff(args.tenant, 'pulumi')
        slug = args.tenant
        if args.action in ('validate', 'create'):
            if not args.ssh_cidr:
                raise ValueError('Indique --ssh-cidr con la IP pública del operador.')
            cidr = ssh_cidr(args.ssh_cidr)
            scan = scan_handoff(slug)
            if scan['status'] != 'clean' or scan['content_sha256'] != digest:
                raise ValueError('El escaneo bloqueó el paquete o cambió durante la comprobación.')
            zone = preflight(request, args.account_id)
            env = program_environment(request, slug, cidr, zone, args.enable_https)
            if not python_command():
                raise ValueError('Falta el intérprete con pulumi y pulumi-aws: cree infrastructure/pulumi/.venv o defina PULUMI_PYTHON.')
            ensure_stack(slug, env)
            if args.action == 'validate':
                try:
                    pulumi(['preview', '--stack', slug, '--suppress-outputs'], env)
                finally:
                    pulumi(['stack', 'rm', '--yes', '--force', slug], env)
                print('Vista previa y preflight de solo lectura completados; no se crearon recursos.')
                return 0
            check_account(request['region'], args.account_id)
            path = owner_path(slug)
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open('x', encoding='utf-8') as owner:
                json.dump({'account_id': args.account_id, 'request_id': request['request_id'], 'stack': slug}, owner)
            print('Stack solicitado; Pulumi está creando la infraestructura.')
            pulumi(['up', '--stack', slug, '--yes', '--skip-preview'], env)
        else:
            check_account(request['region'], args.account_id)
            read_owner(request, args.account_id)
            env = engine_environment(request)
            pulumi(['login', 'file://' + STATE.as_posix()], env)
        if args.action == 'destroy':
            if args.confirm != slug:
                raise ValueError('Repita el tenant con --confirm para eliminar el stack.')
            pulumi(['destroy', '--stack', slug, '--yes', '--skip-preview'], env)
            pulumi(['stack', 'rm', '--yes', slug], env)
            print('Stack del tenant eliminado.')
            return 0
        outputs = json.loads(pulumi(['stack', 'output', '--json', '--stack', slug], env) or '{}')
        result = build_result(request, outputs)
        write_outputs(request, result, args.ssh_private_key_path)
        print('ProvisioningResult e inventario privado generados para Ansible.')
        return 0
    except (ValueError, RuntimeError, OSError, KeyError) as error:
        print(f'Error: {error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
