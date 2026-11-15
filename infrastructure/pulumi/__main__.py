"""Tenant aislado con tres servidores en AWS, escrito con Pulumi (Python).

Crea la misma arquitectura que las plantillas de CloudFormation y Terraform: una VPC dedicada con una
subred pública (frontend y bastión) y una privada (backend y base de datos), tres grupos de seguridad
encadenados y tres instancias EC2 creadas desde las Golden AMIs del plan elegido.

Las entradas las prepara scripts/pulumi_tenant.py: lee la solicitud validada (request.json y los tres
cloud-init) de TCC_HANDOFF_DIR y no recibe credenciales ni comandos. Las claves privadas nunca entran aquí.
"""
import json
import os
from pathlib import Path

import pulumi
import pulumi_aws as aws

ROLES = ('frontend', 'backend', 'database')
slug = os.environ['TCC_TENANT_SLUG']
handoff = Path(os.environ['TCC_HANDOFF_DIR'])
ssh_cidr = os.environ['TCC_SSH_CIDR']
zone = os.environ['TCC_AVAILABILITY_ZONE']
https = os.environ.get('TCC_ENABLE_HTTPS', 'false') == 'true'
backend_port = int(os.environ.get('TCC_BACKEND_PORT', '8000'))

request = json.loads((handoff / 'request.json').read_text(encoding='utf-8'))
user_data = {role: (handoff / f'{role}.yaml').read_text(encoding='utf-8') for role in ROLES}
plan_roles = request['plan_snapshot']['roles']

# Etiquetas obligatorias del proyecto: permiten verificar la propiedad antes de operar o eliminar.
base_tags = {'Project': 'proyecto-modulo-2', 'MemberId': 'integrante-3', 'TenantId': slug,
             'RunId': request['request_id'], 'ManagedBy': 'pulumi'}


def named(suffix, **extra):
    return {**base_tags, 'Name': f'{slug}-{suffix}', **extra}


# 1. Red: VPC, puerta de enlace a Internet y dos subredes (pública y privada).
vpc = aws.ec2.Vpc('vpc', cidr_block='10.42.0.0/16', enable_dns_support=True, enable_dns_hostnames=True, tags=named('vpc'))
gateway = aws.ec2.InternetGateway('igw', vpc_id=vpc.id, tags=named('igw'))
public_subnet = aws.ec2.Subnet('public', vpc_id=vpc.id, availability_zone=zone, cidr_block='10.42.1.0/24',
                               map_public_ip_on_launch=False, tags=named('public'))
private_subnet = aws.ec2.Subnet('private', vpc_id=vpc.id, availability_zone=zone, cidr_block='10.42.2.0/24',
                                map_public_ip_on_launch=False, tags=named('private'))
public_routes = aws.ec2.RouteTable('public-routes', vpc_id=vpc.id, tags=named('public-routes'))
private_routes = aws.ec2.RouteTable('private-routes', vpc_id=vpc.id, tags=named('private-routes'))
public_route = aws.ec2.Route('public-route', route_table_id=public_routes.id, destination_cidr_block='0.0.0.0/0',
                             gateway_id=gateway.id)
aws.ec2.RouteTableAssociation('public-association', route_table_id=public_routes.id, subnet_id=public_subnet.id)
aws.ec2.RouteTableAssociation('private-association', route_table_id=private_routes.id, subnet_id=private_subnet.id)

# 2. Grupos de seguridad. Todo el tráfico de salida está permitido (como en las otras plantillas); la entrada se limita.
ALL_OUTBOUND = [{'protocol': '-1', 'from_port': 0, 'to_port': 0, 'cidr_blocks': ['0.0.0.0/0']}]
frontend_ingress = [
    {'protocol': 'tcp', 'from_port': 22, 'to_port': 22, 'cidr_blocks': [ssh_cidr], 'description': 'SSH solo desde el operador'},
    {'protocol': 'tcp', 'from_port': 80, 'to_port': 80, 'cidr_blocks': ['0.0.0.0/0'], 'description': 'HTTP publico'},
]
if https:
    frontend_ingress.append({'protocol': 'tcp', 'from_port': 443, 'to_port': 443, 'cidr_blocks': ['0.0.0.0/0'], 'description': 'HTTPS publico'})
frontend_sg = aws.ec2.SecurityGroup('frontend-sg', vpc_id=vpc.id, description='Frontend y bastion del tenant',
                                    ingress=frontend_ingress, egress=ALL_OUTBOUND, tags=named('frontend-sg'))
backend_sg = aws.ec2.SecurityGroup(
    'backend-sg', vpc_id=vpc.id, description='Backend privado del tenant', egress=ALL_OUTBOUND, tags=named('backend-sg'),
    ingress=[
        {'protocol': 'tcp', 'from_port': 22, 'to_port': 22, 'security_groups': [frontend_sg.id], 'description': 'SSH desde el bastion'},
        {'protocol': 'tcp', 'from_port': backend_port, 'to_port': backend_port, 'security_groups': [frontend_sg.id], 'description': 'API desde el frontend'},
    ])
database_sg = aws.ec2.SecurityGroup(
    'database-sg', vpc_id=vpc.id, description='PostgreSQL privado del tenant', egress=ALL_OUTBOUND, tags=named('database-sg'),
    ingress=[
        {'protocol': 'tcp', 'from_port': 22, 'to_port': 22, 'security_groups': [frontend_sg.id], 'description': 'SSH desde el bastion'},
        {'protocol': 'tcp', 'from_port': 5432, 'to_port': 5432, 'security_groups': [backend_sg.id], 'description': 'PostgreSQL solo desde el backend'},
    ])


# 3. Instancias: IMDSv2 obligatorio, disco gp3 cifrado y user-data de cloud-init sin secretos.
def server(role, subnet, group, public, depends=None):
    capacity = plan_roles[role]
    tags = named(role, Role=role)
    return aws.ec2.Instance(
        role, ami=request['images'][role]['ami_id'], instance_type=capacity['instance_type'], key_name=request['key_pair_name'],
        subnet_id=subnet.id, vpc_security_group_ids=[group.id], associate_public_ip_address=public,
        metadata_options={'http_endpoint': 'enabled', 'http_tokens': 'required', 'http_put_response_hop_limit': 1},
        root_block_device={'volume_size': capacity['disk_gib'], 'volume_type': 'gp3', 'encrypted': True, 'delete_on_termination': True},
        user_data=user_data[role], user_data_replace_on_change=False, tags=tags, volume_tags=tags,
        opts=pulumi.ResourceOptions(depends_on=depends or []))


frontend = server('frontend', public_subnet, frontend_sg, True, [public_route])
backend = server('backend', private_subnet, backend_sg, False)
database = server('database', private_subnet, database_sg, False)

# 4. Salidas para scripts/pulumi_tenant.py, que arma el ProvisioningResult con los datos reales de AWS.
pulumi.export('vpc_id', vpc.id)
pulumi.export('public_subnet_id', public_subnet.id)
pulumi.export('private_subnet_id', private_subnet.id)
pulumi.export('frontend_security_group_id', frontend_sg.id)
pulumi.export('backend_security_group_id', backend_sg.id)
pulumi.export('database_security_group_id', database_sg.id)
pulumi.export('frontend_id', frontend.id)
pulumi.export('backend_id', backend.id)
pulumi.export('database_id', database.id)
