"""Motor CloudFormation independiente para solicitudes de handoff locales."""
import argparse
import hashlib
import ipaddress
import json
import re
import shlex
import subprocess
import sys
import tempfile
from pathlib import Path
from render_cloud_init import render
from security_scan import FILES, ROOT, SLUG, infrastructure_snapshot, scan_handoff, update_digest

ROLES = ('frontend', 'backend', 'database')
HANDOFF = ROOT / 'output' / 'handoff'


def aws_file(path):
    return 'file://' + str(path.resolve())


def aws(region, *arguments):
    command = ['aws', *arguments, '--region', region, '--output', 'json', '--no-cli-pager']
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=3600, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise RuntimeError(f'No se pudo completar AWS {arguments[0]} {arguments[1]}.') from error
    if result.returncode:
        raise RuntimeError(f'AWS {arguments[0]} {arguments[1]} falló (código {result.returncode}); revise permisos y estado.')
    try:
        return json.loads(result.stdout or '{}')
    except ValueError as error:
        raise RuntimeError('AWS devolvió una respuesta inválida.') from error


def load_handoff(tenant, engine):
    """Lee y valida la solicitud de handoff del motor indicado; devuelve también los archivos de infraestructura."""
    if not SLUG.fullmatch(tenant):
        raise ValueError('Tenant inválido.')
    directory = (HANDOFF / tenant).resolve(strict=True)
    if directory.parent != HANDOFF.resolve(strict=True) or (HANDOFF / tenant).is_symlink():
        raise ValueError('Directorio de handoff inválido.')
    raw = {}
    digest = hashlib.sha256()
    for name in FILES:
        path = directory / name
        if path.is_symlink() or not path.is_file() or path.resolve().parent != directory:
            raise ValueError('El handoff está incompleto.')
        data = path.read_bytes()
        if len(data) > 1024 * 1024:
            raise ValueError('Archivo de handoff demasiado grande.')
        raw[name] = data
        update_digest(digest, name, data)
    try:
        request = json.loads(raw['request.json'])
        user_data = {role: raw[f'{role}.yaml'].decode('utf-8') for role in ROLES}
    except (ValueError, UnicodeDecodeError) as error:
        raise ValueError('El handoff contiene datos inválidos.') from error
    if not isinstance(request, dict) or request.get('tenant_slug') != tenant:
        raise ValueError('La solicitud no corresponde al tenant.')
    if request.get('schema_version') != 1 or request.get('engine') != engine or request.get('provider') != 'aws':
        raise ValueError(f'La solicitud no corresponde al motor {engine} en AWS.')
    if request.get('deployable') is not True:
        raise ValueError('Una solicitud no desplegable no puede aprovisionarse.')
    if not re.fullmatch(r'[A-Za-z0-9-]{1,64}', str(request.get('request_id', ''))):
        raise ValueError('request_id inválido.')
    if not re.fullmatch(r'[a-z]{2}(?:-[a-z]+)+-\d', str(request.get('region', ''))):
        raise ValueError('Región inválida.')
    if not re.fullmatch(r'[A-Za-z0-9._-]{1,255}', str(request.get('key_pair_name', ''))):
        raise ValueError('Key pair inválido.')
    if request.get('user_data') != {role: f'{role}.yaml' for role in ROLES}:
        raise ValueError('Las referencias cloud-init no corresponden a los tres roles.')
    for role in ROLES:
        if user_data[role].replace('\r\n', '\n') != render(tenant, role):
            raise ValueError(f'El cloud-init de {role} no coincide con la plantilla aprobada.')
    plan = request.get('plan_snapshot')
    images = request.get('images')
    if not isinstance(plan, dict) or plan.get('slug') not in ('basico', 'estandar', 'avanzado'):
        raise ValueError('Snapshot de plan inválido.')
    if not isinstance(plan.get('roles'), dict) or not isinstance(images, dict):
        raise ValueError('Faltan capacidades o imágenes.')
    for role in ROLES:
        capacity = plan['roles'].get(role)
        image = images.get(role)
        if not isinstance(capacity, dict) or not re.fullmatch(r'[a-z0-9]+\.[a-z0-9]+', str(capacity.get('instance_type', ''))):
            raise ValueError(f'Capacidad inválida para {role}.')
        disk = capacity.get('disk_gib')
        if type(disk) is not int or not 12 <= disk <= 16384:
            raise ValueError(f'Disco inválido para {role}.')
        if not isinstance(image, dict) or image.get('role') != role or image.get('region') != request['region'] or image.get('provider') != 'aws':
            raise ValueError(f'Imagen incorrecta para {role}.')
        if not re.fullmatch(r'ami-[a-f0-9]{17}', str(image.get('ami_id', ''))):
            raise ValueError(f'AMI inválida para {role}.')
    infrastructure = infrastructure_snapshot(engine)
    for name, data in infrastructure.items():
        update_digest(digest, name, data)
    return request, user_data, digest.hexdigest(), directory, infrastructure


