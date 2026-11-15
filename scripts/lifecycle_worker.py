"""Ciclo de vida de un tenant en AWS: suspender, reanudar y eliminar (RF-16 a RF-18).

Lee una solicitud JSON por stdin y emite eventos JSON por stdout, igual que demo_worker.py.
Antes de cambiar nada verifica la cuenta AWS y que cada instancia pertenezca al tenant por sus
etiquetas Project y TenantId. Actúa solo sobre IDs exactos, nunca por nombre parcial.
Con "simulate": true no toca AWS y marca cada mensaje como [SIMULADO].
"""
import contextlib
import copy
import hashlib
import io
import ipaddress
import json
import os
import random
import re
import shlex
import socket
import ssl
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone

import cloudformation_tenant
import pulumi_tenant
import terraform_tenant
from demo_worker import (ACCOUNT, DEMO_OUTPUT, ROOT, SLUG, DemoError, aws_json, configure_and_verify, read_request, run_silent, wsl, wsl_path)

ROLES = ('frontend', 'backend', 'database')
ACTIONS = ('suspend', 'resume', 'delete', 'reconfigure', 'backup', 'restore')
DATABASE = 'control_asistencia'
BACKUP_ID = re.compile(r'[0-9a-f-]{36}\Z')
SHA256 = re.compile(r'[a-f0-9]{64}\Z')
INSTANCE = re.compile(r'i-[a-f0-9]{8,17}\Z')
REGION = re.compile(r'[a-z]{2}(?:-[a-z]+)+-\d\Z')
ENGINES = ('terraform', 'opentofu', 'pulumi', 'cloudformation')
STATE = {'mutated': False, 'simulate': False}


def emit(stage, message, status='running', **extra):
    """Un evento estructurado por línea; el mensaje nunca incluye salida cruda de AWS."""
    text = re.sub(r'[\x00-\x1f\x7f]+', ' ', message).strip()[:230]
    if STATE['simulate'] and not text.startswith('[SIMULADO]'):
        text = ('[SIMULADO] ' + text)[:230]
    print(json.dumps({'stage': stage, 'message': text, 'status': status, **extra}), flush=True)


def validate(source):
    """Comprueba el contrato de entrada y devuelve (acción, tenant, resultado)."""
    if not isinstance(source, dict) or set(source) != {'action', 'simulate', 'tenant', 'result', 'backup'}:
        raise DemoError('La solicitud de ciclo de vida tiene un formato inválido.')
    action, tenant, result = source['action'], source['tenant'], source['result']
    if action not in ACTIONS or not isinstance(source['simulate'], bool):
        raise DemoError('Acción de ciclo de vida inválida.')
    if not isinstance(tenant, dict) or set(tenant) != {'slug', 'region', 'engine', 'request_id', 'plan_slug'}:
        raise DemoError('Los datos del tenant no corresponden al contrato.')
    if not isinstance(tenant['slug'], str) or not SLUG.fullmatch(tenant['slug']):
        raise DemoError('Identificador de tenant inválido.')
    if not isinstance(tenant['plan_slug'], str) or not SLUG.fullmatch(tenant['plan_slug']):
        raise DemoError('Plan inválido.')
    if tenant['engine'] not in ENGINES or not isinstance(tenant['region'], str) or not REGION.fullmatch(tenant['region']):
        raise DemoError('Motor o región inválidos.')
    if result is not None:
        nodes = result.get('nodes') if isinstance(result, dict) else None
        if not isinstance(nodes, dict) or set(nodes) != set(ROLES) \
                or any(not INSTANCE.fullmatch(str(nodes[role].get('instance_id', ''))) for role in ROLES):
            raise DemoError('El resultado de aprovisionamiento guardado no es válido.')
    elif action != 'delete':
        raise DemoError('Falta el resultado de aprovisionamiento del tenant.')
    backup = source['backup']
    if action in ('backup', 'restore'):
        if not isinstance(backup, dict) or set(backup) != {'backup_id', 'sha256'} or not BACKUP_ID.fullmatch(str(backup['backup_id'])):
            raise DemoError('Los datos del respaldo no son válidos.')
        if action == 'restore' and not SHA256.fullmatch(str(backup['sha256'])):
            raise DemoError('Falta el checksum del respaldo a restaurar.')
    return action, tenant, result


