"""Registra targets declarados por el orquestador sin modificar otros tenants."""
import argparse
import ipaddress
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent


def targets_for(tenant, environment, nodes):
    if not re.fullmatch(r'[a-z][a-z0-9-]{2,39}', tenant): raise ValueError('Identificador de tenant inválido.')
    if environment not in ('produccion', 'desarrollo', 'pruebas'): raise ValueError('Entorno inválido.')
    if set(nodes) != {'frontend', 'backend', 'database'}: raise ValueError('Se requieren las direcciones de los tres roles.')
    result = []
    for role, address in nodes.items():
        parsed = ipaddress.ip_address(address)
        target = f'[{parsed}]:9100' if parsed.version == 6 else f'{parsed}:9100'
        result.append({'targets': [target], 'labels': {'tenant': tenant, 'environment': environment, 'role': role, 'scope': 'tenant'}})
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tenant', required=True); parser.add_argument('--environment', default='produccion')
    parser.add_argument('--frontend'); parser.add_argument('--backend'); parser.add_argument('--database')
    parser.add_argument('--remove', action='store_true')
    parser.add_argument('--directory', type=Path, default=ROOT / 'infrastructure/observability/prometheus/targets')
    args = parser.parse_args()
    if not re.fullmatch(r'[a-z][a-z0-9-]{2,39}', args.tenant): parser.error('Tenant inválido.')
    target = args.directory / f'tenant-{args.tenant}.json'
    if args.remove:
        target.unlink(missing_ok=True)
    else:
        try: content = targets_for(args.tenant, args.environment, {role: getattr(args, role) for role in ('frontend', 'backend', 'database')})
        except (ValueError, TypeError) as error: parser.error(str(error))
        args.directory.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix('.tmp')
        temporary.write_text(json.dumps(content, indent=2) + '\n', encoding='utf-8')
        temporary.replace(target)
    print(f'Targets actualizados para {args.tenant}. No se comprobó conectividad.')