def load_request(tenant):
    request, user_data, digest, directory, infrastructure = load_handoff(tenant, 'cloudformation')
    return request, user_data, digest, directory, infrastructure['infrastructure/cloudformation/tenant.yaml']


def check_account(region, expected):
    if not re.fullmatch(r'\d{12}', expected):
        raise ValueError('La cuenta esperada debe tener 12 dígitos.')
    if aws(region, 'sts', 'get-caller-identity').get('Account') != expected:
        raise ValueError('La cuenta AWS activa no coincide con la esperada.')


def ssh_cidr(value):
    network = ipaddress.ip_network(value, strict=True)
    if network.version != 4 or network.prefixlen != 32 or not network.network_address.is_global:
        raise ValueError('SSH requiere una IP pública concreta con /32.')
    return str(network)


def preflight(request, expected_account):
    region = request['region']
    check_account(region, expected_account)
    aws(region, 'ec2', 'describe-key-pairs', '--key-names', request['key_pair_name'])
    tagged = aws(region, 'resourcegroupstaggingapi', 'get-resources',
                 '--tag-filters', 'Key=Project,Values=proyecto-modulo-2',
                 f"Key=TenantId,Values={request['tenant_slug']}")
    if tagged.get('ResourceTagMappingList'):
        raise ValueError('Ya existen recursos etiquetados para este tenant; no se reutilizarán.')
    for role in ROLES:
        image = request['images'][role]['ami_id']
        response = aws(region, 'ec2', 'describe-images', '--owners', 'self', '--image-ids', image)
        candidates = response.get('Images', [])
        if len(candidates) != 1:
            raise ValueError(f'No se pudo verificar la AMI de {role}.')
        actual = candidates[0]
        root = actual.get('RootDeviceName')
        mappings = actual.get('BlockDeviceMappings', [])
        size = next((entry.get('Ebs', {}).get('VolumeSize') for entry in mappings if entry.get('DeviceName') == root), None)
        if (actual.get('State') != 'available' or actual.get('Architecture') != 'x86_64'
                or root != '/dev/sda1' or not isinstance(size, int)
                or size > request['plan_snapshot']['roles'][role]['disk_gib']):
            raise ValueError(f'AMI o disco incompatible para {role}.')
    zones = None
    for instance_type in {request['plan_snapshot']['roles'][role]['instance_type'] for role in ROLES}:
        result = aws(region, 'ec2', 'describe-instance-type-offerings', '--location-type', 'availability-zone',
                     '--filters', f'Name=instance-type,Values={instance_type}')
        available = {item['Location'] for item in result.get('InstanceTypeOfferings', [])}
        zones = available if zones is None else zones & available
    if not zones:
        raise ValueError('No hay zona que ofrezca todos los tipos del plan.')
    return sorted(zones)[0]


def parameters(request, user_data, zone, cidr, https):
    values = {'TenantSlug': request['tenant_slug'], 'AvailabilityZone': zone,
              'KeyPairName': request['key_pair_name'], 'SshCidr': cidr, 'FrontendHttps': str(https).lower()}
    for role in ROLES:
        title = role.capitalize()
        capacity = request['plan_snapshot']['roles'][role]
        values[title + 'Ami'] = request['images'][role]['ami_id']
        values[title + 'Type'] = capacity['instance_type']
        values[title + 'Disk'] = str(capacity['disk_gib'])
        values[title + 'UserData'] = user_data[role]
    return [{'ParameterKey': key, 'ParameterValue': value} for key, value in values.items()]


def stack_tags(request):
    return {'Project': 'proyecto-modulo-2', 'MemberId': 'integrante-3',
            'TenantId': request['tenant_slug'], 'RunId': request['request_id'], 'ManagedBy': 'cloudformation'}


