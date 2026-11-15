"""Escanea un paquete de handoff local con 3 escáneres (Trivy, Checkov y cfn-lint) sin devolver contenido sensible."""
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
SEVERITIES = ('UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL')
SCANNERS = ('trivy', 'checkov', 'cfn-lint')
MAX_FILE_BYTES = 1024 * 1024
_INFRA_SCAN_CACHE = {}

CHECKOV_RULES = {
    'CKV_AWS_23': ('LOW', 'Regla de Security Group sin descripción explícita (advertencia informativa).'),
    'CKV_AWS_24': ('MEDIUM', 'Regla SSH evaluada estáticamente en módulo parametrizado (advertencia informativa).'),
    'CKV_AWS_260': ('MEDIUM', 'Puerto 80 abierto en Frontend para validación HTTP-01 de Certbot (advertencia informativa).'),
    'CKV_AWS_88': ('MEDIUM', 'Instancia Frontend con IP pública para acceso web y bastión SSH (advertencia informativa).'),
    'CKV_AWS_126': ('LOW', 'Monitoreo detallado de EC2 deshabilitado en plan de laboratorio (advertencia informativa).'),
    'CKV_AWS_135': ('LOW', 'Optimización EBS no forzada en instancias t3 de laboratorio (advertencia informativa).'),
    'CKV2_AWS_11': ('MEDIUM', 'VPC sin Flow Logs habilitados en entorno de laboratorio (advertencia informativa).'),
    'CKV2_AWS_41': ('LOW', 'Instancia EC2 sin rol IAM adjunto (advertencia informativa).'),
}

TRIVY_MISCONFIG_MESSAGES = {
    'AWS-0124': 'Regla de Security Group sin descripción de auditoría (advertencia informativa).',
    'AVD-AWS-0124': 'Regla de Security Group sin descripción de auditoría (advertencia informativa).',
    'AWS-0178': 'VPC sin Flow Logs de CloudWatch habilitados (advertencia informativa).',
    'AVD-AWS-0178': 'VPC sin Flow Logs de CloudWatch habilitados (advertencia informativa).',
    'AWS-0104': 'Regla de salida o red amplia detectada en plantilla IaC.',
    'AVD-AWS-0104': 'Regla de salida o red amplia detectada en plantilla IaC.',
}


def sanitize_message(text, fallback='Hallazgo detectado durante el análisis estático.'):
    if not isinstance(text, str):
        return fallback
    cleaned = re.sub(r'[\x00-\x1f\x7f]+', ' ', text).strip()
    return (cleaned[:190] if cleaned else fallback)


def infrastructure_snapshot(engine):
    base = ROOT / 'infrastructure'
    if engine == 'cloudformation':
        paths = [base / 'cloudformation' / 'tenant.yaml']
    elif engine == 'pulumi':
        paths = ([base / 'pulumi' / name for name in ('__main__.py', 'Pulumi.yaml', 'requirements.txt')]
                 + [base / 'cloud-init' / f'{role}.yaml.tmpl' for role in ('frontend', 'backend', 'database')])
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


def detect_postgres_5432_exposure(infrastructure):
    """Regla crítica de la guía: verificar que el puerto 5432 no esté abierto a 0.0.0.0/0 ni ::/0."""
    for name, raw in infrastructure.items():
        if not name.endswith(('.yaml', '.yml', '.tf', '.py')):
            continue
        lines = [line for line in raw.decode('utf-8', errors='ignore').splitlines()
                 if not line.lstrip().startswith('#')]
        text = '\n'.join(lines)
        for line in lines:
            if '5432' in line and ('0.0.0.0/0' in line or '::/0' in line):
                return True
        if name.endswith(('.yaml', '.yml')):
            for block in re.split(r'(?m)^  [A-Za-z0-9_]+:\s*$', text):
                if ('AWS::EC2::SecurityGroup' in block or 'SecurityGroupIngress' in block) \
                        and '5432' in block and ('0.0.0.0/0' in block or '::/0' in block):
                    return True
        elif name.endswith('.tf'):
            for match in re.finditer(r'resource\s+"aws_(?:vpc_)?security_group[^"]*"\s+"[^"]+"\s*\{([^}]*)\}', text, re.S):
                block = match.group(1)
                if '5432' in block and ('0.0.0.0/0' in block or '::/0' in block):
                    return True
        elif name.endswith('.py'):
            for match in re.finditer(r'\{[^{}]*\}', text, re.S):
                block = match.group(0)
                if '5432' in block and ('0.0.0.0/0' in block or '::/0' in block):
                    return True
    return False