def account_id():
    value = os.environ.get('AWS_EXPECTED_ACCOUNT_ID', '')
    if not ACCOUNT.fullmatch(value):
        raise DemoError('Falta configurar AWS_EXPECTED_ACCOUNT_ID con la cuenta autorizada.')
    return value


def check_account(region, expected):
    """La cuenta con credenciales activas debe ser la autorizada."""
    actual = run_silent(['aws', 'sts', 'get-caller-identity', '--query', 'Account', '--output', 'text',
                         '--region', region, '--no-cli-pager']).decode().strip()
    if actual != expected:
        raise DemoError('La cuenta AWS activa no coincide con AWS_EXPECTED_ACCOUNT_ID; no se hizo ningún cambio.')


def instances(region, ids):
    data = aws_json(region, 'ec2', 'describe-instances', '--instance-ids', *ids)
    return [item for reservation in data.get('Reservations', []) for item in reservation.get('Instances', [])]


def verify_ownership(region, result, slug):
    """Las tres instancias deben existir, estar en la VPC del tenant y llevar sus etiquetas."""
    ids = [result['nodes'][role]['instance_id'] for role in ROLES]
    found = instances(region, ids)
    if sorted(item['InstanceId'] for item in found) != sorted(ids):
        raise DemoError('Las instancias registradas no coinciden con las de AWS; no se hizo ningún cambio.')
    vpc = result.get('network', {}).get('vpc_id')
    for item in found:
        tags = {tag['Key']: tag['Value'] for tag in item.get('Tags', [])}
        if tags.get('Project') != 'proyecto-modulo-2' or tags.get('TenantId') != slug or (vpc and item.get('VpcId') != vpc):
            raise DemoError('Una instancia no pertenece a este tenant por sus etiquetas; no se hizo ningún cambio.')
    return ids, found


def aws_ec2(region, *arguments, timeout=120):
    return run_silent(['aws', 'ec2', *arguments, '--region', region, '--no-cli-pager'], timeout)


def suspend(tenant, result):
    region = tenant['region']
    ids, found = verify_ownership(region, result, tenant['slug'])
    bad = [item['InstanceId'] for item in found if item['State']['Name'] not in ('running', 'pending', 'stopping', 'stopped')]
    if bad:
        raise DemoError('Hay instancias en un estado que no permite suspender; no se hizo ningún cambio.')
    emit('preflight', 'Cuenta, región y propiedad de las 3 instancias comprobadas.')
    emit('suspend', 'Deteniendo las 3 instancias; los discos EBS y los datos se conservan.')
    STATE['mutated'] = True
    aws_ec2(region, 'stop-instances', '--instance-ids', *ids)
    aws_ec2(region, 'wait', 'instance-stopped', '--instance-ids', *ids, timeout=900)
    emit('verify', 'Las 3 instancias están detenidas.')
    return None


def frontend_answers(address):
    """Comprobación informativa: ¿responde el frontend por HTTPS tras reanudar?"""
    for _ in range(6):
        try:
            with socket.create_connection((address, 443), timeout=5):
                return True
        except OSError:
            time.sleep(5)
    return False


def current_nodes(region, ids, result):
    """Direcciones actuales de las tres instancias según AWS."""
    nodes = {}
    for item in instances(region, ids):
        role = next(name for name in ROLES if result['nodes'][name]['instance_id'] == item['InstanceId'])
        nodes[role] = {'public_ip': item.get('PublicIpAddress'), 'private_ip': item['PrivateIpAddress']}
    if set(nodes) != set(ROLES) or not nodes['frontend']['public_ip']:
        raise DemoError('No se obtuvieron las direcciones nuevas del tenant; revisa AWS.')
    return nodes


