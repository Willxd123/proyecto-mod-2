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


@unittest.skipUnless(yaml and shutil.which('ansible-playbook'), 'Se requieren PyYAML y Ansible en Linux o WSL.')
class DatabaseRoleValidation(unittest.TestCase):
    def test_invalid_inputs_fail_before_database_tasks(self):
        cases = [
            {'backend_private_ip': '192.0.2.999', 'database_private_ip': '192.0.2.11',
             'vault_postgres_password': 'test-only-password-not-for-use-12345'},
            {'backend_private_ip': '192.0.2.10', 'database_private_ip': '192.0.2.11',
             'vault_postgres_password': 'short'},
            {'backend_private_ip': '192.0.2.10', 'database_private_ip': 'invalid',
             'vault_postgres_password': 'test-only-password-not-for-use-12345'},
        ]
        with tempfile.TemporaryDirectory(prefix='i4-db-validation-') as name:
            playbook = Path(name) / 'validation.yml'
            for variables in cases:
                with self.subTest(variables=variables):
                    playbook.write_text(yaml.safe_dump([{
                        'hosts': 'localhost',
                        'connection': 'local',
                        'gather_facts': False,
                        'vars': variables,
                        'roles': ['database'],
                    }]), encoding='utf-8')
                    result = subprocess.run(
                        ['ansible-playbook', '-i', 'localhost,', str(playbook)],
                        text=True, capture_output=True,
                        env=dict(os.environ, ANSIBLE_NOCOLOR='1',
                                 ANSIBLE_ROLES_PATH=str(ROOT / 'infrastructure/ansible/roles')),
                    )
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn('Validar variables de conexión', result.stdout)
                    self.assertNotIn('Crear usuario de aplicación', result.stdout)
                    self.assertNotIn(variables['vault_postgres_password'], result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()