def run_checkov_scan(engine, tmp_dir, infrastructure, infra_digest):
    findings = []
    if detect_postgres_5432_exposure(infrastructure):
        findings.append({
            'rule_id': 'IAC-PG-5432-PUBLIC',
            'severity': 'CRITICAL',
            'scanner': 'checkov',
            'category': 'misconfig',
            'blocking': True,
            'message': 'CRÍTICO: El puerto 5432 de PostgreSQL está abierto a 0.0.0.0/0; debe permanecer privado.',
        })

    if engine == 'cloudformation':
        rel_keys = [k for k in sorted(infrastructure) if k.endswith(('.yaml', '.yml'))]
    else:
        module_keys = [k for k in sorted(infrastructure) if k.startswith('infrastructure/terraform/modules/tenant/') and k.endswith('.tf')]
        rel_keys = module_keys or [k for k in sorted(infrastructure) if k.endswith('.tf')]
    target_digest = hashlib.sha256()
    for key in rel_keys:
        update_digest(target_digest, key, infrastructure[key])
    cache_key = ('checkov', target_digest.hexdigest())
    if cache_key in _INFRA_SCAN_CACHE:
        return findings + list(_INFRA_SCAN_CACHE[cache_key])

    checkov_bin = shutil.which('checkov')
    extra = []
    if checkov_bin and rel_keys:
        try:
            if engine == 'cloudformation':
                target = Path(tmp_dir) / 'infrastructure' / 'cloudformation' / 'tenant.yaml'
                cmd = [checkov_bin, '-f', str(target), '--framework', 'cloudformation',
                       '--quiet', '--compact', '--skip-download', '-o', 'json']
            else:
                module_dir = Path(tmp_dir) / 'infrastructure' / 'terraform' / 'modules' / 'tenant'
                target = module_dir if any(module_dir.glob('*.tf')) else (Path(tmp_dir) / 'infrastructure')
                cmd = [checkov_bin, '-d', str(target), '--framework', 'terraform',
                       '--quiet', '--compact', '--skip-download', '-o', 'json']
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60, check=False)
            if proc.stdout and proc.stdout.strip().startswith(('{', '[')):
                parsed = json.loads(proc.stdout)
                reports = parsed if isinstance(parsed, list) else [parsed]
                seen = set()
                for report in reports:
                    if not isinstance(report, dict):
                        continue
                    failed = (report.get('results') or {}).get('failed_checks') or []
                    for item in failed:
                        if not isinstance(item, dict):
                            continue
                        rule_id = item.get('check_id')
                        if not isinstance(rule_id, str) or not RULE.fullmatch(rule_id) or rule_id in seen:
                            continue
                        seen.add(rule_id)
                        raw_sev = str(item.get('severity') or '').upper()
                        if raw_sev in SEVERITIES:
                            severity = raw_sev
                            default_msg = sanitize_message(item.get('check_name'), f'Revisión IaC Checkov ({rule_id}).')
                        elif rule_id in CHECKOV_RULES:
                            severity, default_msg = CHECKOV_RULES[rule_id]
                        else:
                            severity = 'MEDIUM'
                            default_msg = sanitize_message(
                                f"{item.get('check_name') or rule_id} (advertencia informativa).",
                                f'Advertencia IaC Checkov ({rule_id}).')
                        is_blocking = severity == 'CRITICAL'
                        extra.append({
                            'rule_id': rule_id,
                            'severity': severity,
                            'scanner': 'checkov',
                            'category': 'misconfig',
                            'blocking': is_blocking,
                            'message': default_msg,
                        })
        except (OSError, subprocess.TimeoutExpired, ValueError, TypeError):
            pass

    _INFRA_SCAN_CACHE[cache_key] = tuple(extra)
    return findings + extra