def reconfigure_application(tenant, result, nodes):
    """Vuelve a ejecutar la configuración de Ansible con la IP pública nueva: nginx, certificado HTTPS y hosts permitidos del backend la usan.

    El rol del frontend emite un certificado nuevo si el actual no cubre la IP. Termina verificando el login del administrador.
    """
    import cloudformation_tenant
    slug = tenant['slug']
    key = os.environ.get('DEMO_SSH_PRIVATE_KEY_WSL_PATH', '')
    if not key.startswith('/'):
        raise DemoError('Falta DEMO_SSH_PRIVATE_KEY_WSL_PATH para reconfigurar el tenant.')
    updated = copy.deepcopy(result)
    for role in ROLES:
        updated['nodes'][role]['private_ip'] = nodes[role]['private_ip']
        updated['nodes'][role]['public_ip'] = nodes[role]['public_ip']
    directory = DEMO_OUTPUT / slug
    if directory.is_symlink() or not directory.is_dir():
        raise DemoError('No hay carpeta local de resultados del tenant; no se puede reconfigurar.')
    for name, content in (('provisioning-result.json', updated),
                          ('resume-hosts.yml', cloudformation_tenant.inventory({'tenant_slug': slug, 'plan_slug': tenant['plan_slug'],
                                                                                'plan_snapshot': {'slug': tenant['plan_slug']}, 'region': tenant['region']}, updated, key))):
        temporary = directory / (name + '.tmp')
        temporary.write_text(json.dumps(content, indent=2) + '\n', encoding='utf-8')
        os.replace(temporary, directory / name)
    emit('configure', 'Actualizando inventario privado con la IP nueva.')
    payload = json.dumps({'inventory': wsl_path(directory / 'resume-hosts.yml'), 'frontend_ip': nodes['frontend']['public_ip']})
    wsl(['--cd', wsl_path(ROOT), '--exec', 'python3', 'scripts/demo_vault.py', 'refresh', '--tenant', slug], input_data=payload.encode())
    paths = json.loads(wsl(['--cd', wsl_path(ROOT), '--exec', 'python3', 'scripts/demo_vault.py', 'paths', '--tenant', slug]).decode())
    emit('configure', 'Reconfigurando nginx, certificado HTTPS y backend con Ansible; puede tardar varios minutos.')
    configure_and_verify(slug, None, None, [paths['inventory'], paths['variables'], paths['vault'], paths['vault_password_file']])
    emit('verify', 'HTTPS y login del administrador verificados con la IP nueva.')


def resume(tenant, result):
    region = tenant['region']
    ids, _ = verify_ownership(region, result, tenant['slug'])
    emit('preflight', 'Cuenta, región y propiedad de las 3 instancias comprobadas.')
    emit('resume', 'Iniciando las 3 instancias detenidas.')
    STATE['mutated'] = True
    aws_ec2(region, 'start-instances', '--instance-ids', *ids)
    aws_ec2(region, 'wait', 'instance-running', '--instance-ids', *ids, timeout=900)
    aws_ec2(region, 'wait', 'instance-status-ok', '--instance-ids', *ids, timeout=900)
    nodes = current_nodes(region, ids, result)
    emit('verify', 'Las instancias están en ejecución. La IP pública del frontend cambió: se reconfigura la aplicación.')
    reconfigure_application(tenant, result, nodes)
    return nodes


def reconfigure(tenant, result):
    """Reparación: reconfigura un tenant en ejecución con las IP que AWS reporta ahora."""
    region = tenant['region']
    ids, _ = verify_ownership(region, result, tenant['slug'])
    emit('preflight', 'Cuenta, región y propiedad de las 3 instancias comprobadas.')
    STATE['mutated'] = True
    nodes = current_nodes(region, ids, result)
    reconfigure_application(tenant, result, nodes)
    return nodes


def operator_cidr():
    """IP pública del operador con /32; Terraform la necesita para reconstruir el plan al destruir."""
    try:
        network = ipaddress.ip_network(os.environ.get('DEMO_SSH_CIDR', ''), strict=True)
    except ValueError as error:
        raise DemoError('DEMO_SSH_CIDR debe ser una IP pública concreta con /32.') from error
    if network.version != 4 or network.prefixlen != 32 or not network.network_address.is_global:
        raise DemoError('DEMO_SSH_CIDR debe ser una IP pública concreta con /32.')
    return str(network)


