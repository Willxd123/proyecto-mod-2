"""Exporta un contrato de despliegue y user-data para los motores; no crea recursos."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import uuid
from render_cloud_init import read_key_file, render

ROOT = Path(__file__).resolve().parent.parent
ROLES = ('frontend', 'backend', 'database')


def prepare(tenant, name, email, plan_slug, region, engine, key_name, registry, contract_only=False, request_id=None):
    render(tenant, 'frontend')
    if not name.strip() or len(name) > 120: raise ValueError('Nombre de institución requerido, máximo 120 caracteres.')
    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email): raise ValueError('Correo de contacto inválido.')
    if engine not in ('terraform', 'opentofu', 'pulumi', 'cloudformation'): raise ValueError('Motor no permitido.')
    if not re.fullmatch(r'[a-z]{2}(?:-[a-z]+)+-\d', region): raise ValueError('Región inválida.')
    if not re.fullmatch(r'[a-zA-Z0-9._-]{1,255}', key_name): raise ValueError('Nombre de key pair inválido.')
    catalog = json.loads((ROOT / 'config/plans.json').read_text(encoding='utf-8'))
    plan = next((item for item in catalog['plans'] if item['slug'] == plan_slug), None)
    if not plan: raise ValueError('Plan inexistente.')
    selected = {}
    for image in registry['images']:
        if image['region'] != region: continue
        if image['role'] not in ROLES or image['role'] in selected: raise ValueError('Rol inválido o duplicado en el registro de imágenes.')
        if not re.fullmatch(r'ami-[a-f0-9]{17}', image['ami_id']): raise ValueError('AMI inválida.')
        selected[image['role']] = image
    ready = set(selected) == set(ROLES)
    if not ready and not contract_only: raise ValueError('Faltan imágenes reales de la región. Use --contract-only solo para preparar la integración.')
    request_id = str(request_id or uuid.uuid4())
    if not re.fullmatch(r'[A-Za-z0-9-]{1,64}', request_id): raise ValueError('request_id inválido.')
    return dict(schema_version=1, request_id=request_id, tenant_slug=tenant, institution_name=name.strip(), admin_email=email,
                provider='aws', region=region, environment='produccion', engine=engine, key_pair_name=key_name,
                deployable=ready and not contract_only, generated_at=datetime.now(timezone.utc).isoformat(),
                plan_snapshot=dict(plan, catalog_version=catalog['catalog_version']),
                images=selected, user_data={role: f'{role}.yaml' for role in ROLES})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for field in ('tenant', 'name', 'email', 'plan', 'engine', 'key-name'): parser.add_argument('--' + field, required=True)
    parser.add_argument('--region', default='us-east-1'); parser.add_argument('--contract-only', action='store_true')
    parser.add_argument('--registry', type=Path, default=ROOT / 'config/golden-images.local.json')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--ssh-public-key-file', type=Path, help='Archivo .pub; se inyecta en el user-data (nunca la llave privada).')
    args = parser.parse_args()
    try:
        keys = read_key_file(args.ssh_public_key_file) if args.ssh_public_key_file else []
        registry = json.loads(args.registry.read_text(encoding='utf-8')) if args.registry.exists() else {'images': []}
        request = prepare(args.tenant, args.name, args.email, args.plan, args.region, args.engine, args.key_name, registry, args.contract_only)
        directory = args.output or ROOT / 'output/handoff' / args.tenant
        # No sobrescribir una solicitud anterior: la copia del plan debe ser inmutable.
        directory.mkdir(parents=True, exist_ok=False)
        for role in ROLES: (directory / f'{role}.yaml').write_text(render(args.tenant, role, keys), encoding='utf-8', newline='\n')
        (directory / 'request.json').write_text(json.dumps(request, indent=2) + '\n', encoding='utf-8')
        print(f'Contrato generado en {directory}; deployable={request["deployable"]}. No se ejecutó IaC.')
    except (ValueError, KeyError, OSError) as error: parser.exit(2, f'{error}\n')