def run_cfn_lint_scan(engine, tmp_dir, infra_digest):
    if engine != 'cloudformation':
        return []
    cache_key = ('cfn-lint', engine, infra_digest)
    if cache_key in _INFRA_SCAN_CACHE:
        return list(_INFRA_SCAN_CACHE[cache_key])

    cfn_lint_bin = shutil.which('cfn-lint')
    findings = []
    if cfn_lint_bin:
        try:
            target = Path(tmp_dir) / 'infrastructure' / 'cloudformation' / 'tenant.yaml'
            proc = subprocess.run([cfn_lint_bin, '-f', 'json', str(target)],
                                  capture_output=True, text=True, timeout=45, check=False)
            if proc.stdout and proc.stdout.strip().startswith('['):
                items = json.loads(proc.stdout)
                seen = set()
                if isinstance(items, list):
                    for item in items:
                        if not isinstance(item, dict):
                            continue
                        rule = (item.get('Rule') or {}).get('Id')
                        if not isinstance(rule, str) or not RULE.fullmatch(rule) or rule in seen:
                            continue
                        seen.add(rule)
                        is_error = rule.startswith('E')
                        severity = 'CRITICAL' if is_error else ('MEDIUM' if rule.startswith('W') else 'LOW')
                        msg = sanitize_message(item.get('Message'), f'Validación de plantilla CloudFormation ({rule}).')
                        findings.append({
                            'rule_id': rule,
                            'severity': severity,
                            'scanner': 'cfn-lint',
                            'category': 'lint',
                            'blocking': is_error,
                            'message': msg,
                        })
        except (OSError, subprocess.TimeoutExpired, ValueError, TypeError):
            pass

    _INFRA_SCAN_CACHE[cache_key] = tuple(findings)
    return findings


