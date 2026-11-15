"""Flujo local de demostración: AWS IaC → Ansible → verificación de login."""
import contextlib
import hashlib
import io
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import threading
import time

import live_log
from cloudformation_tenant import HANDOFF, ROLES, main as cloudformation_main
from prepare_handoff import prepare
from render_cloud_init import render
import security_scan
import pulumi_tenant
import terraform_tenant

ROOT = Path(__file__).resolve().parent.parent
DEMO_OUTPUT = ROOT / 'output' / 'demo'
ENGINES = {'terraform', 'opentofu', 'pulumi', 'cloudformation'}
SLUG = re.compile(r'[a-z][a-z0-9-]{2,39}\Z')
ACCOUNT = re.compile(r'\d{12}\Z')
KEY_NAME = re.compile(r'[A-Za-z0-9._-]{1,255}\Z')


class DemoError(Exception):
    pass


_STDOUT = sys.stdout
_EMIT_LOCK = threading.Lock()


def emit(stage, message, status='running'):
    """Un evento por línea hacia el panel. Usa el stdout original (los motores lo redirigen) y es seguro entre hilos."""
    with _EMIT_LOCK:
        _STDOUT.write(json.dumps({'stage': stage, 'message': message, 'status': status}) + '\n')
        _STDOUT.flush()


