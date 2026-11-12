"""Preflight, construcción y prueba de imágenes del integrante 1 mediante CLI; nunca lee ni imprime credenciales AWS."""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
import uuid

from import_packer_manifest import import_builds
from render_cloud_init import render

ROOT = Path(__file__).resolve().parent.parent
ROLES = ('frontend', 'backend', 'database')


def aws(region, *arguments):
    command = ['aws', *arguments, '--region', region, '--output', 'json', '--no-cli-pager', '--cli-connect-timeout', '5', '--cli-read-timeout', '15']
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode:
        # No persistir salida arbitraria de un proveedor que pudiera contener información privada.
        raise RuntimeError(f'AWS falló en {arguments[0]} {arguments[1]}. Verifique conexión, perfil y permisos desde su terminal.')
    return json.loads(result.stdout or '{}')


def save(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


def public_cidr(value):
    network = ipaddress.ip_network(value, strict=True)
    if network.version != 4 or network.prefixlen != 32 or not network.network_address.is_global:
        raise ValueError('Especificar la IP pública de salida del constructor con /32.')
    return str(network)


def preflight(region, ssh_cidr, key_name=None, pem=None, vpc_id=None, subnet_id=None):
    ssh_cidr = public_cidr(ssh_cidr)
    identity = aws(region, 'sts', 'get-caller-identity')
    if key_name:
        key = aws(region, 'ec2', 'describe-key-pairs', '--key-names', key_name, '--include-public-key')['KeyPairs'][0]
        if pem:
            pem_path = Path(pem).resolve(strict=True)
            result = subprocess.run(['ssh-keygen', '-y', '-f', str(pem_path)], capture_output=True, text=True)
            if result.returncode or result.stdout.split()[:2] != key.get('PublicKey', '').split()[:2]:
                raise ValueError('La clave local no corresponde al key pair de la región o no pudo leerse.')
    if not vpc_id:
        networks = aws(region, 'ec2', 'describe-vpcs', '--filters', 'Name=isDefault,Values=true')['Vpcs']
        if not networks: raise ValueError('No existe VPC por defecto. Especificar --vpc-id y --subnet-id de construcción.')
        vpc_id = networks[0]['VpcId']
    subnets = aws(region, 'ec2', 'describe-subnets', '--filters', f'Name=vpc-id,Values={vpc_id}')['Subnets']
    tables = aws(region, 'ec2', 'describe-route-tables', '--filters', f'Name=vpc-id,Values={vpc_id}')['RouteTables']
    candidates = []
    for subnet in subnets:
        explicit = [table for table in tables if any(a.get('SubnetId') == subnet['SubnetId'] for a in table['Associations'])]
        applicable = explicit or [table for table in tables if any(a.get('Main') for a in table['Associations'])]
        public = any(route.get('DestinationCidrBlock') == '0.0.0.0/0' and route.get('GatewayId', '').startswith('igw-') and route.get('State') == 'active' for table in applicable for route in table['Routes'])
        if public and subnet.get('State') == 'available' and subnet.get('AvailableIpAddressCount', 0) > 0:
            candidates.append(subnet['SubnetId'])
    if subnet_id and subnet_id not in candidates: raise ValueError('La subred indicada no tiene ruta pública activa en la VPC seleccionada.')
    if not candidates: raise ValueError('No hay subred pública utilizable para la construcción.')
    images = aws(region, 'ec2', 'describe-images', '--owners', '099720109477', '--filters',
                 'Name=name,Values=ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*',
                 'Name=state,Values=available', 'Name=architecture,Values=x86_64', 'Name=root-device-type,Values=ebs')['Images']
    if not images: raise ValueError('No se encontró una AMI Ubuntu 24.04 de Canonical disponible en la región.')
    source = max(images, key=lambda image: image['CreationDate'])
    return dict(schema_version=1, account_id=identity['Account'], principal_arn=identity['Arn'], region=region,
                source_ami=source['ImageId'], vpc_id=vpc_id, subnet_id=subnet_id or sorted(candidates)[0],
                ssh_source_cidr=ssh_cidr, key_name=key_name, checked_at=datetime.now(timezone.utc).isoformat())


def check_account(config):
    identity = aws(config['region'], 'sts', 'get-caller-identity')
    if identity['Account'] != config['account_id']:
        raise ValueError('La cuenta activa cambió desde el preflight. Operación cancelada.')


@contextmanager
def exclusive_lock():
    lock = ROOT / 'output/image-build.lock'
    lock.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL)
    try:
        os.write(descriptor, str(os.getpid()).encode())
        yield
    finally:
        os.close(descriptor)
        lock.unlink(missing_ok=True)


def packer_path():
    local = ROOT / '.tools/packer/packer.exe'
    executable = str(local) if local.exists() else shutil.which('packer')
    if not executable: raise ValueError('Instale Packer con scripts/install-packer.ps1 o agréguelo al PATH.')
    return executable