def backup_directory(slug):
    """Carpeta local de respaldos del tenant (output/ lo ignora Git; los respaldos contienen datos reales)."""
    directory = ROOT / 'output' / 'backups' / slug
    if directory.is_symlink() or (directory.parent.exists() and directory.parent.is_symlink()):
        raise DemoError('Directorio de respaldos inválido.')
    return directory


def ssh_script(result, role, remote_command, key, redirect=''):
    """Comando bash (para WSL) que ejecuta remote_command en un servidor del tenant pasando por el bastión (el frontend)."""
    import ipaddress
    try:
        bastion = str(ipaddress.IPv4Address(result['nodes']['frontend']['public_ip']))
        target = str(ipaddress.IPv4Address(result['nodes'][role]['private_ip']))
    except ValueError as error:
        raise DemoError('El tenant no tiene las direcciones necesarias para conectarse; revisa su estado.') from error
    if not key.startswith('/') or any(ch in key for ch in '\r\n'):
        raise DemoError('Falta DEMO_SSH_PRIVATE_KEY_WSL_PATH con la ruta Linux/WSL de la llave.')
    proxy = 'ssh -W %h:%p -q -o StrictHostKeyChecking=accept-new -i ' + shlex.quote(key) + ' ubuntu@' + bastion
    command = ['ssh', '-i', key, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20',
               '-o', 'ProxyCommand=' + proxy, 'ubuntu@' + target, remote_command]
    return 'set -o pipefail; ' + ' '.join(shlex.quote(part) for part in command) + redirect


