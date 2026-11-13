import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


@unittest.skipUnless(shutil.which('ansible-playbook'), 'Ansible requiere un controlador Linux o WSL.')
class FrontendStageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='ansible-stage-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.ansible_dir = self.root / 'infrastructure' / 'ansible'
        shutil.copytree(ROOT / 'infrastructure' / 'ansible', self.ansible_dir)
        self.output = self.root / 'output' / 'ansible-stage' / 'i4-demo' / 'nginx.conf'

    def run_stage(self, **overrides):
        variables = {
            'tenant_slug': 'i4-demo',
            'frontend_server_name': 'asistencia.example.test',
            'backend_private_ip': '192.0.2.10',
            'backend_port': '8000',
        }
        variables.update(overrides)
        arguments = ['ansible-playbook', str(self.ansible_dir / 'stage-frontend.yml')]
        arguments.extend(['-e', json.dumps(variables)])
        environment = dict(os.environ, ANSIBLE_NOCOLOR='1')
        return subprocess.run(arguments, text=True, capture_output=True, env=environment)

    def test_renders_and_is_idempotent(self):
        first = self.run_stage()
        self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
        result = self.output.read_text(encoding='utf-8')
        self.assertIn('server_name asistencia.example.test;', result)
        self.assertIn('proxy_pass http://192.0.2.10:8000;', result)
        self.assertIn('try_files $uri $uri/ /index.html;', result)
        self.assertIn('/etc/campus-cloud/tls/i4-demo/privkey.pem', result)
        second = self.run_stage()
        self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
        self.assertIn('changed=0', second.stdout)
        self.assertEqual(result, self.output.read_text(encoding='utf-8'))

    def test_rejects_bad_inputs_before_creating_files(self):
        for values in (
            {'tenant_slug': '../otro'},
            {'frontend_server_name': 'example.test;return 200'},
            {'frontend_server_name': 'example.test\n'},
            {'frontend_server_name': '192.0.2.999'},
            {'backend_private_ip': '192.0.2.999'},
            {'backend_private_ip': '10.0.0.1;invalid'},
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
        self.assertIn('server_name 192.0.2.42;', self.output.read_text(encoding='utf-8'))


if __name__ == '__main__':
    unittest.main()