def stack_arn(request, account, value):
    prefix = f"arn:aws:cloudformation:{request['region']}:{account}:stack/i3-{request['tenant_slug']}/"
    if not isinstance(value, str) or not value.startswith(prefix) or not re.fullmatch(r'[A-Za-z0-9-]+', value[len(prefix):]):
        raise ValueError('Identificador de stack inválido para la cuenta y el tenant.')
    return value


def owner_file(directory):
    output = directory / 'cloudformation'
    if output.is_symlink() or (output.exists() and not output.is_dir()):
        raise ValueError('Directorio de salida no válido.')
    return output / 'owner.json'


def read_owner(directory, request, account):
    path = owner_file(directory)
    if path.is_symlink() or not path.is_file():
        raise ValueError('Falta el registro local de propiedad del stack; no se operará por nombre.')
    owner = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(owner, dict) or owner.get('account_id') != account or owner.get('request_id') != request['request_id']:
        raise ValueError('El registro de propiedad no coincide con la cuenta o solicitud.')
    return stack_arn(request, account, owner.get('stack_id'))


def owned_stack(request, stack_id):
    result = aws(request['region'], 'cloudformation', 'describe-stacks', '--stack-name', stack_id)
    stacks = result.get('Stacks', [])
    if len(stacks) != 1:
        raise ValueError('No se pudo identificar el stack.')
    stack = stacks[0]
    if stack.get('StackId') != stack_id:
        raise ValueError('El identificador del stack cambió.')
    actual = {tag['Key']: tag['Value'] for tag in stack.get('Tags', [])}
    if any(actual.get(key) != value for key, value in stack_tags(request).items()):
        raise ValueError('Las etiquetas del stack no coinciden; operación cancelada.')
    return stack


def verify_stack_resources(request, stack_id):
    expected_types = {
        'Vpc': 'AWS::EC2::VPC', 'InternetGateway': 'AWS::EC2::InternetGateway',
        'GatewayAttachment': 'AWS::EC2::VPCGatewayAttachment', 'PublicSubnet': 'AWS::EC2::Subnet',
        'PrivateSubnet': 'AWS::EC2::Subnet', 'PublicRoutes': 'AWS::EC2::RouteTable',
        'PrivateRoutes': 'AWS::EC2::RouteTable', 'PublicRoute': 'AWS::EC2::Route',
        'PublicAssociation': 'AWS::EC2::SubnetRouteTableAssociation',
        'PrivateAssociation': 'AWS::EC2::SubnetRouteTableAssociation',
        'FrontendSecurityGroup': 'AWS::EC2::SecurityGroup', 'BackendSecurityGroup': 'AWS::EC2::SecurityGroup',
        'DatabaseSecurityGroup': 'AWS::EC2::SecurityGroup', 'HttpsIngress': 'AWS::EC2::SecurityGroupIngress',
        'Frontend': 'AWS::EC2::Instance', 'Backend': 'AWS::EC2::Instance', 'Database': 'AWS::EC2::Instance',
    }
    taggable = {'AWS::EC2::VPC', 'AWS::EC2::InternetGateway', 'AWS::EC2::Subnet',
                'AWS::EC2::RouteTable', 'AWS::EC2::SecurityGroup', 'AWS::EC2::Instance'}
    response = aws(request['region'], 'cloudformation', 'list-stack-resources', '--stack-name', stack_id)
    resources = response.get('StackResourceSummaries', [])
    if not resources:
        raise ValueError('El stack no contiene recursos verificables.')
    ids = []
    instances = []
    for resource in resources:
        logical = resource.get('LogicalResourceId')
        kind = resource.get('ResourceType')
        if expected_types.get(logical) != kind:
            raise ValueError('El stack contiene un recurso ajeno a la plantilla autorizada.')
        physical = resource.get('PhysicalResourceId')
        if physical and resource.get('ResourceStatus') != 'DELETE_COMPLETE' and kind in taggable:
            ids.append(physical)
            if kind == 'AWS::EC2::Instance':
                instances.append(physical)
    if instances:
        response = aws(request['region'], 'ec2', 'describe-instances', '--instance-ids', *instances)
        described = [instance for reservation in response.get('Reservations', []) for instance in reservation.get('Instances', [])]
        if {instance['InstanceId'] for instance in described} != set(instances):
            raise ValueError('No se pudieron verificar todas las instancias del stack.')
        for instance in described:
            ids.extend(mapping['Ebs']['VolumeId'] for mapping in instance.get('BlockDeviceMappings', []) if mapping.get('Ebs'))
    if not ids:
        raise ValueError('El stack no contiene recursos etiquetados verificables.')
    tags = aws(request['region'], 'ec2', 'describe-tags', '--filters', 'Name=resource-id,Values=' + ','.join(ids))
    by_resource = {resource_id: {} for resource_id in ids}
    for tag in tags.get('Tags', []):
        if tag.get('ResourceId') in by_resource:
            by_resource[tag['ResourceId']][tag['Key']] = tag['Value']
    if any(any(actual.get(key) != value for key, value in stack_tags(request).items()) for actual in by_resource.values()):
        raise ValueError('Un recurso del stack no tiene todas las etiquetas esperadas; operación cancelada.')


