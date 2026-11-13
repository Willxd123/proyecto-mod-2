import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

try:
    import yaml
except ImportError:
    yaml = None

ROOT = Path(__file__).resolve().parent.parent
ANSIBLE = ROOT / 'infrastructure' / 'ansible'


@unittest.skipUnless(yaml, 'Se requiere PyYAML.')
class FrontendContract(unittest.TestCase):
    def test_tenant_playbook_uses_all_roles_in_order(self):
        plays = yaml.safe_load((ANSIBLE / 'configure-tenant.yml').read_text(encoding='utf-8'))
        self.assertEqual(plays[0], {'import_playbook': 'preflight.yml'})
        self.assertEqual(plays[3], {'import_playbook': 'legacy-credentials-check.yml'})
        role_plays = plays[1:3] + plays[4:]
        self.assertEqual(
            [(play['hosts'], play['roles']) for play in role_plays],
            [('database', ['database']), ('backend', ['backend']),
             ('frontend', ['frontend']), ('database', ['postgres_exporter'])],
        )
        self.assertTrue(all(play.get('any_errors_fatal') for play in role_plays))

    def test_frontend_entrypoint_checks_legacy_credentials_before_exposure(self):
        plays = yaml.safe_load((ANSIBLE / 'frontend.yml').read_text(encoding='utf-8'))
        self.assertEqual(plays[0], {'import_playbook': 'preflight.yml'})
        self.assertEqual(plays[1], {'import_playbook': 'legacy-credentials-check.yml'})
        gate = yaml.safe_load((ANSIBLE / 'legacy-credentials-check.yml').read_text(encoding='utf-8'))
        self.assertIn('password_hash IS NULL', gate[0]['tasks'][0]
                      ['community.postgresql.postgresql_query']['query'])
        self.assertIn('== 0', gate[0]['tasks'][1]['ansible.builtin.assert']['that'][0])

    def test_integration_example_contains_required_public_inputs_without_secrets(self):
        variables = yaml.safe_load(
            (ANSIBLE / 'tenant-vars.example.yml').read_text(encoding='utf-8')
        )
        self.assertEqual(variables['frontend_server_name'], '{{ frontend_public_ip }}')
        self.assertTrue({
            'admin_name', 'admin_email', 'certbot_email', 'backend_revision',
            'backend_source_archive', 'backend_wheels_archive', 'frontend_revision',
            'frontend_build_archive', 'frontend_build_sha256',
        }.issubset(variables))
        self.assertFalse(any(key.startswith('vault_') for key in variables))

    def test_certificate_renewal_is_scoped_to_tenant_and_reloads_nginx(self):
        service = (ANSIBLE / 'roles/frontend/templates/service.j2').read_text(encoding='utf-8')
        timer = (ANSIBLE / 'roles/frontend/templates/timer.j2').read_text(encoding='utf-8')
        self.assertIn('renew --cert-name campus-cloud-{{ tenant_slug }}', service)
        self.assertIn('reload nginx', service)
        self.assertIn('00,12:00:00', timer)
        self.assertIn('Persistent=true', timer)

    def test_tls_probe_is_bounded_and_sends_a_closing_request(self):
        tasks = yaml.safe_load(
            (ANSIBLE / 'roles/frontend/tasks/main.yml').read_text(encoding='utf-8')
        )
        task = next(item for item in tasks if item['name'] ==
                    'Verificar cadena y nombre del certificado servido')
        command = task['ansible.builtin.command']
        self.assertEqual(command['argv'][:3], ['timeout', '20', 'openssl'])
        self.assertIn('-verify_ip', command['argv'])
        self.assertIn('-verify_return_error', command['argv'])
        self.assertIn('Connection: close', command['stdin'])

    @unittest.skipUnless(shutil.which('ansible-playbook'), 'Se requiere Ansible en Linux o WSL.')
    def test_certbot_installs_only_when_missing_and_propagates_errors(self):
        tasks = yaml.safe_load(
            (ANSIBLE / 'roles/frontend/tasks/main.yml').read_text(encoding='utf-8')
        )
        with tempfile.TemporaryDirectory(prefix='i4-certbot-install-') as name:
            root = Path(name)
            installed = root / 'certbot'
            calls = root / 'install-called'
            fake_snap = root / 'snap'
            fake_snap.write_text(
                '#!/bin/sh\n'
                'if [ "$1" = version ]; then exit 0; fi\n'
                f'touch "{calls}" "{installed}"\n',
                encoding='utf-8',
            )
            fake_snap.chmod(0o755)
            probe = next(task for task in tasks if task['name'] == 'Detectar Certbot instalado')
            install = next(task for task in tasks if task['name'] ==
                           'Instalar Certbot cuando la imagen no lo incluya')
            probe['ansible.builtin.stat']['path'] = str(installed)
            for task in install['block']:
                task['ansible.builtin.command']['argv'][0] = str(fake_snap)
            playbook = root / 'install.yml'
            playbook.write_text(yaml.safe_dump([{
                'hosts': 'localhost',
                'connection': 'local',
                'gather_facts': False,
                'tasks': [probe, install],
            }]), encoding='utf-8')
            command = ['ansible-playbook', '-i', 'localhost,', str(playbook)]
            env = dict(os.environ, ANSIBLE_NOCOLOR='1')
            first = subprocess.run(command, text=True, capture_output=True, env=env)
            self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
            self.assertTrue(installed.exists())
            self.assertTrue(calls.exists())
            calls.unlink()
            second = subprocess.run(command, text=True, capture_output=True, env=env)
            self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
            self.assertFalse(calls.exists())
            installed.unlink()
            fake_snap.write_text('#!/bin/sh\nexit 1\n', encoding='utf-8')
            failed = subprocess.run(command, text=True, capture_output=True, env=env)
            self.assertNotEqual(failed.returncode, 0)
            self.assertIn('Comprobar que Snap está disponible', failed.stdout)
            self.assertFalse(installed.exists())

    @unittest.skipUnless(shutil.which('ansible-playbook'), 'Se requiere Ansible en Linux o WSL.')
    def test_certbot_version_validation(self):
        tasks = yaml.safe_load(
            (ANSIBLE / 'roles/frontend/tasks/main.yml').read_text(encoding='utf-8')
        )
        assertion = next(task for task in tasks if task['name'] ==
                         'Exigir Certbot compatible con certificados de IP y webroot')
        with tempfile.TemporaryDirectory(prefix='i4-certbot-version-') as name:
            playbook = Path(name) / 'version.yml'
            playbook.write_text(yaml.safe_dump([{
                'hosts': 'localhost',
                'connection': 'local',
                'gather_facts': False,
                'tasks': [assertion],
            }]), encoding='utf-8')
            for version, accepted in [('5.3.0', False), ('5.4.0', True),
                                      ('6.0.0', True), ('4.9.0', False)]:
                with self.subTest(version=version):
                    variables = {'frontend_certbot_version': {'stdout': 'certbot ' + version}}
                    result = subprocess.run(
                        ['ansible-playbook', '-i', 'localhost,', str(playbook),
                         '-e', json.dumps(variables)],
                        text=True, capture_output=True,
                        env=dict(os.environ, ANSIBLE_NOCOLOR='1'),
                    )
                    self.assertEqual(result.returncode == 0, accepted,
                                     result.stdout + result.stderr)

    @unittest.skipUnless(shutil.which('ansible-playbook'), 'Se requiere Ansible en Linux o WSL.')
    def test_input_and_checksum_rejected_before_remote_changes(self):
        with tempfile.TemporaryDirectory(prefix='i4-frontend-test-') as name:
            root = Path(name)
            archive = root / 'build.tar.gz'
            archive.write_bytes(b'test archive')
            playbook = root / 'frontend.yml'
            playbook.write_text(yaml.safe_dump([{
                'hosts': 'localhost',
                'connection': 'local',
                'gather_facts': False,
                'roles': ['frontend'],
            }]), encoding='utf-8')
            variables = {
                'tenant_slug': 'i4-demo',
                'frontend_revision': 'a' * 40,
                'frontend_build_archive': str(archive),
                'frontend_build_sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
                'frontend_server_name': '192.0.2.1',
                'frontend_public_ip': '192.0.2.1',
                'backend_private_ip': '192.0.2.2',
                'backend_port': 8000,
                'certbot_email': 'admin@example.test',
            }
            cases = [
                ({'tenant_slug': '../otro'}, 'Validar entradas del frontend'),
                ({'frontend_server_name': '192.0.2.3'}, 'Validar entradas del frontend'),
                ({'backend_private_ip': '192.0.2.999'}, 'Validar entradas del frontend'),
                ({'backend_port': 65536}, 'Validar entradas del frontend'),
                ({'frontend_build_sha256': '0' * 64}, 'Exigir un artefacto con el checksum esperado'),
            ]
            for overrides, failed_task in cases:
                with self.subTest(overrides=overrides):
                    result = subprocess.run(
                        ['ansible-playbook', '-i', 'localhost,', str(playbook),
                         '-e', json.dumps(dict(variables, **overrides))],
                        text=True, capture_output=True,
                        env=dict(os.environ, ANSIBLE_NOCOLOR='1',
                                 ANSIBLE_ROLES_PATH=str(ANSIBLE / 'roles')),
                    )
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn(failed_task, result.stdout)
                    self.assertNotIn('Crear directorios del frontend', result.stdout)

    @unittest.skipUnless(shutil.which('ansible-playbook'), 'Se requiere Ansible en Linux o WSL.')
    def test_nginx_template_bootstrap_and_tls(self):
        with tempfile.TemporaryDirectory(prefix='i4-nginx-test-') as name:
            root = Path(name)
            template = ANSIBLE / 'roles/frontend/templates/nginx.conf.j2'
            playbook = root / 'render.yml'
            playbook.write_text(yaml.safe_dump([{
                'hosts': 'localhost',
                'connection': 'local',
                'gather_facts': False,
                'tasks': [{'ansible.builtin.template': {
                    'src': str(template), 'dest': str(root / 'nginx.conf'),
                }}],
            }]), encoding='utf-8')
            variables = {'tenant_slug': 'i4-demo', 'frontend_server_name': '192.0.2.1',
                         'backend_private_ip': '192.0.2.2', 'backend_port': 8000}
            for tls in (False, True):
                result = subprocess.run(
                    ['ansible-playbook', '-i', 'localhost,', str(playbook),
                     '-e', json.dumps(dict(variables, frontend_tls_ready=tls))],
                    text=True, capture_output=True, env=dict(os.environ, ANSIBLE_NOCOLOR='1'),
                )
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                config = (root / 'nginx.conf').read_text(encoding='utf-8')
                self.assertIn('/.well-known/acme-challenge/', config)
                if tls:
                    self.assertIn('listen 443 ssl;', config)
                    self.assertIn('proxy_pass http://192.0.2.2:8000;', config)
                    self.assertIn('return 301 https://192.0.2.1$request_uri;', config)
                else:
                    self.assertNotIn('listen 443 ssl;', config)
                    self.assertIn('return 503;', config)


if __name__ == '__main__':
    unittest.main()