def build_scanners_summary(findings, engine):
    definitions = [
        ('trivy', 'Trivy Secret Scanner (Credenciales y Secretos)'),
        ('checkov', 'Checkov IaC & Regla Puerto 5432 (Políticas Cloud)'),
        ('cfn-lint', 'Trivy Config & cfn-lint (Configuración y Plantillas IaC)'
         if engine == 'cloudformation' else 'Trivy Config IaC (Configuración Terraform/OpenTofu)'),
    ]
    summaries = []
    for scanner_id, label in definitions:
        scoped = [f for f in findings if f.get('scanner') == scanner_id]
        blocking_count = sum(1 for f in scoped if f.get('blocking'))
        warning_count = sum(1 for f in scoped if not f.get('blocking'))
        if blocking_count > 0:
            status = 'blocked'
            if scanner_id == 'trivy':
                message = f'Se detectaron {blocking_count} secreto(s) o credencial(es) expuesta(s). Despliegue bloqueado.'
            else:
                message = f'Se detectaron {blocking_count} error(es) CRITICAL de configuración IaC. Despliegue bloqueado.'
        elif warning_count > 0:
            status = 'warning'
            message = f'Sin errores CRITICAL ({warning_count} advertencia(s) informativa(s) HIGH/MEDIUM/LOW que no detienen el despliegue).'
        else:
            status = 'clean'
            if scanner_id == 'trivy':
                message = '0 secretos ni credenciales expuestas en solicitud y plantillas.'
            elif scanner_id == 'checkov':
                message = 'Políticas IaC verificadas y puerto 5432 aislado de Internet (0 errores críticos).'
            else:
                message = 'Sintaxis y configuración de plantillas IaC verificadas sin errores.'
        summaries.append({
            'scanner': scanner_id,
            'label': label,
            'status': status,
            'blocking_count': blocking_count,
            'warning_count': warning_count,
            'message': message,
        })
    return summaries


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
    infra_digest = hashlib.sha256()
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
        engine = request.get('engine')
        infrastructure = infrastructure_snapshot(engine)
        for name, data in infrastructure.items():
            update_digest(digest, name, data)
            update_digest(infra_digest, name, data)
            target = Path(tmp) / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        try:
            result = subprocess.run(
                [scanner, 'fs', '--quiet', '--offline-scan', '--disable-telemetry', '--skip-version-check',
                 '--config', '', '--ignorefile', '', '--scanners', 'secret,misconfig', '--format', 'json',
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
            seen_misconfigs = set()
            for item in report.get('Results', []):
                if not isinstance(item, dict):
                    raise ValueError('Formato inválido.')
                secrets = item.get('Secrets', [])
                if secrets is not None and not isinstance(secrets, list):
                    raise ValueError('Formato inválido.')
                for secret in secrets or []:
                    if not isinstance(secret, dict):
                        raise ValueError('Formato inválido.')
                    rule = secret.get('RuleID')
                    severity = secret.get('Severity')
                    if not isinstance(rule, str) or not RULE.fullmatch(rule):
                        raise ValueError('Regla inválida.')
                    if severity not in SEVERITIES:
                        raise ValueError('Severidad inválida.')
                    findings.append({
                        'rule_id': rule,
                        'severity': severity,
                        'scanner': 'trivy',
                        'category': 'secret',
                        'blocking': True,
                        'message': sanitize_message(
                            f"Credencial o secreto expuesto detectado por Trivy ({secret.get('Title') or rule}). Bloquea el despliegue.",
                            f'Secreto expuesto detectado ({rule}).'),
                    })
                misconfigs = item.get('Misconfigurations', [])
                if misconfigs is not None and not isinstance(misconfigs, list):
                    raise ValueError('Formato inválido.')
                for misconfig in misconfigs or []:
                    if not isinstance(misconfig, dict):
                        raise ValueError('Formato inválido.')
                    if misconfig.get('Status') and misconfig.get('Status') != 'FAIL':
                        continue
                    rule = misconfig.get('ID') or misconfig.get('AVDID')
                    severity = misconfig.get('Severity')
                    if not isinstance(rule, str) or not RULE.fullmatch(rule):
                        raise ValueError('Regla inválida.')
                    if severity not in SEVERITIES:
                        raise ValueError('Severidad inválida.')
                    if rule in seen_misconfigs:
                        continue
                    seen_misconfigs.add(rule)
                    is_blocking = severity == 'CRITICAL'
                    default_title = misconfig.get('Title') or f'Configuración IaC ({rule})'
                    msg = TRIVY_MISCONFIG_MESSAGES.get(
                        rule,
                        sanitize_message(
                            f"{default_title} ({'bloqueante' if is_blocking else 'advertencia informativa'}).",
                            f'Hallazgo de configuración IaC ({rule}).'))
                    findings.append({
                        'rule_id': rule,
                        'severity': severity,
                        'scanner': 'cfn-lint',
                        'category': 'misconfig',
                        'blocking': is_blocking,
                        'message': msg,
                    })
        except (ValueError, TypeError) as error:
            raise RuntimeError('Trivy devolvió un resultado inválido.') from error

        if executable is None:
            infra_hex = infra_digest.hexdigest()
            findings.extend(run_checkov_scan(engine, tmp, infrastructure, infra_hex))
            findings.extend(run_cfn_lint_scan(engine, tmp, infra_hex))
        elif detect_postgres_5432_exposure(infrastructure):
            findings.append({
                'rule_id': 'IAC-PG-5432-PUBLIC',
                'severity': 'CRITICAL',
                'scanner': 'checkov',
                'category': 'misconfig',
                'blocking': True,
                'message': 'CRÍTICO: El puerto 5432 de PostgreSQL está abierto a 0.0.0.0/0; debe permanecer privado.',
            })

    scanners = build_scanners_summary(findings, engine)
    has_blocking = any(f.get('blocking') for f in findings)
    return {
        'schema_version': 1,
        'tenant_slug': tenant,
        'scanner': 'trivy',
        'scanners': scanners,
        'scope': list(FILES) + list(infrastructure),
        'content_sha256': digest.hexdigest(),
        'status': 'blocked' if has_blocking else 'clean',
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
