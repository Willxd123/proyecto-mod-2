"""Escanea un paquete de handoff local sin devolver contenido sensible."""
import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILES = ('request.json', 'frontend.yaml', 'backend.yaml', 'database.yaml')
SLUG = re.compile(r'[a-z][a-z0-9-]{2,39}')
RULE = re.compile(r'[A-Za-z0-9_.-]{1,100}')
MAX_FILE_BYTES = 1024 * 1024


def infrastructure_snapshot(engine):
    base = ROOT / 'infrastructure'
    if engine == 'cloudformation':
        paths = [base / 'cloudformation' / 'tenant.yaml']
    elif engine in ('terraform', 'opentofu'):
        engine_dir = base / ('opentofu' if engine == 'opentofu' else 'terraform')
        module = base / 'terraform' / 'modules' / 'tenant'
        paths = (sorted(engine_dir.glob('*.tf')) + sorted(module.glob('*.tf'))
                 + [module / 'templates' / 'inventory.tftpl']
                 + [base / 'cloud-init' / f'{role}.yaml.tmpl' for role in ('frontend', 'backend', 'database')])
    else:
        raise ValueError('El motor no tiene una configuración de infraestructura admitida para escaneo.')
    if not paths:
        raise ValueError('No se encontraron archivos de infraestructura.')
    snapshot = {}
    for path in paths:
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(base.resolve()):
            raise ValueError('Archivo de infraestructura no válido.')
        data = path.read_bytes()
        if len(data) > MAX_FILE_BYTES:
            raise ValueError('Archivo de infraestructura demasiado grande.')
        snapshot[path.relative_to(ROOT).as_posix()] = data
    return snapshot


def update_digest(digest, name, data):
    digest.update(name.encode('ascii') + b'\0' + len(data).to_bytes(8, 'big') + data)


def json_strings(value, label='request'):
    if isinstance(value, dict):
        for key, child in value.items():
            yield from json_strings(child, f'{label}.{key}')
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from json_strings(child, f'{label}.{index}')
    elif isinstance(value, str):
        yield f'{label} = {value}\n'


def scan_handoff(tenant, root=None, executable=None):
    if not isinstance(tenant, str) or not SLUG.fullmatch(tenant):
        raise ValueError('Identificador de tenant inválido.')
    base = Path(root or ROOT / 'output' / 'handoff').resolve(strict=True)
    directory = base / tenant
    if directory.is_symlink() or not directory.is_dir() or directory.resolve().parent != base:
        raise ValueError('No existe un paquete local válido para el tenant.')
    scanner = executable or shutil.which('trivy')
    if not scanner:
        raise RuntimeError('No se encontró Trivy; el escaneo no se ejecutó.')

    digest = hashlib.sha256()
    with tempfile.TemporaryDirectory(prefix='tenant-scan-') as tmp:
        for name in FILES:
            path = directory / name
            if path.is_symlink() or not path.is_file() or path.resolve().parent != directory:
                raise ValueError('El paquete no contiene los cuatro archivos locales requeridos.')
            data = path.read_bytes()
            if len(data) > MAX_FILE_BYTES:
                raise ValueError('El paquete contiene un archivo demasiado grande.')
            update_digest(digest, name, data)
            (Path(tmp) / name).write_bytes(data)
            if name == 'request.json':
                try:
                    request = json.loads(data)
                except (ValueError, UnicodeDecodeError) as error:
                    raise ValueError('La solicitud no es JSON válido.') from error
                if not isinstance(request, dict) or request.get('tenant_slug') != tenant:
                    raise ValueError('La solicitud no corresponde al tenant indicado.')
                (Path(tmp) / 'request-values.txt').write_text(
                    ''.join(json_strings(request)), encoding='utf-8')
        infrastructure = infrastructure_snapshot(request.get('engine'))
        for name, data in infrastructure.items():
            update_digest(digest, name, data)
            target = Path(tmp) / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        try:
            result = subprocess.run(
                [scanner, 'fs', '--quiet', '--offline-scan', '--disable-telemetry', '--skip-version-check',
                 '--config', '', '--ignorefile', '', '--scanners', 'secret', '--format', 'json',
                 '--secret-config', '', tmp],
                capture_output=True, text=True, timeout=120, check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise RuntimeError('No se pudo completar el escaneo de seguridad.') from error
        if result.returncode != 0:
            raise RuntimeError('Trivy falló; no se considera seguro el paquete.')
        try:
            report = json.loads(result.stdout)
            if (not isinstance(report, dict) or report.get('SchemaVersion') != 2
                    or report.get('ArtifactType') != 'filesystem'
                    or not isinstance(report.get('Results', []), list)):
                raise ValueError('Formato inválido.')
            findings = []
            for item in report.get('Results', []):
                if not isinstance(item, dict) or not isinstance(item.get('Secrets', []), list):
                    raise ValueError('Formato inválido.')
                for secret in item.get('Secrets', []):
                    if not isinstance(secret, dict):
                        raise ValueError('Formato inválido.')
                    rule = secret.get('RuleID')
                    severity = secret.get('Severity')
                    if not isinstance(rule, str) or not RULE.fullmatch(rule):
                        raise ValueError('Regla inválida.')
                    if severity not in ('UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'):
                        raise ValueError('Severidad inválida.')
                    findings.append({'rule_id': rule, 'severity': severity})
        except (ValueError, TypeError) as error:
            raise RuntimeError('Trivy devolvió un resultado inválido.') from error
    return {
        'schema_version': 1,
        'tenant_slug': tenant,
        'scanner': 'trivy',
        'scope': list(FILES) + list(infrastructure),
        'content_sha256': digest.hexdigest(),
        'status': 'blocked' if findings else 'clean',
        'findings': findings,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tenant', required=True)
    args = parser.parse_args(argv)
    try:
        result = scan_handoff(args.tenant)
        print(json.dumps(result, ensure_ascii=True))
        return 1 if result['status'] == 'blocked' else 0
    except (ValueError, RuntimeError, OSError) as error:
        print(f'Error: {error}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
