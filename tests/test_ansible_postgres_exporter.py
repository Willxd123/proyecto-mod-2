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
class PostgresExporterContract(unittest.TestCase):
    def test_exporter_is_private_and_does_not_store_credentials(self):
        template = (ANSIBLE / 'roles/postgres_exporter/templates/prometheus-postgres-exporter.j2').read_text()
        self.assertIn('host=/var/run/postgresql', template)
        self.assertIn('--web.listen-address=127.0.0.1:9187', template)
        self.assertNotIn('password=', template.lower())
        tasks = yaml.safe_load((ANSIBLE / 'roles/postgres_exporter/tasks/main.yml').read_text(encoding='utf-8'))
        users = [task['community.postgresql.postgresql_user'] for task in tasks
                 if 'community.postgresql.postgresql_user' in task]
        self.assertEqual(len(users), 1)
        self.assertIn('NOSUPERUSER', users[0]['role_attr_flags'])
        self.assertNotIn('password', users[0])
        memberships = [task['community.postgresql.postgresql_membership'] for task in tasks
                       if 'community.postgresql.postgresql_membership' in task]
        self.assertEqual(memberships[0]['groups'], ['pg_monitor'])

    @unittest.skipUnless(shutil.which('ansible-playbook'), 'Se requiere Ansible en Linux o WSL.')
    def test_missing_exporter_fails_before_database_changes(self):
        if Path('/usr/bin/prometheus-postgres-exporter').exists():
            self.skipTest('La máquina de pruebas ya tiene el exporter instalado.')
        with tempfile.TemporaryDirectory(prefix='i4-exporter-validation-') as name:
            playbook = Path(name) / 'validation.yml'
            playbook.write_text(yaml.safe_dump([{
                'hosts': 'localhost',
                'connection': 'local',
                'gather_facts': False,
                'roles': ['postgres_exporter'],
            }]), encoding='utf-8')
            result = subprocess.run(
                ['ansible-playbook', '-i', 'localhost,', str(playbook)],
                text=True, capture_output=True,
                env=dict(os.environ, ANSIBLE_NOCOLOR='1',
                         ANSIBLE_ROLES_PATH=str(ANSIBLE / 'roles')),
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Exigir el exporter preinstalado', result.stdout)
            self.assertNotIn('Crear usuario de monitoreo PostgreSQL', result.stdout)


if __name__ == '__main__':
    unittest.main()