def build(config, revision, image_version):
    if not re.fullmatch(r'[a-f0-9]{7,40}', revision): raise ValueError('Especificar un commit real mediante --source-revision.')
    if not re.fullmatch(r'\d+\.\d+\.\d+', image_version): raise ValueError('Versión de imagen inválida.')
    check_account(config)
    packer = packer_path()
    directory = ROOT / 'infrastructure/packer'
    version_output = subprocess.check_output([packer, 'version'], text=True)
    match = re.search(r'Packer v(\d+\.\d+\.\d+)', version_output)
    if not match: raise ValueError('No se pudo determinar la versión de Packer.')
    run_id = uuid.uuid4().hex[:12]
    variables = {key: config[key] for key in ('region', 'source_ami', 'vpc_id', 'subnet_id', 'ssh_source_cidr')}
    variables.update(source_revision=revision, image_version=image_version, build_id=run_id)
    varfile = ROOT / 'output' / run_id / 'build.pkrvars.json'
    save(varfile, variables)
    registry_path = ROOT / 'config/golden-images.local.json'
    with exclusive_lock():
        subprocess.run([packer, 'init', '.'], cwd=directory, check=True)
        subprocess.run([packer, 'fmt', '-check', '.'], cwd=directory, check=True)
        for role in ROLES:
            flags = [f'-var-file={varfile}', f'-var=role={role}']
            subprocess.run([packer, 'validate', *flags, '.'], cwd=directory, check=True)
            subprocess.run([packer, 'build', *flags, '.'], cwd=directory, check=True)
            images = import_builds(json.loads((directory / f'manifest-{role}.json').read_text(encoding='utf-8')), match[1])
            registry = json.loads(registry_path.read_text(encoding='utf-8')) if registry_path.exists() else {'schema_version': 1, 'images': []}
            keys = {(image['role'], image['region']) for image in images}
            registry['images'] = [image for image in registry['images'] if (image['role'], image['region']) not in keys] + images
            save(registry_path, registry)
    print('Tres construcciones finalizadas. Ejecutar smoke para verificar el primer arranque antes de entregar las AMIs.')


def owned_instance(instance, run_id):
    tags = {tag['Key']: tag['Value'] for tag in instance.get('Tags', [])}
    return tags.get('Project') == 'proyecto-modulo-2' and tags.get('Purpose') == 'image-verification' and tags.get('RunId') == run_id


