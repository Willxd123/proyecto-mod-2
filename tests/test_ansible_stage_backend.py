import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


@unittest.skipUnless(shutil.which('ansible-playbook'), 'Ansible requiere un controlador Linux o WSL.')
class BackendStageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='ansible-backend-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.ansible_dir = self.root / 'infrastructure' / 'ansible'
        shutil.copytree(ROOT / 'infrastructure' / 'ansible', self.ansible_dir)
        self.output = self.root / 'output' / 'ansible-stage' / 'i4-demo'

    def run_stage(self, **overrides):
        variables = {
            'tenant_slug': 'i4-demo',
            'institution_name': 'Institución "Ejemplo" \\ sede',
            'tenant_plan_name': 'Estándar',
            'frontend_server_name': 'asistencia.example.test',
            'database_private_ip': '192.0.2.11',
            'backend_port': '8000',
        }
        variables.update(overrides)
        arguments = ['ansible-playbook', str(self.ansible_dir / 'stage-backend.yml')]
        arguments.extend(['-e', json.dumps(variables)])
        return subprocess.run(arguments, text=True, capture_output=True,
                              env=dict(os.environ, ANSIBLE_NOCOLOR='1'))

    def test_renders_public_configuration_and_is_idempotent(self):
        first = self.run_stage()
        self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
        env = (self.output / 'backend.env').read_text(encoding='utf-8')
        unit = (self.output / 'backend.service').read_text(encoding='utf-8')
        self.assertIn('POSTGRES_HOST=192.0.2.11\n', env)
        self.assertIn('DJANGO_DEBUG=false\n', env)
        self.assertIn('TENANT_SLUG=i4-demo\n', env)
        self.assertIn('TENANT_NAME="Institución \\"Ejemplo\\" \\\\ sede"\n', env)
        self.assertIn('TENANT_PLAN="Estándar"\n', env)
        self.assertIn('CSRF_TRUSTED_ORIGINS=https://asistencia.example.test\n', env)
        self.assertNotIn('POSTGRES_PASSWORD=', env)
        self.assertNotIn('DJANGO_SECRET_KEY=', env)
        self.assertIn('EnvironmentFile=/etc/campus-cloud/i4-demo/backend-secrets.env', unit)
        self.assertIn('--bind 0.0.0.0:8000', unit)
        self.assertIn('config.wsgi:application', unit)
        second = self.run_stage()
        self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
        self.assertIn('changed=0', second.stdout)
        self.assertEqual(env, (self.output / 'backend.env').read_text(encoding='utf-8'))
        self.assertEqual(unit, (self.output / 'backend.service').read_text(encoding='utf-8'))

    def test_rejects_bad_inputs_before_creating_files(self):
        for values in (
            {'tenant_slug': '../otro'},
            {'institution_name': 'Nombre\nDJANGO_DEBUG=true'},
            {'tenant_plan_name': ''},
            {'frontend_server_name': 'example.test\nDJANGO_DEBUG=true'},
            {'frontend_server_name': '192.0.2.999'},
            {'database_private_ip': '192.0.2.999'},
            {'database_private_ip': '10.0.0.1;invalid'},
            {'backend_port': '0'},
            {'backend_port': '65536'},
        ):
            with self.subTest(values=values):
                result = self.run_stage(**values)
                self.assertNotEqual(result.returncode, 0, result.stdout)
                self.assertFalse((self.root / 'output').exists())

    def test_accepts_ipv4_server_name(self):
        result = self.run_stage(frontend_server_name='192.0.2.42')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        env = (self.output / 'backend.env').read_text(encoding='utf-8')
        self.assertIn('DJANGO_ALLOWED_HOSTS=192.0.2.42\n', env)
        self.assertIn('CSRF_TRUSTED_ORIGINS=https://192.0.2.42\n', env)


if __name__ == '__main__':
    unittest.main()
