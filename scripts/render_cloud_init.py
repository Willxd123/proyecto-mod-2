"""Genera user-data (hostname por tenant, zona horaria, swap 2 GiB y llaves SSH públicas) sin credenciales ni comandos de nube."""
import argparse
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent
PUBLIC_KEY = re.compile(r'(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)) [A-Za-z0-9+/]+={0,3}(?: [A-Za-z0-9_.@-]{1,64})?')


def validate_public_key(key):
    key = key.strip()
    if not PUBLIC_KEY.fullmatch(key):
        raise ValueError('Solo se aceptan llaves SSH públicas (ssh-ed25519, ssh-rsa o ecdsa) en una línea.')
    return key


def render(tenant_slug, role, ssh_public_keys=()):
    if not re.fullmatch(r'[a-z][a-z0-9-]{2,39}', tenant_slug):
        raise ValueError('Tenant: 3 a 40 letras minúsculas, números o guiones; comenzar con letra.')
    if role not in ('frontend', 'backend', 'database'):
        raise ValueError('Rol no permitido.')
    keys = [validate_public_key(key) for key in ssh_public_keys]
    # JSON es un escalar YAML válido y evita interpolar texto sin comillas.
    # cloud-init exige al menos una llave: sin llaves se omite la clave (una lista vacía degrada el arranque).
    block = 'ssh_authorized_keys:\n' + '\n'.join(f'  - {json.dumps(key)}' for key in keys) + '\n' if keys else ''
    template = ROOT / 'infrastructure/cloud-init' / f'{role}.yaml.tmpl'
    return template.read_text(encoding='utf-8').replace('__TENANT_SLUG__', tenant_slug).replace('__SSH_AUTHORIZED_KEYS__\n', block)


def read_key_file(path):
    keys = [line.strip() for line in Path(path).read_text(encoding='utf-8').splitlines() if line.strip() and not line.startswith('#')]
    if not keys:
        raise ValueError('El archivo no contiene llaves públicas.')
    return keys


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tenant', required=True)
    parser.add_argument('--role', required=True, choices=['frontend', 'backend', 'database'])
    parser.add_argument('--ssh-public-key', action='append', default=[], help='Llave pública SSH; puede repetirse.')
    parser.add_argument('--ssh-public-key-file', type=Path, help='Archivo .pub con una llave por línea (nunca la llave privada).')
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    try:
        keys = list(args.ssh_public_key) + (read_key_file(args.ssh_public_key_file) if args.ssh_public_key_file else [])
        if not keys:
            raise ValueError('Indique al menos una llave pública con --ssh-public-key o --ssh-public-key-file.')
        content = render(args.tenant, args.role, keys)
    except (ValueError, OSError) as error:
        parser.error(str(error))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(content, encoding='utf-8', newline='\n')
    print(f'User-data generado: {args.output}')