def smoke(config, pem):
    check_account(config)
    pem = Path(pem).resolve(strict=True)
    if not config.get('key_name'): raise ValueError('Repetir preflight con --key-name y --pem para verificar la clave compartida.')
    registry = json.loads((ROOT / 'config/golden-images.local.json').read_text(encoding='utf-8'))
    images = {image['role']: image for image in registry['images'] if image['region'] == config['region']}
    if set(images) != set(ROLES): raise ValueError('Se requieren las tres imágenes de la región seleccionada.')
    run_id = uuid.uuid4().hex[:12]
    directory = ROOT / 'output' / f'verify-{run_id}'
    directory.mkdir(parents=True)
    evidence = dict(run_id=run_id, region=config['region'], images=[], cleanup=[])
    group_id = None
    instances = []
    region = config['region']
    tags = [{'Key': key, 'Value': value} for key, value in {'Project': 'proyecto-modulo-2', 'Purpose': 'image-verification', 'MemberId': 'integrante-1', 'RunId': run_id}.items()]
    try:
        group_id = aws(region, 'ec2', 'create-security-group', '--group-name', f'modulo2-i1-verify-{run_id}', '--description', 'Temporary image verification', '--vpc-id', config['vpc_id'], '--tag-specifications', json.dumps([{'ResourceType': 'security-group', 'Tags': tags}]))['GroupId']
        aws(region, 'ec2', 'authorize-security-group-ingress', '--group-id', group_id, '--protocol', 'tcp', '--port', '22', '--cidr', config['ssh_source_cidr'])
        for role in ROLES:
            image = images[role]
            actual_image = aws(region, 'ec2', 'describe-images', '--image-ids', image['ami_id'])['Images'][0]
            if actual_image['OwnerId'] != config['account_id'] or actual_image['State'] != 'available': raise ValueError('Imagen fuera de la cuenta esperada o no disponible.')
            user_data = directory / f'{role}.yaml'
            user_data.write_text(render(f'verify-{run_id}', role), encoding='utf-8', newline='\n')
            network = [{'DeviceIndex': 0, 'SubnetId': config['subnet_id'], 'Groups': [group_id], 'AssociatePublicIpAddress': True}]
            instance = aws(region, 'ec2', 'run-instances', '--image-id', image['ami_id'], '--instance-type', 't3.micro', '--count', '1', '--key-name', config['key_name'],
                           '--client-token', f'{run_id}-{role}', '--block-device-mappings', json.dumps([{'DeviceName': actual_image['RootDeviceName'], 'Ebs': {'VolumeType': 'gp3', 'VolumeSize': 12, 'Encrypted': True, 'DeleteOnTermination': True}}]),
                           '--network-interfaces', json.dumps(network), '--metadata-options', 'HttpTokens=required,HttpEndpoint=enabled', '--credit-specification', 'CpuCredits=standard',
                           '--user-data', 'file://' + user_data.as_posix(), '--tag-specifications', json.dumps([{'ResourceType': kind, 'Tags': tags} for kind in ('instance', 'volume')]))['Instances'][0]
            instance_id = instance['InstanceId']
            instances.append(instance_id)
            # Espera acotada y visible; solo un servidor por rol en ejecución durante la verificación.
            address = None
            for _ in range(60):
                current = aws(region, 'ec2', 'describe-instances', '--instance-ids', instance_id)['Reservations'][0]['Instances'][0]
                if current['State']['Name'] == 'running' and current.get('PublicIpAddress'):
                    address = current['PublicIpAddress']; break
                time.sleep(5)
            if not address: raise RuntimeError('La instancia no obtuvo dirección pública a tiempo.')
            command = ['ssh', '-i', str(pem), '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'ConnectTimeout=5', '-o', 'StrictHostKeyChecking=accept-new', '-o', f'UserKnownHostsFile={directory / "known_hosts"}',
                       f'ubuntu@{address}', 'sudo', 'bash', '-s', '--', role, f'verify-{run_id}']
            result = None
            for _ in range(36):
                try:
                    # Bytes: con text=True, Windows convertiria LF en CRLF y bash rechazaria el script (set -o pipefail con CR).
                    script = (ROOT / 'scripts/verify_image.sh').read_bytes().replace(b'\r\n', b'\n')
                    result = subprocess.run(command, input=script, capture_output=True, timeout=180)
                except subprocess.TimeoutExpired:
                    raise RuntimeError('La comprobación SSH excedió el tiempo máximo.') from None
                if result.returncode == 0: break
                time.sleep(5)
            if result is None or result.returncode: raise RuntimeError(f'Falló la comprobación de {role}. No se guardan salidas potencialmente sensibles.')
            evidence['images'].append(dict(role=role, ami_id=image['ami_id'], instance_id=instance_id, checks='passed', output=result.stdout.decode('utf-8', 'replace')))
            save(directory / 'evidence.json', evidence)
            current = aws(region, 'ec2', 'describe-instances', '--instance-ids', instance_id)['Reservations'][0]['Instances'][0]
            if not owned_instance(current, run_id): raise ValueError('Etiquetas inesperadas: no se autoriza terminar el recurso.')
            aws(region, 'ec2', 'terminate-instances', '--instance-ids', instance_id)
    finally:
        for instance_id in instances:
            try:
                current = aws(region, 'ec2', 'describe-instances', '--instance-ids', instance_id)['Reservations'][0]['Instances'][0]
                if not owned_instance(current, run_id): raise ValueError('Propiedad del recurso no verificada.')
                if current['State']['Name'] != 'terminated': aws(region, 'ec2', 'terminate-instances', '--instance-ids', instance_id)
                evidence['cleanup'].append({'instance_id': instance_id, 'termination_requested': True})
            except (ValueError, RuntimeError): evidence['cleanup'].append({'instance_id': instance_id, 'termination_requested': False})
        if group_id:
            removed = False
            for _ in range(30):
                try:
                    aws(region, 'ec2', 'delete-security-group', '--group-id', group_id); removed = True; break
                except RuntimeError: time.sleep(5)
            evidence['security_group'] = {'id': group_id, 'deleted': removed}
        save(directory / 'evidence.json', evidence)
    if any(not item['termination_requested'] for item in evidence['cleanup']) or not evidence.get('security_group', {}).get('deleted'):
        raise RuntimeError(f'Revisar limpieza pendiente en {directory / "evidence.json"}.')
    print(f'Primer arranque verificado para los tres roles. Evidencia: {directory / "evidence.json"}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='operation', required=True)
    pre = commands.add_parser('preflight')
    pre.add_argument('--region', default='us-east-1'); pre.add_argument('--ssh-cidr', required=True)
    pre.add_argument('--vpc-id'); pre.add_argument('--subnet-id'); pre.add_argument('--key-name'); pre.add_argument('--pem')
    pre.add_argument('--output', type=Path, default=ROOT / 'output/aws-preflight.json')
    create = commands.add_parser('build')
    create.add_argument('--config', type=Path, default=ROOT / 'output/aws-preflight.json')
    create.add_argument('--source-revision', required=True); create.add_argument('--image-version', default='0.1.0')
    verify = commands.add_parser('smoke')
    verify.add_argument('--config', type=Path, default=ROOT / 'output/aws-preflight.json'); verify.add_argument('--pem', required=True)
    args = parser.parse_args()
    try:
        if args.operation == 'preflight':
            result = preflight(args.region, args.ssh_cidr, args.key_name, args.pem, args.vpc_id, args.subnet_id)
            save(args.output, result)
            print(f'Preflight correcto en cuenta {result["account_id"]}, región {result["region"]}. Resultado: {args.output}')
        elif args.operation == 'build': build(json.loads(args.config.read_text(encoding='utf-8')), args.source_revision, args.image_version)
        else: smoke(json.loads(args.config.read_text(encoding='utf-8')), args.pem)
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.CalledProcessError) as error:
        parser.exit(2, f'{error}\n')


if __name__ == '__main__': main()
