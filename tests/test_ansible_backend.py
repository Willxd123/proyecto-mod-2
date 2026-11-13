import json
import os
import shutil
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

try:
    import yaml
except ImportError:
    yaml = None

ROOT = Path(__file__).resolve().parent.parent


@unittest.skipUnless(yaml and shutil.which('ansible-playbook'), 'Se requieren PyYAML y Ansible en Linux o WSL.')
class BackendRoleValidation(unittest.TestCase):
    def test_tenant_identity_probe_accepts_only_matching_identity(self):
        tasks = yaml.safe_load(
            (ROOT / 'infrastructure/ansible/roles/backend/tasks/main.yml').read_text(encoding='utf-8')
        )
        probe = next(task for task in tasks if task['name'] == 'Verificar identidad pública del tenant configurado')
        probe['ansible.builtin.uri']['url'] = 'http://127.0.0.1:{{ test_port }}/api/tenant'
        probe['retries'] = 1
        probe['delay'] = 0

        class Handler(BaseHTTPRequestHandler):
            payload = {}
            status = 200

            def do_GET(self):
                body = json.dumps(self.payload).encode('utf-8')
                self.send_response(self.status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, format, *args):
                pass

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory(prefix='i4-identity-probe-') as name:
                playbook = Path(name) / 'probe.yml'
                playbook.write_text(yaml.safe_dump([{
                    'hosts': 'localhost',
                    'connection': 'local',
                    'gather_facts': False,
                    'tasks': [probe],
                }]), encoding='utf-8')
                variables = {
                    'test_port': server.server_port,
                    'frontend_server_name': 'example.test',
                    'tenant_slug': 'i4-demo',
                    'institution_name': 'Institución de prueba',
                    'tenant_plan_name': 'Estándar',
                }
                for status, payload, expected in (
                    (200, {'tenant': {'slug': 'i4-demo', 'name': 'Institución de prueba', 'plan': 'Estándar'}}, 0),
                    (200, {'tenant': {'slug': 'otro', 'name': 'Institución de prueba', 'plan': 'Estándar'}}, 1),
                    (200, {'tenant': None}, 1),
                    (404, {}, 1),
                ):
                    with self.subTest(status=status, payload=payload):
                        Handler.status, Handler.payload = status, payload
                        result = subprocess.run(
                            ['ansible-playbook', '-i', 'localhost,', str(playbook), '-e', json.dumps(variables)],
                            text=True, capture_output=True,
                            env=dict(os.environ, ANSIBLE_NOCOLOR='1'),
                        )
                        if expected == 0:
                            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                        else:
                            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        finally:
            server.shutdown()
            thread.join()
            server.server_close()

    def test_invalid_inputs_fail_before_changes(self):
        variables = {
            'tenant_slug': 'i4-demo',
            'institution_name': 'Institución de prueba',
            'tenant_plan_name': 'Básico',
            'backend_revision': 'a' * 40,
            'backend_source_archive': '/tmp/source.tar.gz',
            'backend_wheels_archive': '/tmp/wheels.tar.gz',
            'backend_private_ip': '192.0.2.10',
            'database_private_ip': '192.0.2.11',
            'backend_port': 8000,
            'frontend_server_name': 'asistencia.example.test',
            'vault_postgres_password': 'test-only-password-not-for-use-12345',
            'vault_django_secret_key': 'test-only-secret-key-not-for-use-12345',
            'vault_student_initial_passwords_key': 'A' * 43 + '=',
            'vault_admin_password': 'test-only-admin-password',
            'admin_name': 'Administrador de prueba',
            'admin_email': 'admin@example.test',
        }
        cases = [
            {'tenant_slug': '../otro'},
            {'institution_name': ''},
            {'institution_name': 'Prueba\nDJANGO_DEBUG=true'},
            {'tenant_plan_name': '   '},
            {'backend_revision': 'main'},
            {'database_private_ip': '192.0.2.999'},
            {'backend_private_ip': '192.0.2.1\n'},
            {'frontend_server_name': 'example.test\nDJANGO_DEBUG=true'},
            {'frontend_server_name': '192.0.2.999'},
            {'backend_port': 65536},
            {'vault_postgres_password': 'short'},
            {'vault_student_initial_passwords_key': 'invalid-key'},
            {'vault_admin_password': 'test-only-admin\npassword'},
        ]
        with tempfile.TemporaryDirectory(prefix='i4-backend-validation-') as name:
            playbook = Path(name) / 'validation.yml'
            playbook.write_text(yaml.safe_dump([{
                'hosts': 'localhost',
                'connection': 'local',
                'gather_facts': False,
                'roles': ['backend'],
            }]), encoding='utf-8')
            for overrides in cases:
                with self.subTest(overrides=overrides):
                    data = dict(variables, **overrides)
                    result = subprocess.run(
                        ['ansible-playbook', '--check', '-i', 'localhost,', str(playbook), '-e', json.dumps(data)],
                        text=True, capture_output=True,
                        env=dict(os.environ, ANSIBLE_NOCOLOR='1',
                                 ANSIBLE_ROLES_PATH=str(ROOT / 'infrastructure/ansible/roles')),
                    )
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn('Validar entradas de despliegue', result.stdout)
                    self.assertNotIn('Crear usuario de servicio', result.stdout)
                    self.assertNotIn(data['vault_postgres_password'], result.stdout + result.stderr)
                    self.assertNotIn(data['vault_admin_password'], result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