def run_silent(arguments, timeout=60, input_data=None):
    try:
        result = subprocess.run(arguments, input=input_data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise DemoError('No se pudo completar una comprobación requerida.') from error
    if result.returncode:
        raise DemoError('Falló una comprobación requerida; revise la configuración local y el estado del tenant.')
    return result.stdout


def wsl_distro_args():
    """WSL_DISTRO fija la distribución de WSL cuando la predeterminada no es Ubuntu (por ejemplo docker-desktop)."""
    distro = os.environ.get('WSL_DISTRO', '')
    return ['-d', distro] if re.fullmatch(r'[A-Za-z0-9._-]{1,60}', distro) else []


def wsl(arguments, timeout=120, input_data=None):
    return run_silent(['wsl.exe', *wsl_distro_args(), *arguments], timeout, input_data)


def wsl_path(path):
    return wsl(['--exec', 'wslpath', '-a', str(path)]).decode().strip()


def configured():
    settings = {
        'account_id': os.environ.get('AWS_EXPECTED_ACCOUNT_ID', ''),
        'ssh_cidr': os.environ.get('DEMO_SSH_CIDR', ''),
        'key_name': os.environ.get('SSH_KEY_PAIR_NAME', 'practico7-asistencia'),
        'private_key_wsl': os.environ.get('DEMO_SSH_PRIVATE_KEY_WSL_PATH', ''),
        'admin_name': os.environ.get('DEMO_ADMIN_NAME', 'Administrador de la institucion'),
        'certbot_email': os.environ.get('DEMO_CERTBOT_EMAIL', ''),
        'psycopg_deb_wsl': os.environ.get('DEMO_POSTGRESQL_PSYCOPG_DEB', ''),
        'artifact_release': os.environ.get('DEMO_ARTIFACT_RELEASE', ''),
    }
    if not ACCOUNT.fullmatch(settings['account_id']):
        raise DemoError('Falta configurar AWS_EXPECTED_ACCOUNT_ID con la cuenta autorizada.')
    if not KEY_NAME.fullmatch(settings['key_name']):
        raise DemoError('SSH_KEY_PAIR_NAME no es válido.')
    try:
        settings['ssh_cidr'] = str(ipaddress.ip_network(settings['ssh_cidr'], strict=True))
    except ValueError as error:
        raise DemoError('DEMO_SSH_CIDR debe ser una IP pública concreta con /32.') from error
    if (ipaddress.ip_network(settings['ssh_cidr']).version != 4
            or ipaddress.ip_network(settings['ssh_cidr']).prefixlen != 32
            or not ipaddress.ip_network(settings['ssh_cidr']).network_address.is_global):
        raise DemoError('DEMO_SSH_CIDR debe ser una IP pública concreta con /32.')
    if not settings['private_key_wsl'].startswith('/') or any(c in settings['private_key_wsl'] for c in '\r\n'):
        raise DemoError('DEMO_SSH_PRIVATE_KEY_WSL_PATH debe ser una ruta privada de Linux/WSL.')
    if len(settings['admin_name']) > 120 or not settings['admin_name'].strip():
        raise DemoError('DEMO_ADMIN_NAME no es válido.')
    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', settings['certbot_email']):
        raise DemoError('DEMO_CERTBOT_EMAIL debe ser un correo válido para Certbot.')
    if not settings['artifact_release'] or not re.fullmatch(r'[a-f0-9]{32}', settings['artifact_release']):
        raise DemoError('DEMO_ARTIFACT_RELEASE debe identificar una preparación local verificada.')
    if not settings['psycopg_deb_wsl'].startswith('/'):
        raise DemoError('DEMO_POSTGRESQL_PSYCOPG_DEB debe apuntar al paquete Ubuntu de psycopg2 en WSL.')
    return settings


def check_wsl_private_file(path):
    wsl(['--exec', 'test', '-f', path])
    mode = wsl(['--exec', 'stat', '-c', '%a', path]).decode().strip()
    if mode not in ('400', '600'):
        raise DemoError('La clave SSH debe estar en Linux/WSL con permisos 0400 o 0600.')


def verify_artifacts(release_id):
    candidate = ROOT / 'output' / 'ansible-artifacts' / 'releases' / release_id
    if candidate.is_symlink():
        raise DemoError('Ruta de artefactos inválida.')
    directory = candidate.resolve(strict=True)
    if directory.parent != (ROOT / 'output' / 'ansible-artifacts' / 'releases').resolve():
        raise DemoError('Ruta de artefactos inválida.')
    try:
        manifest_path = directory / 'manifest.json'
        if manifest_path.is_symlink():
            raise ValueError()
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
        if manifest.get('schema_version') != 1 or not re.fullmatch(r'[a-f0-9]{40}', manifest['revisions']['backend']) \
                or not re.fullmatch(r'[a-f0-9]{40}', manifest['revisions']['frontend']):
            raise ValueError()
        for name in ('source.tar.gz', 'wheels.tar.gz', 'build.tar.gz'):
            path = directory / name
            if path.is_symlink() or not path.is_file() or path.stat().st_size == 0:
                raise ValueError()
            checksum = hashlib.sha256()
            with path.open('rb') as package:
                for block in iter(lambda: package.read(1024 * 1024), b''):
                    checksum.update(block)
            digest = checksum.hexdigest()
            if manifest['sha256'].get(name) != digest:
                raise ValueError()
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise DemoError('Los artefactos locales de asistencia faltan o no coinciden con su manifiesto.') from error
    return directory, manifest


def pulumi_ready():
    """Pulumi solo se ofrece si existen su CLI y un intérprete con pulumi y pulumi-aws."""
    return pulumi_tenant.ready()


def check_setup():
    missing = []
    for executable in ('python', 'aws', 'trivy', 'wsl.exe'):
        if not shutil.which(executable):
            missing.append(executable.replace('.exe', ''))
    terraform_available = shutil.which('terraform') is not None
    opentofu_available = shutil.which('tofu') is not None
    if not missing:
        try:
            wsl(['--exec', 'which', 'ansible-playbook'])
            wsl(['--exec', 'which', 'ansible-vault'])
            wsl(['--exec', 'which', 'wslpath'])
        except DemoError:
            missing.append('ansible-wsl')
    try:
        settings = configured()
        check_wsl_private_file(settings['private_key_wsl'])
        wsl(['--exec', 'test', '-f', settings['psycopg_deb_wsl']])
        verify_artifacts(settings['artifact_release'])
        identity = aws_json('us-east-1', 'sts', 'get-caller-identity')
        if identity.get('Account') != settings['account_id']:
            missing.append('aws-account')
    except (DemoError, OSError, ValueError, TypeError) as error:
        message = str(error)
        if message.startswith('Falta configurar '):
            missing.append(message.removeprefix('Falta configurar ').split()[0])
        elif 'DEMO_SSH_CIDR' in message:
            missing.append('DEMO_SSH_CIDR')
        elif 'DEMO_SSH_PRIVATE_KEY_WSL_PATH' in message or 'clave SSH' in message:
            missing.append('ssh-private-key')
        elif 'DEMO_ARTIFACT_RELEASE' in message or 'artefactos locales' in message:
            missing.append('assistance-artifacts')
        elif 'DEMO_POSTGRESQL_PSYCOPG_DEB' in message or 'psycopg' in message:
            missing.append('postgresql-driver')
        elif 'DEMO_CERTBOT_EMAIL' in message:
            missing.append('DEMO_CERTBOT_EMAIL')
        else:
            missing.append('local-configuration')
    if os.environ.get('DEMO_PROVISIONING_LOCAL') != 'true':
        missing.append('DEMO_PROVISIONING_LOCAL')
    common_ready = not missing
    engines = ['cloudformation'] if common_ready else []
    if common_ready and pulumi_ready():
        engines.insert(0, 'pulumi')
    if common_ready and opentofu_available:
        engines.insert(0, 'opentofu')
    if common_ready and terraform_available:
        engines.insert(0, 'terraform')
    elif common_ready:
        missing.append('terraform')
    return {'ready': bool(engines), 'missing': sorted(set(missing)), 'supported_engines': engines}


def aws_json(region, *arguments):
    output = run_silent(['aws', *arguments, '--region', region, '--output', 'json', '--no-cli-pager'])
    try:
        return json.loads(output)
    except ValueError as error:
        raise DemoError('AWS devolvió una respuesta inválida durante el preflight.') from error


def preflight(request, settings):
    region = request['region']
    identity = aws_json(region, 'sts', 'get-caller-identity')
    if identity.get('Account') != settings['account_id']:
        raise DemoError('La identidad AWS activa no coincide con AWS_EXPECTED_ACCOUNT_ID.')
    key = aws_json(region, 'ec2', 'describe-key-pairs', '--key-names', settings['key_name'], '--include-public-key')
    key_pairs = key.get('KeyPairs', [])
    if len(key_pairs) != 1 or not isinstance(key_pairs[0].get('PublicKey'), str):
        raise DemoError('No se pudo verificar el key pair en la región solicitada.')
    local_public_key = wsl(['--exec', 'ssh-keygen', '-y', '-f', settings['private_key_wsl']],
                           input_data=b'').decode().split()
    aws_public_key = key_pairs[0]['PublicKey'].split()
    if len(local_public_key) < 2 or local_public_key[:2] != aws_public_key[:2]:
        raise DemoError('La clave privada local no corresponde al key pair AWS.')
    tagged = aws_json(region, 'resourcegroupstaggingapi', 'get-resources',
                      '--tag-filters', 'Key=Project,Values=proyecto-modulo-2',
                      f"Key=TenantId,Values={request['tenant_slug']}")
    if tagged.get('ResourceTagMappingList'):
        raise DemoError('Ya hay recursos con el tenant indicado; se detiene para evitar colisiones.')
    zones = None
    for role in ROLES:
        image_id = request['images'][role]['ami_id']
        images = aws_json(region, 'ec2', 'describe-images', '--owners', 'self', '--image-ids', image_id).get('Images', [])
        if len(images) != 1 or images[0].get('State') != 'available' or images[0].get('Architecture') != 'x86_64':
            raise DemoError(f'La Golden AMI de {role} no está disponible en la cuenta y región.')
        root = images[0].get('RootDeviceName')
        root_size = next((item.get('Ebs', {}).get('VolumeSize') for item in images[0].get('BlockDeviceMappings', [])
                          if item.get('DeviceName') == root), None)
        if not isinstance(root_size, int) or root_size > request['plan_snapshot']['roles'][role]['disk_gib']:
            raise DemoError(f'El disco del plan no admite la Golden AMI de {role}.')
    for instance_type in sorted({request['plan_snapshot']['roles'][role]['instance_type'] for role in ROLES}):
        offerings = aws_json(region, 'ec2', 'describe-instance-type-offerings',
                             '--location-type', 'availability-zone',
                             '--filters', f'Name=instance-type,Values={instance_type}')
        available = {item.get('Location') for item in offerings.get('InstanceTypeOfferings', [])}
        zones = available if zones is None else zones & available
    if not zones:
        raise DemoError('No hay una zona AWS que ofrezca todos los tipos del plan.')
    return sorted(zones)[0]


def build_request(source):
    if not isinstance(source, dict) or set(source) != {'tenant', 'plan', 'images'}:
        raise DemoError('La solicitud de demostración tiene un formato inválido.')
    tenant, plan, images = source['tenant'], source['plan'], source['images']
    if not isinstance(tenant, dict) or set(tenant) != {'slug', 'name', 'email', 'plan_slug', 'region', 'engine', 'request_id'}:
        raise DemoError('Los datos del tenant no corresponden al contrato.')
    slug = tenant['slug']
    if not isinstance(slug, str) or not SLUG.fullmatch(slug):
        raise DemoError('Identificador de tenant inválido.')
    if tenant['engine'] not in ENGINES:
        raise DemoError('La demostración solo admite Terraform y CloudFormation.')
    if not isinstance(plan, dict) or plan.get('slug') != tenant['plan_slug'] or not isinstance(plan.get('roles'), dict):
        raise DemoError('El snapshot del plan no coincide con el tenant.')
    if not isinstance(images, list) or len(images) != 3:
        raise DemoError('Faltan Golden AMIs para los tres roles.')
    registry = {'images': images}
    request = prepare(slug, tenant['name'], tenant['email'], tenant['plan_slug'], tenant['region'],
                      tenant['engine'], os.environ.get('SSH_KEY_PAIR_NAME', 'practico7-asistencia'),
                      registry, request_id=tenant['request_id'])
    if not request['deployable']:
        raise DemoError('El contrato deployable=false no se puede aprovisionar.')
    if request['plan_snapshot'] != plan:
        raise DemoError('El catálogo local y el snapshot guardado del plan no coinciden.')
    expected_images = {image['role']: image for image in images
                       if isinstance(image, dict) and image.get('provider') == 'aws' and image.get('region') == tenant['region']}
    if request['images'] != expected_images:
        raise DemoError('El registro local de AMIs cambió desde que se guardó el tenant.')
    return request


def write_handoff(request):
    slug = request['tenant_slug']
    if HANDOFF.is_symlink():
        raise DemoError('Directorio de handoff inválido.')
    HANDOFF.mkdir(mode=0o700, parents=True, exist_ok=True)
    if HANDOFF.resolve().parent != (ROOT / 'output').resolve():
        raise DemoError('Directorio de handoff inválido.')
    directory = HANDOFF / slug
    if directory.exists():
        if directory.is_symlink() or not directory.is_dir():
            raise DemoError('Directorio de handoff inválido.')
        try:
            existing = json.loads((directory / 'request.json').read_text(encoding='utf-8'))
            for role in ROLES:
                if (directory / f'{role}.yaml').read_text(encoding='utf-8').replace('\r\n', '\n') != render(slug, role):
                    raise ValueError()
        except (OSError, ValueError) as error:
            raise DemoError('El handoff existente no es válido; no se sobrescribió.') from error
        comparable_existing = {k: v for k, v in existing.items() if k != 'generated_at'}
        comparable_new = {k: v for k, v in request.items() if k != 'generated_at'}
        if comparable_existing != comparable_new:
            raise DemoError('El handoff existente no coincide con la solicitud; no se sobrescribió.')
        return directory
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    (directory / 'request.json').write_text(json.dumps(request, indent=2) + '\n', encoding='utf-8')
    for role in ROLES:
        (directory / f'{role}.yaml').write_text(render(slug, role), encoding='utf-8', newline='\n')
    return directory


def write_tfvars(request):
    slug = request['tenant_slug']
    directory = ROOT / 'output' / 'tenants' / slug
    if directory.is_symlink():
        raise DemoError('Directorio tfvars inválido.')
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if directory.resolve().parent != (ROOT / 'output' / 'tenants').resolve():
        raise DemoError('Directorio tfvars inválido.')
    path = directory / 'terraform.tfvars.json'
    tfvars = {
        'tenant_id': slug, 'tenant_name': request['institution_name'], 'plan_type': request['plan_snapshot']['slug'],
        'region': request['region'], 'engine': request['engine'], 'request_id': request['request_id'],
        'key_pair_name': request['key_pair_name'],
        'plan_capacity': {role: {key: request['plan_snapshot']['roles'][role][key] for key in ('instance_type', 'disk_gib')}
                          for role in ROLES},
        **{f'{role}_ami_id': request['images'][role]['ami_id'] for role in ROLES},
    }
    if path.exists():
        try:
            existing = json.loads(path.read_text(encoding='utf-8'))
        except (OSError, ValueError) as error:
            raise DemoError('El tfvars existente no es válido; no se sobrescribió.') from error
        if existing != tfvars:
            raise DemoError('El tfvars existente no coincide con la solicitud; no se sobrescribió.')
    else:
        with path.open('x', encoding='utf-8') as stream:
            json.dump(tfvars, stream, indent=2)
            stream.write('\n')
    return path


def execute_engine(request, settings):
    slug = request['tenant_slug']
    if request['engine'] == 'cloudformation':
        base = ['--tenant', slug, '--account-id', settings['account_id'], '--ssh-cidr', settings['ssh_cidr']]
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            if cloudformation_main(['validate', *base]) != 0:
                raise DemoError('El preflight de CloudFormation falló; no se creó el stack.')
        watcher = live_log.StackEvents(lambda text: emit('provision', text), request['region'], 'i3-' + slug)
        watcher.start()
        try:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                args = ['create', *base, '--ssh-private-key-path', settings['private_key_wsl'], '--enable-https']
                if cloudformation_main(args) != 0:
                    raise DemoError('CloudFormation no completó la creación; revisar el estado y la salida privada.')
        finally:
            watcher.stop()
        output = HANDOFF / slug / 'cloudformation'
        return json.loads((output / 'provisioning-result.json').read_text(encoding='utf-8')), output / 'hosts.yml'

    if request['engine'] == 'pulumi':
        base = ['--tenant', slug, '--account-id', settings['account_id'], '--ssh-cidr', settings['ssh_cidr']]
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            if pulumi_tenant.main(['validate', *base]) != 0:
                raise DemoError('La vista previa de Pulumi falló; no se creó el stack.')
        pulumi_tenant.LINE_SINK = lambda text: emit('provision', text)
        try:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                if pulumi_tenant.main(['create', *base, '--ssh-private-key-path', settings['private_key_wsl'], '--enable-https']) != 0:
                    raise DemoError('Pulumi no completó la creación; revisar el estado privado del tenant.')
        finally:
            pulumi_tenant.LINE_SINK = None
        output = HANDOFF / slug / 'pulumi'
        return json.loads((output / 'provisioning-result.json').read_text(encoding='utf-8')), output / 'hosts.yml'

    tfvars = write_tfvars(request)
    common = ['--tfvars', str(tfvars), '--account-id', settings['account_id'], '--ssh-cidr', settings['ssh_cidr'],
              '--member-id', 'integrante-3',
              '--ssh-private-key-path', settings['private_key_wsl'], '--verify-handoff', '--enable-frontend-https']
    original_run = terraform_tenant.run
    def quiet_run(command, cwd, env, capture=False):
        if not capture:
            # Sin salida capturada: se muestra cada recurso que el motor crea o destruye, sin reenviar la salida cruda.
            progress = live_log.TerraformProgress(lambda text: emit('provision', text))
            try:
                code = live_log.stream(command, progress, cwd=cwd, env=env, timeout=3600)
            except OSError as error:
                raise RuntimeError('No se pudo ejecutar el motor IaC.') from error
            if code:
                raise RuntimeError('El motor IaC devolvió un error; no se expondrán logs sin redactar.')
            return ''
        try:
            completed = subprocess.run(command, cwd=cwd, env=env, check=False, text=True,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        except OSError as error:
            raise RuntimeError('No se pudo ejecutar el motor IaC.') from error
        if completed.returncode:
            raise RuntimeError('El motor IaC devolvió un error; no se expondrán logs sin redactar.')
        return completed.stdout if capture else ''
    terraform_tenant.run = quiet_run
    try:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            if terraform_tenant.main(['plan', *common]) != 0:
                raise DemoError('El preflight o plan de Terraform falló; no se aplicaron recursos.')
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            if terraform_tenant.main(['apply', *common, '--yes']) != 0:
                raise DemoError('Terraform no completó la creación; revisar el estado privado del tenant.')
    finally:
        terraform_tenant.run = original_run
    output = json.loads((tfvars.parent / 'provisioning-result.json').read_text(encoding='utf-8'))
    inventory = ROOT / 'inventories' / slug / 'hosts.ini'
    return output, inventory


def stage_ansible(slug, result, inventory, request, settings, release, manifest):
    source_inventory = wsl_path(inventory)
    artifacts = {name: wsl_path(release / name) for name in ('source.tar.gz', 'wheels.tar.gz', 'build.tar.gz')}
    admin_vars = {
        'tenant_slug': slug, 'admin_name': settings['admin_name'], 'admin_email': request['admin_email'],
        'certbot_email': settings['certbot_email'], 'institution_name': request['institution_name'],
        'tenant_plan_name': request['plan_snapshot']['name'],
        'backend_revision': manifest['revisions']['backend'], 'backend_source_archive': artifacts['source.tar.gz'],
        'backend_wheels_archive': artifacts['wheels.tar.gz'],
        'frontend_revision': manifest['revisions']['frontend'], 'frontend_build_archive': artifacts['build.tar.gz'],
        'frontend_build_sha256': manifest['sha256']['build.tar.gz'],
        'frontend_server_name': result['nodes']['frontend']['public_ip'],
        'frontend_public_ip': result['nodes']['frontend']['public_ip'],
        'backend_private_ip': result['nodes']['backend']['private_ip'],
        'database_private_ip': result['nodes']['database']['private_ip'],
        'backend_port': 8000, 'postgresql_psycopg_deb': settings['psycopg_deb_wsl'],
    }
    payload = json.dumps({'inventory': source_inventory, 'variables': admin_vars})
    wsl(['--cd', wsl_path(ROOT), '--exec', 'python3', 'scripts/demo_vault.py', 'create', '--tenant', slug])
    wsl(['--cd', wsl_path(ROOT), '--exec', 'python3', 'scripts/demo_vault.py', 'stage', '--tenant', slug],
        input_data=payload.encode())
    paths = json.loads(wsl(['--cd', wsl_path(ROOT), '--exec', 'python3', 'scripts/demo_vault.py', 'paths',
                            '--tenant', slug]).decode())
    return [paths['inventory'], paths['variables'], paths['vault'], paths['vault_password_file']]


def configure_and_verify(slug, request, result, staged):
    inventory, variables, vault, password_file = staged
    playbook = wsl_path(ROOT / 'infrastructure' / 'ansible' / 'configure-tenant.yml')
    command = [
        'wsl.exe', *wsl_distro_args(), '--cd', wsl_path(ROOT), '--exec', 'env',
        'ANSIBLE_SSH_ARGS=-C -o ControlMaster=auto -o ControlPersist=60s -o StrictHostKeyChecking=accept-new',
        'ansible-playbook', '-i', inventory, playbook,
        '--vault-password-file', password_file, '-e', '@' + variables, '-e', '@' + vault,
    ]
    # Se muestra cada play y tarea de Ansible (sin la salida cruda) mientras se configura el tenant.
    progress = live_log.AnsibleProgress(lambda text: emit('configure', text))
    try:
        code = live_log.stream(command, progress, timeout=5400)
    except OSError as error:
        raise DemoError('Falló una comprobación requerida; revise la configuración local y el estado del tenant.') from error
    if code:
        raise DemoError('Falló una comprobación requerida; revise la configuración local y el estado del tenant.')
    verify = wsl(['--cd', wsl_path(ROOT), '--exec', 'python3', 'scripts/verify_demo_login.py', '--tenant', slug],
                 timeout=600)
    try:
        verification = json.loads(verify)
    except (ValueError, UnicodeDecodeError) as error:
        raise DemoError('El verificador HTTPS devolvió una respuesta inválida.') from error
    if not isinstance(verification, dict) or set(verification) != {'verified'} or verification['verified'] is not True:
        raise DemoError('El login HTTPS del administrador no se verificó.')


def run(source):
    if os.environ.get('DEMO_PROVISIONING_LOCAL') != 'true':
        raise DemoError('El aprovisionamiento local de demostración está deshabilitado.')
    settings = configured()
    capability = check_setup()
    if not capability['ready']:
        raise DemoError('Faltan dependencias o configuración local requeridas.')
    request = build_request(source)
    slug = request['tenant_slug']
    if request['engine'] not in capability['supported_engines']:
        raise DemoError('El motor seleccionado no está disponible en este equipo.')
    DEMO_OUTPUT.mkdir(mode=0o700, parents=True, exist_ok=True)
    lock_root = DEMO_OUTPUT / 'locks'
    lock_root.mkdir(mode=0o700, exist_ok=True)
    lock = lock_root / slug
    try:
        lock.mkdir(mode=0o700)
    except FileExistsError as error:
        raise DemoError('Ya hay una operación activa para este tenant.') from error
    result_path = DEMO_OUTPUT / slug / 'provisioning-result.json'
    try:
        if DEMO_OUTPUT.is_symlink() or lock_root.is_symlink():
            raise DemoError('Directorio de operación local inválido.')
        check_wsl_private_file(settings['private_key_wsl'])
        wsl(['--exec', 'test', '-f', settings['psycopg_deb_wsl']])
        release, manifest = verify_artifacts(settings['artifact_release'])
        emit('prepare', 'Preparando contrato y snapshot del plan.')
        write_handoff(request)
        result_digest = security_scan.scan_handoff(slug)
        for scanner_info in result_digest.get('scanners', []):
            label = scanner_info.get('label', scanner_info.get('scanner', 'scanner'))
            msg = scanner_info.get('message', '')
            emit('scan', re.sub(r'[\x00-\x1f\x7f]+', ' ', f'{label}: {msg}').strip()[:230])
        for warning in [f for f in result_digest.get('findings', []) if not f.get('blocking')][:6]:
            warn_line = f"Advertencia [{warning.get('scanner', 'iac')} · {warning.get('severity')}] {warning.get('rule_id')}: {warning.get('message', '')}"
            emit('scan', re.sub(r'[\x00-\x1f\x7f]+', ' ', warn_line).strip()[:230])
        if result_digest['status'] != 'clean':
            blocking_rules = ', '.join(
                f"{f.get('rule_id')} ({f.get('severity')})"
                for f in result_digest.get('findings', []) if f.get('blocking')
            )[:140]
            raise DemoError(f'Los escáneres bloquearon el despliegue por errores CRITICAL o secretos: {blocking_rules or "hallazgo crítico"}.')
        emit('scan', 'Los 3 escáneres aprobaron el paquete sin errores CRITICAL; continuando aprovisionamiento.')
        preflight(request, settings)
        emit('preflight', 'Cuenta, región, AMIs, key pair y propiedad comprobados.')
        emit('provision', 'Aprovisionando infraestructura AWS; pueden aplicarse cargos.')
        result, inventory = execute_engine(request, settings)
        result_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with result_path.open('x', encoding='utf-8') as stream:
            json.dump(result, stream, indent=2)
            stream.write('\n')
        emit('configure', 'Infraestructura verificada; configurando PostgreSQL, backend y frontend con Ansible.')
        staged = stage_ansible(slug, result, inventory, request, settings, release, manifest)
        configure_and_verify(slug, request, result, staged)
        emit('verify', 'HTTPS, identidad y acceso del administrador verificados.')
        if request['engine'] == 'pulumi':
            engine_version = 'Pulumi ' + run_silent([pulumi_tenant.pulumi_binary() or 'pulumi', 'version']).decode().strip().splitlines()[0][:40]
        elif request['engine'] in ('terraform', 'opentofu'):
            engine_version = run_silent(['tofu' if request['engine'] == 'opentofu' else 'terraform', 'version']).decode().splitlines()[0][:100]
        else:
            engine_version = 'AWS CloudFormation service API'
        ansible_version = wsl(['--exec', 'ansible', '--version']).decode().splitlines()[0][:100]
        metadata = {
            'application_revision': manifest['revisions']['backend'] + ':' + manifest['revisions']['frontend'],
            'infrastructure_revision': result_digest['content_sha256'],
            'engine_version': engine_version,
            'ansible_version': ansible_version,
            'images': list(request['images'].values()), 'plan_snapshot': request['plan_snapshot'],
            'demo_initial_credentials_verified': True,
            'demo_vault_reference': f'local-vault:{slug}',
            'release_id': settings['artifact_release'],
        }
        emit('complete', 'Tenant configurado y login del administrador verificado.', 'succeeded')
        return {'result': result, 'metadata': metadata, 'access_url': 'https://' + result['nodes']['frontend']['public_ip']}
    finally:
        try:
            lock.rmdir()
        except OSError:
            pass


def read_request(stream):
    """Lee la solicitud JSON de stdin siempre como UTF-8.

    El backend la envía en UTF-8; en Windows Python usa la página de códigos local (cp1252) y
    deformaba los acentos del plan («Básico» -> «BÃ¡sico»), de modo que el snapshot no coincidía con config/plans.json.
    """
    raw = stream.buffer.read() if hasattr(stream, 'buffer') else stream.read()
    return json.loads(raw.decode('utf-8') if isinstance(raw, bytes) else raw)


def main():
    try:
        if sys.argv[1:] == ['--check']:
            print(json.dumps(check_setup()), flush=True)
            return 0
        source = read_request(sys.stdin)
        outcome = run(source)
        print(json.dumps({'stage': 'result', 'status': 'succeeded', **outcome}), flush=True)
        return 0
    except DemoError as error:
        msg = re.sub(r'[\x00-\x1f\x7f]+', ' ', str(error)).strip()[:230]
        emit('failed', msg or 'La operación falló. El tenant no se marcará ACTIVE; revise los artefactos locales y el estado AWS.', 'failed')
        return 1
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError):
        emit('failed', 'La operación falló. El tenant no se marcará ACTIVE; revise los artefactos locales y el estado AWS.', 'failed')
        return 1


if __name__ == '__main__':
    sys.exit(main())