def file_digest(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def check_running(region, result, slug):
    ids, found = verify_ownership(region, result, slug)
    if any(item['State']['Name'] != 'running' for item in found):
        raise DemoError('Las tres instancias deben estar en ejecución; no se hizo ningún cambio.')
    return ids


def backup(tenant, result, request):
    """RF-19: respaldo de la base de datos con pg_dump (formato personalizado) guardado en este equipo."""
    slug, region, backup_id = tenant['slug'], tenant['region'], request['backup_id']
    check_running(region, result, slug)
    key = os.environ.get('DEMO_SSH_PRIVATE_KEY_WSL_PATH', '')
    directory = backup_directory(slug)
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / f'{backup_id}.dump'
    if target.exists():
        raise DemoError('Ya existe un archivo con ese identificador de respaldo.')
    emit('preflight', 'Cuenta, región y propiedad de las 3 instancias comprobadas; el tenant está en ejecución.')
    emit('backup', 'Creando el respaldo de la base de datos con pg_dump; el tenant sigue disponible.')
    script = ssh_script(result, 'database', f'sudo -n -u postgres pg_dump --format=custom {DATABASE}', key, ' > ' + shlex.quote(wsl_path(directory) + f'/{backup_id}.dump'))
    try:
        wsl(['--exec', 'bash', '-c', script], timeout=1800)
        with target.open('rb') as stream:
            header = stream.read(5)
        size = target.stat().st_size
        if header != b'PGDMP' or size < 100:
            raise DemoError('El respaldo generado no es un archivo de pg_dump válido.')
    except (DemoError, OSError):
        target.unlink(missing_ok=True)
        raise DemoError('No se pudo completar el respaldo; revisa la conexión SSH y el estado de la base de datos.')
    digest = file_digest(target)
    manifest = {'backup_id': backup_id, 'tenant_slug': slug, 'created_at': datetime.now(timezone.utc).isoformat(), 'size_bytes': size,
                'sha256': digest, 'database': DATABASE, 'format': 'pg_dump custom'}
    (directory / f'{backup_id}.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    emit('verify', f'Respaldo verificado: {size} bytes, formato pg_dump y checksum registrado.')
    return {'backup': {'backup_id': backup_id, 'size_bytes': size, 'sha256': digest}}


def health_answers(address):
    """Aviso informativo: ¿responde la API del tenant por HTTPS tras restaurar?"""
    for _ in range(6):
        try:
            with urllib.request.urlopen(f'https://{address}/api/health', timeout=10, context=ssl.create_default_context()) as response:
                if response.status == 200:
                    return True
        except OSError:
            time.sleep(5)
    return False


def restore(tenant, result, request):
    """RF-19: restaura un respaldo en la base del tenant. Es atómico (una sola transacción): si falla, los datos no cambian."""
    slug, region, backup_id = tenant['slug'], tenant['region'], request['backup_id']
    source = backup_directory(slug) / f'{backup_id}.dump'
    if source.is_symlink() or not source.is_file() or file_digest(source) != request['sha256']:
        raise DemoError('El archivo del respaldo falta o su checksum no coincide; no se hizo ningún cambio.')
    check_running(region, result, slug)
    key = os.environ.get('DEMO_SSH_PRIVATE_KEY_WSL_PATH', '')
    service = f'campus-cloud-{slug}.service'
    emit('preflight', 'Respaldo, cuenta y propiedad de las 3 instancias comprobados; el tenant está en ejecución.')
    emit('restore', 'Deteniendo el backend para cerrar conexiones; los usuarios verán el servicio no disponible unos instantes.')
    wsl(['--exec', 'bash', '-c', ssh_script(result, 'backend', f'sudo -n systemctl stop {service}', key)], timeout=300)
    restored = False
    try:
        emit('restore', 'Restaurando la base de datos en una sola transacción; reemplaza los datos actuales.')
        command = f'sudo -n -u postgres pg_restore --clean --if-exists --single-transaction --exit-on-error --dbname={DATABASE}'
        wsl(['--exec', 'bash', '-c', ssh_script(result, 'database', command, key, ' < ' + shlex.quote(wsl_path(source)))], timeout=3600)
        restored = True
    except DemoError:
        restored = False
    finally:
        try:
            wsl(['--exec', 'bash', '-c', ssh_script(result, 'backend', f'sudo -n systemctl start {service}', key)], timeout=300)
        except DemoError:
            STATE['mutated'] = True
            raise DemoError('El backend no volvió a iniciar; revisa el servicio del tenant antes de reintentar.')
    if not restored:
        raise DemoError('La restauración falló y se revirtió; los datos del tenant no cambiaron.')
    emit('verify', 'Base restaurada y backend iniciado.' if health_answers(result['nodes']['frontend']['public_ip'])
         else 'Base restaurada, pero la API aún no responde por HTTPS; revisa el tenant en unos minutos.')
    return None


def destroy(tenant, result):
    slug, region, engine = tenant['slug'], tenant['region'], tenant['engine']
    account = account_id()
    if result is not None:
        verify_ownership_for_delete(region, result, slug)
    emit('preflight', 'Cuenta, región y propiedad comprobadas; el motor verifica además su propio estado.')
    emit('destroy', 'Eliminando la infraestructura del tenant con ' + {'cloudformation': 'CloudFormation', 'opentofu': 'OpenTofu', 'pulumi': 'Pulumi'}.get(engine, 'Terraform') + '.')
    STATE['mutated'] = True
    if engine == 'cloudformation':
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            code = cloudformation_tenant.main(['destroy', '--tenant', slug, '--account-id', account, '--confirm', slug])
        if code != 0:
            raise DemoError('CloudFormation no completó la eliminación; revisa el stack en AWS.')
    elif engine == 'pulumi':
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            code = pulumi_tenant.main(['destroy', '--tenant', slug, '--account-id', account, '--confirm', slug])
        if code != 0:
            raise DemoError('Pulumi no completó la eliminación; revisa el stack privado del tenant.')
    else:
        tfvars = ROOT / 'output' / 'tenants' / slug / 'terraform.tfvars.json'
        if not tfvars.is_file() or tfvars.is_symlink():
            raise DemoError('No se encontró el tfvars privado del tenant; no se puede destruir con Terraform.')
        original = terraform_tenant.run

        def quiet_run(command, cwd, env, capture=False):
            try:
                done = subprocess.run(command, cwd=cwd, env=env, check=False, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            except OSError as error:
                raise RuntimeError('No se pudo ejecutar el motor IaC.') from error
            if done.returncode:
                raise RuntimeError('El motor IaC devolvió un error; no se exponen logs sin redactar.')
            return done.stdout if capture else ''
        terraform_tenant.run = quiet_run
        try:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                code = terraform_tenant.main(['destroy', '--tfvars', str(tfvars), '--account-id', account, '--ssh-cidr', operator_cidr(),
                                              '--member-id', 'integrante-3', '--confirm', slug])
        finally:
            terraform_tenant.run = original
        if code != 0:
            raise DemoError('El motor no completó la eliminación; revisa el estado privado del tenant.')
    emit('verify', 'El motor confirmó la eliminación de la infraestructura del tenant.')
    return None


def verify_ownership_for_delete(region, result, slug):
    """Antes de eliminar, si las instancias aún existen deben pertenecer al tenant."""
    ids = [result['nodes'][role]['instance_id'] for role in ROLES]
    try:
        found = instances(region, ids)
    except DemoError:
        return  # ya no existen: el motor decidirá con su propio estado
    for item in found:
        tags = {tag['Key']: tag['Value'] for tag in item.get('Tags', [])}
        if tags.get('Project') != 'proyecto-modulo-2' or tags.get('TenantId') != slug:
            raise DemoError('Una instancia no pertenece a este tenant por sus etiquetas; no se eliminó nada.')


def simulate(action, tenant, result, request=None):
    """Sin AWS: recorre las mismas etapas con pausas cortas, para probar el panel y la auditoría."""
    for stage, message in (('preflight', 'Comprobación de cuenta y propiedad omitida: no se toca AWS.'),
                           (action if action != 'delete' else 'destroy', 'Operación de ciclo de vida sin cambios en la nube.')):
        emit(stage, message)
        time.sleep(1)
    emit('verify', 'Verificación omitida: no existen recursos reales.')
    if action == 'backup':
        return {'backup': {'backup_id': request['backup_id'], 'size_bytes': 0, 'sha256': 'f' * 64}}
    if action != 'resume':
        return None
    nodes = result['nodes']
    return {role: {'private_ip': '10.77.0.%d' % (10 + index), 'public_ip': ('203.0.113.%d' % random.randint(10, 250)) if role == 'frontend' else None}
            for index, role in enumerate(ROLES)} if nodes else None


def run(source):
    action, tenant, result = validate(source)
    STATE['simulate'] = source['simulate']
    slug = tenant['slug']
    if not STATE['simulate']:
        if os.environ.get('DEMO_PROVISIONING_LOCAL') != 'true':
            raise DemoError('Las operaciones locales sobre AWS están deshabilitadas.')
        check_account(tenant['region'], account_id())
    DEMO_OUTPUT.mkdir(mode=0o700, parents=True, exist_ok=True)
    locks = DEMO_OUTPUT / 'locks'
    locks.mkdir(mode=0o700, exist_ok=True)
    lock = locks / slug
    try:
        lock.mkdir(mode=0o700)
    except FileExistsError as error:
        raise DemoError('Ya hay una operación activa para este tenant.') from error
    try:
        if STATE['simulate']:
            return simulate(action, tenant, result, source['backup'])
        if action in ('backup', 'restore'):
            return {'backup': backup, 'restore': restore}[action](tenant, result, source['backup'])
        return {'suspend': suspend, 'resume': resume, 'delete': destroy, 'reconfigure': reconfigure}[action](tenant, result)
    finally:
        try:
            lock.rmdir()
        except OSError:
            pass


def main():
    try:
        outcome = run(read_request(sys.stdin))
        done = {'stage': 'result', 'status': 'succeeded', 'message': 'Operación completada.'}
        if outcome and 'backup' in outcome:
            done['backup'] = outcome['backup']
        elif outcome:
            done['nodes'] = outcome
        print(json.dumps(done), flush=True)
        return 0
    except DemoError as error:
        emit('failed', str(error) or 'La operación falló.', 'failed', safe=not STATE['mutated'])
        return 1
    except (OSError, ValueError, KeyError, TypeError, StopIteration, json.JSONDecodeError):
        emit('failed', 'La operación falló; revisa el estado en AWS antes de reintentar.', 'failed', safe=not STATE['mutated'])
        return 1


if __name__ == '__main__':
    sys.exit(main())