def result_from_stack(request, stack):
    if stack.get('StackStatus') not in ('CREATE_COMPLETE', 'UPDATE_COMPLETE'):
        raise ValueError('El stack no ha terminado correctamente.')
    output = {item['OutputKey']: item['OutputValue'] for item in stack.get('Outputs', [])}
    nodes = {}
    for role in ROLES:
        title = role.capitalize()
        private_ip = str(ipaddress.IPv4Address(output[title + 'PrivateIp']))
        public_ip = str(ipaddress.IPv4Address(output['FrontendPublicIp'])) if role == 'frontend' else None
        nodes[role] = {'instance_id': output[title + 'Id'], 'image_id': request['images'][role]['ami_id'],
                       'private_ip': private_ip, 'public_ip': public_ip}
    return {'schema_version': 1, 'request_id': request['request_id'], 'tenant_slug': request['tenant_slug'],
            'engine': 'cloudformation', 'region': request['region'], 'nodes': nodes,
            'network': {'vpc_id': output['VpcId'], 'subnet_ids': [output['PublicSubnetId'], output['PrivateSubnetId']],
                        'security_group_ids': [output[role.capitalize() + 'SecurityGroupId'] for role in ROLES]},
            'state_reference': {'backend': 'cloudformation', 'key_or_stack': stack['StackId']}}


def verify_instances(request, result):
    nodes = result['nodes']
    ids = [nodes[role]['instance_id'] for role in ROLES]
    if len(set(ids)) != 3:
        raise ValueError('Los roles no corresponden a tres instancias distintas.')
    response = aws(request['region'], 'ec2', 'describe-instances', '--instance-ids', *ids)
    instances = {instance['InstanceId']: instance for reservation in response.get('Reservations', [])
                 for instance in reservation.get('Instances', [])}
    if set(instances) != set(ids):
        raise ValueError('No se pudieron verificar las tres instancias.')
    for role in ROLES:
        node = nodes[role]
        instance = instances[node['instance_id']]
        actual = {tag['Key']: tag['Value'] for tag in instance.get('Tags', [])}
        expected = dict(stack_tags(request), Role=role)
        subnet = result['network']['subnet_ids'][0 if role == 'frontend' else 1]
        if (instance.get('State', {}).get('Name') != 'running'
                or instance.get('VpcId') != result['network']['vpc_id']
                or instance.get('SubnetId') != subnet
                or instance.get('PrivateIpAddress') != node['private_ip']
                or (instance.get('PublicIpAddress') or None) != node['public_ip']
                or instance.get('ImageId') != node['image_id']
                or any(actual.get(key) != value for key, value in expected.items())):
            raise ValueError(f'La identidad, red, AMI o etiquetas de {role} no coinciden.')


