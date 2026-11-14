import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
import security_scan


class SecurityScanTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.directory = self.root / 'i3-test'
        self.directory.mkdir()
        for name in security_scan.FILES:
            content = json.dumps({'tenant_slug': 'i3-test', 'engine': 'cloudformation'}) if name == 'request.json' else 'safe content\n'
            (self.directory / name).write_text(content, encoding='utf-8')

    def test_real_scan_clean_and_secret_redacted(self):
        if not shutil.which('trivy'):
            self.skipTest('Trivy no está instalado.')
        clean = security_scan.scan_handoff('i3-test', self.root)
        self.assertEqual(clean['status'], 'clean')
        self.assertIn('infrastructure/cloudformation/tenant.yaml', clean['scope'])
        self.assertEqual([s['scanner'] for s in clean['scanners']], ['trivy', 'checkov', 'cfn-lint'])
        self.assertTrue(all(not f.get('blocking') for f in clean['findings']))
        # Identificador sintético, sin clave ni cuenta asociada.
        secret = 'AKIA' + '4WZ5PTQ1VXM9K3LY'
        (self.directory / 'request.json').write_text(json.dumps({'tenant_slug': 'i3-test', 'engine': 'cloudformation', 'token': secret}), encoding='utf-8')
        found = security_scan.scan_handoff('i3-test', self.root)
        self.assertEqual(found['status'], 'blocked')
        self.assertTrue(any(f.get('blocking') and f.get('scanner') == 'trivy' for f in found['findings']))
        self.assertNotIn(secret, json.dumps(found))
        self.assertNotEqual(clean['content_sha256'], found['content_sha256'])

    def test_postgres_5432_open_to_internet_blocks_deployment_as_critical(self):
        if not shutil.which('trivy'):
            self.skipTest('Trivy no está instalado.')
        bad_cfn = (
            b'Resources:\n'
            b'  DatabaseSecurityGroup:\n'
            b'    Type: AWS::EC2::SecurityGroup\n'
            b'    Properties:\n'
            b'      SecurityGroupIngress:\n'
            b'        - {IpProtocol: tcp, FromPort: 5432, ToPort: 5432, CidrIp: 0.0.0.0/0}\n'
        )
        with patch.object(security_scan, 'infrastructure_snapshot',
                          return_value={'infrastructure/cloudformation/tenant.yaml': bad_cfn}):
            result = security_scan.scan_handoff('i3-test', self.root)
        self.assertEqual(result['status'], 'blocked')
        pg_findings = [f for f in result['findings'] if f['rule_id'] == 'IAC-PG-5432-PUBLIC']
        self.assertEqual(len(pg_findings), 1)
        self.assertEqual(pg_findings[0]['severity'], 'CRITICAL')
        self.assertTrue(pg_findings[0]['blocking'])
        self.assertEqual(pg_findings[0]['scanner'], 'checkov')

    def test_scans_template_as_part_of_snapshot(self):
        if not shutil.which('trivy'):
            self.skipTest('Trivy no está instalado.')
        secret = 'AKIA' + '4WZ5PTQ1VXM9K3LY'
        with patch.object(security_scan, 'infrastructure_snapshot',
                          return_value={'infrastructure/cloudformation/tenant.yaml': f'aws_access_key_id = "{secret}"\n'.encode()}):
            result = security_scan.scan_handoff('i3-test', self.root)
        self.assertEqual(result['status'], 'blocked')
        self.assertNotIn(secret, json.dumps(result))

    def test_scans_primary_motor_configuration(self):
        if not shutil.which('trivy'):
            self.skipTest('Trivy no está instalado.')
        for motor in ('terraform', 'opentofu'):
            with self.subTest(motor=motor):
                (self.directory / 'request.json').write_text(
                    json.dumps({'tenant_slug': 'i3-test', 'engine': motor}), encoding='utf-8')
                result = security_scan.scan_handoff('i3-test', self.root)
                self.assertEqual(result['status'], 'clean')
                self.assertIn(f'infrastructure/{motor}/main.tf', result['scope'])
                self.assertIn('infrastructure/terraform/modules/tenant/main.tf', result['scope'])
                for role in ('frontend', 'backend', 'database'):
                    self.assertIn(f'infrastructure/cloud-init/{role}.yaml.tmpl', result['scope'])

    def test_primary_scan_detects_secret_in_cloud_init_template(self):
        if not shutil.which('trivy'):
            self.skipTest('Trivy no está instalado.')
        infra = self.root / 'infrastructure'
        (infra / 'terraform' / 'modules' / 'tenant' / 'templates').mkdir(parents=True)
        (infra / 'cloud-init').mkdir()
        (infra / 'terraform' / 'main.tf').write_text('# fixture\n', encoding='utf-8')
        (infra / 'terraform' / 'modules' / 'tenant' / 'templates' / 'inventory.tftpl').write_text('# fixture\n', encoding='utf-8')
        secret = 'AKIA' + '4WZ5PTQ1VXM9K3LY'
        for role in ('frontend', 'backend', 'database'):
            data = f'aws_access_key_id = "{secret}"\n' if role == 'backend' else '# fixture\n'
            (infra / 'cloud-init' / f'{role}.yaml.tmpl').write_text(data, encoding='utf-8')
        (self.directory / 'request.json').write_text(json.dumps({'tenant_slug': 'i3-test', 'engine': 'terraform'}), encoding='utf-8')
        with patch.object(security_scan, 'ROOT', self.root):
            result = security_scan.scan_handoff('i3-test', self.root)
        self.assertEqual(result['status'], 'blocked')
        self.assertNotIn(secret, json.dumps(result))

    def test_rejects_bad_scope_and_scanner_failure(self):
        with self.assertRaises(ValueError):
            security_scan.scan_handoff('../otro', self.root, 'trivy')
        (self.directory / 'frontend.yaml').unlink()
        with self.assertRaises(ValueError):
            security_scan.scan_handoff('i3-test', self.root, 'trivy')
        (self.directory / 'frontend.yaml').write_text('safe\n', encoding='utf-8')
        with patch.object(security_scan.subprocess, 'run', side_effect=OSError('secret output')):
            with self.assertRaisesRegex(RuntimeError, 'No se pudo completar'):
                security_scan.scan_handoff('i3-test', self.root, 'trivy')
        result = type('Completed', (), {'returncode': 0, 'stdout': '{}'})()
        with patch.object(security_scan.subprocess, 'run', return_value=result):
            with self.assertRaisesRegex(RuntimeError, 'resultado inválido'):
                security_scan.scan_handoff('i3-test', self.root, 'trivy')


if __name__ == '__main__':
    unittest.main()
