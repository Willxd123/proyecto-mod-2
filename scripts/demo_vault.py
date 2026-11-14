"""Secretos locales de la demostración, cifrados con Ansible Vault en Linux/WSL."""
import argparse
import base64
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys

SLUG = re.compile(r'[a-z][a-z0-9-]{2,39}\Z')
ROOT = Path.home() / '.local' / 'share' / 'tenant-control-center-demo'


def private_directory(path):
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.is_symlink() or not path.is_dir() or path.stat().st_uid != os.getuid() or path.stat().st_mode & 0o077:
        raise ValueError('El directorio privado no pertenece al usuario o tiene permisos demasiado amplios.')


def private_file(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_uid != os.getuid() or path.stat().st_mode & 0o077:
        raise ValueError('El archivo privado no pertenece al usuario o tiene permisos demasiado amplios.')


def locations(slug):
    if not isinstance(slug, str) or not SLUG.fullmatch(slug):
        raise ValueError('Identificador de tenant inválido.')
    if os.name != 'posix':
        raise ValueError('Los secretos locales requieren Linux o WSL.')
    if ROOT.resolve().is_relative_to(Path(__file__).resolve().parent.parent):
        raise ValueError('El directorio privado no puede estar dentro del repositorio.')
    private_directory(ROOT)
    keys, vaults = ROOT / 'keys', ROOT / 'vaults'
    private_directory(keys)
    private_directory(vaults)
    return keys / f'{slug}.key', vaults / f'{slug}.vault'


def write_new(path, data):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    completed = False
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(data)
        completed = True
    finally:
        if not completed:
            path.unlink()


def run_vault(arguments, input_data=None):
    try:
        result = subprocess.run(['ansible-vault', *arguments], input=input_data,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise RuntimeError('No se pudo ejecutar Ansible Vault.') from error
    if result.returncode:
        raise RuntimeError('Ansible Vault falló; revise la instalación y los archivos privados.')
    return result.stdout


def create(slug):
    key, vault = locations(slug)
    values = {
        'vault_postgres_password': secrets.token_urlsafe(32),
        'vault_django_secret_key': secrets.token_urlsafe(48),
        'vault_student_initial_passwords_key': base64.urlsafe_b64encode(secrets.token_bytes(32)).decode('ascii'),
        'vault_admin_password': secrets.token_urlsafe(24),
    }
    write_new(key, (secrets.token_urlsafe(48) + '\n').encode())
    completed = False
    try:
        encrypted = run_vault(['encrypt', '--vault-password-file', str(key), '--output', '-', '-'],
                              json.dumps(values).encode())
        if not encrypted.startswith(b'$ANSIBLE_VAULT;'):
            raise RuntimeError('Ansible Vault no devolvió un archivo cifrado válido.')
        write_new(vault, encrypted)
        completed = True
    finally:
        if not completed:
            key.unlink()
    return key, vault


def admin_password(slug):
    key, vault = locations(slug)
    private_file(key)
    private_file(vault)
    data = run_vault(['view', '--vault-password-file', str(key), str(vault)])
    try:
        result = json.loads(data)
        password = result['vault_admin_password']
        if not isinstance(password, str) or len(password) < 12 or '\n' in password or '\r' in password:
            raise ValueError('Contraseña inválida.')
        return password
    except (ValueError, KeyError, TypeError) as error:
        raise ValueError('El archivo Vault no contiene credenciales válidas.') from error


def stage(slug, value):
    if not isinstance(value, dict) or set(value) != {'inventory', 'variables'}:
        raise ValueError('Datos privados de Ansible inválidos.')
    inventory = Path(value['inventory'])
    if inventory.is_symlink():
        raise ValueError('Inventario privado inválido.')
    inventory = inventory.resolve(strict=True)
    if not inventory.is_file() or inventory.stat().st_size > 1024 * 1024:
        raise ValueError('Inventario privado inválido.')
    variables = value['variables']
    required = {
        'tenant_slug', 'admin_name', 'admin_email', 'certbot_email', 'institution_name', 'tenant_plan_name',
        'backend_revision', 'backend_source_archive', 'backend_wheels_archive', 'frontend_revision',
        'frontend_build_archive', 'frontend_build_sha256', 'frontend_server_name', 'frontend_public_ip',
        'backend_private_ip', 'database_private_ip', 'backend_port', 'postgresql_psycopg_deb',
    }
    if not isinstance(variables, dict) or set(variables) != required or variables.get('tenant_slug') != slug:
        raise ValueError('Variables públicas de Ansible inválidas.')
    if (variables['frontend_server_name'] != variables['frontend_public_ip']
            or not re.fullmatch(r'(?:\d{1,3}\.){3}\d{1,3}', str(variables['frontend_public_ip']))
            or not re.fullmatch(r'(?:\d{1,3}\.){3}\d{1,3}', str(variables['backend_private_ip']))
            or not re.fullmatch(r'(?:\d{1,3}\.){3}\d{1,3}', str(variables['database_private_ip']))
            or type(variables['backend_port']) is not int or not 1 <= variables['backend_port'] <= 65535):
        raise ValueError('Direcciones o puerto de Ansible inválidos.')
    for field in ('backend_revision', 'frontend_revision'):
        if not isinstance(variables[field], str) or not re.fullmatch(r'[a-f0-9]{40}', variables[field]):
            raise ValueError('Revisión de aplicación inválida.')
    if not isinstance(variables['frontend_build_sha256'], str) or not re.fullmatch(r'[a-f0-9]{64}', variables['frontend_build_sha256']):
        raise ValueError('Checksum del frontend inválido.')
    for field in ('backend_source_archive', 'backend_wheels_archive', 'frontend_build_archive', 'postgresql_psycopg_deb'):
        path = Path(variables[field])
        if not path.is_absolute() or path.is_symlink() or not path.is_file():
            raise ValueError('Falta un artefacto local requerido.')
    tenant_dir = ROOT / 'tenants' / slug
    private_directory(tenant_dir.parent)
    tenant_dir.mkdir(mode=0o700, exist_ok=True)
    if tenant_dir.is_symlink() or tenant_dir.stat().st_mode & 0o077:
        raise ValueError('Directorio privado de Ansible inseguro.')
    key, vault = locations(slug)
    private_file(key)
    private_file(vault)
    paths = {
        'inventory': tenant_dir / 'inventory.yml',
        'variables': tenant_dir / 'tenant-vars.json',
    }
    for path in paths.values():
        if path.exists() or path.is_symlink():
            raise FileExistsError('Ya existe una preparación privada para este tenant.')
    write_new(paths['inventory'], inventory.read_bytes())
    try:
        write_new(paths['variables'], (json.dumps(variables, indent=2) + '\n').encode())
    except Exception:
        paths['inventory'].unlink()
        raise
    return tenant_dir


def tenant_paths(slug):
    directory = ROOT / 'tenants' / slug
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError('No existe una preparación privada para este tenant.')
    return {
        'inventory': str(directory / 'inventory.yml'),
        'variables': str(directory / 'tenant-vars.json'),
        'vault': str(ROOT / 'vaults' / f'{slug}.vault'),
        'vault_password_file': str(ROOT / 'keys' / f'{slug}.key'),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['create', 'stage', 'paths', 'reveal'])
    parser.add_argument('--tenant', required=True)
    args = parser.parse_args()
    try:
        if args.action == 'create':
            create(args.tenant)
            print('Vault local creado. No se imprimieron secretos.')
        elif args.action == 'stage':
            stage(args.tenant, json.load(sys.stdin))
            print('Variables e inventario preparados en almacenamiento privado.')
        elif args.action == 'paths':
            print(json.dumps(tenant_paths(args.tenant)))
        else:
            print(json.dumps({'password': admin_password(args.tenant)}))
    except (ValueError, RuntimeError, OSError) as error:
        print(f'Error: {error}', file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