def inventory(request, result, key_path):
    if '\n' in key_path or '\r' in key_path:
        raise ValueError('Ruta SSH inválida.')
    slug = request['tenant_slug']
    nodes = result['nodes']
    frontend = nodes['frontend']['public_ip']
    common = {'ansible_user': 'ubuntu', 'ansible_ssh_common_args': '-o StrictHostKeyChecking=accept-new',
              'tenant_slug': slug, 'plan_slug': request['plan_snapshot']['slug'],
              'aws_region': request['region'], 'backend_port': 8000, 'frontend_public_ip': frontend,
              'backend_private_ip': nodes['backend']['private_ip'], 'database_private_ip': nodes['database']['private_ip']}
    if key_path:
        common['ansible_ssh_private_key_file'] = key_path
    proxy = 'ssh -W %h:%p -q -o StrictHostKeyChecking=accept-new'
    if key_path:
        proxy += ' -i ' + shlex.quote(key_path)
    proxy += ' ubuntu@' + frontend
    children = {}
    for role in ROLES:
        node = nodes[role]
        host = {'ansible_host': frontend if role == 'frontend' else node['private_ip'], 'private_ip': node['private_ip']}
        children[role] = {'hosts': {f'{slug}-{role}': host}}
    children['private'] = {'children': {'backend': {}, 'database': {}},
                           'vars': {'ansible_ssh_common_args': '-o StrictHostKeyChecking=accept-new -o ProxyCommand=' + shlex.quote(proxy)}}
    return {'all': {'vars': common, 'children': children}}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['validate', 'create', 'output', 'destroy'])
    parser.add_argument('--tenant', required=True)
    parser.add_argument('--account-id', required=True)
    parser.add_argument('--ssh-cidr')
    parser.add_argument('--ssh-private-key-path', default='')
    parser.add_argument('--enable-https', action='store_true')
    parser.add_argument('--confirm', default='')
    args = parser.parse_args(argv)
    try:
        request, user_data, digest, directory, template = load_request(args.tenant)
        if args.action in ('validate', 'create'):
            if not args.ssh_cidr:
                raise ValueError('Indique --ssh-cidr con la IP pública del operador.')
            cidr = ssh_cidr(args.ssh_cidr)
            scan = scan_handoff(args.tenant)
            if scan['status'] != 'clean' or scan['content_sha256'] != digest:
                raise ValueError('El escaneo bloqueó el paquete o cambió durante la comprobación.')
            zone = preflight(request, args.account_id)
            with tempfile.TemporaryDirectory(prefix='i3-cloudformation-') as tmp:
                template_file = Path(tmp) / 'tenant.yaml'
                template_file.write_bytes(template)
                aws(request['region'], 'cloudformation', 'validate-template', '--template-body', aws_file(template_file))
                if args.action == 'validate':
                    print('Validación y preflight de solo lectura completados; no se crearon recursos.')
                    return 0
                check_account(request['region'], args.account_id)
                tags = [{'Key': key, 'Value': value} for key, value in stack_tags(request).items()]
                owner_path = owner_file(directory)
                owner_path.parent.mkdir(mode=0o700, exist_ok=False)
                param_file = Path(tmp) / 'parameters.json'
                tag_file = Path(tmp) / 'tags.json'
                param_file.write_text(json.dumps(parameters(request, user_data, zone, cidr, args.enable_https)), encoding='utf-8')
                tag_file.write_text(json.dumps(tags), encoding='utf-8')
                created = aws(request['region'], 'cloudformation', 'create-stack', '--stack-name', 'i3-' + args.tenant,
                              '--template-body', aws_file(template_file), '--parameters', aws_file(param_file), '--tags', aws_file(tag_file))
            stack_id = stack_arn(request, args.account_id, created.get('StackId'))
            with owner_path.open('x', encoding='utf-8') as owner:
                json.dump({'account_id': args.account_id, 'request_id': request['request_id'], 'stack_id': stack_id}, owner)
            print('Stack solicitado; esperando resultado de CloudFormation.')
            aws(request['region'], 'cloudformation', 'wait', 'stack-create-complete', '--stack-name', stack_id)
        else:
            check_account(request['region'], args.account_id)
            stack_id = read_owner(directory, request, args.account_id)
        stack = owned_stack(request, stack_id)
        verify_stack_resources(request, stack_id)
        if args.action == 'destroy':
            if args.confirm != args.tenant:
                raise ValueError('Repita el tenant con --confirm para eliminar el stack.')
            check_account(request['region'], args.account_id)
            aws(request['region'], 'cloudformation', 'delete-stack', '--stack-name', stack['StackId'])
            aws(request['region'], 'cloudformation', 'wait', 'stack-delete-complete', '--stack-name', stack['StackId'])
            print('Stack del tenant eliminado.')
            return 0
        result = result_from_stack(request, stack)
        verify_instances(request, result)
        output = owner_file(directory).parent
        files = {'provisioning-result.json': result, 'hosts.yml': inventory(request, result, args.ssh_private_key_path)}
        for name, value in files.items():
            path = output / name
            text = json.dumps(value, indent=2) + '\n'
            if path.exists() or path.is_symlink():
                if path.is_symlink() or path.read_text(encoding='utf-8') != text:
                    raise ValueError(f'La salida {name} ya existe con otro contenido; no se sobrescribió.')
            else:
                with path.open('x', encoding='utf-8') as target:
                    target.write(text)
        print('ProvisioningResult e inventario privado generados para Ansible.')
        return 0
    except (ValueError, RuntimeError, OSError, KeyError) as error:
        print(f'Error: {error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
