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
class ConfigureCoreContract(unittest.TestCase):
    def test_preflight_then_database_backend_and_exporter(self):
        plays = yaml.safe_load((ANSIBLE / 'configure-core.yml').read_text(encoding='utf-8'))
        self.assertEqual(plays[0], {'import_playbook': 'preflight.yml'})
        self.assertEqual(
            [(play['hosts'], play['roles']) for play in plays[1:]],
            [('database', ['database']), ('backend', ['backend']),
             ('database', ['postgres_exporter'])],
        )
        self.assertTrue(all(play.get('any_errors_fatal') for play in plays[1:]))
        self.assertTrue(all(play.get('become') for play in plays[1:]))

    @unittest.skipUnless(shutil.which('ansible-playbook'), 'Se requiere Ansible en Linux o WSL.')
    def test_playbook_parses_and_lists_roles_in_order(self):
        with tempfile.TemporaryDirectory(prefix='i4-core-inventory-') as name:
            inventory = Path(name) / 'hosts.ini'
            inventory.write_text(
                '[frontend]\nfront\n[backend]\nback\n[database]\ndb\n',
                encoding='utf-8',
            )
            env = dict(os.environ, ANSIBLE_NOCOLOR='1')
            playbook = str(ANSIBLE / 'configure-core.yml')
            syntax = subprocess.run(
                ['ansible-playbook', '-i', str(inventory), playbook, '--syntax-check'],
                text=True, capture_output=True, env=env,
            )
            self.assertEqual(syntax.returncode, 0, syntax.stdout + syntax.stderr)
            listed = subprocess.run(
                ['ansible-playbook', '-i', str(inventory), playbook, '--list-tasks'],
                text=True, capture_output=True, env=env,
            )
            self.assertEqual(listed.returncode, 0, listed.stdout + listed.stderr)
            positions = [listed.stdout.index(name) for name in (
                'Validar el inventario de un tenant',
                'Configurar PostgreSQL del tenant',
                'Configurar backend de asistencia',
                'Configurar métricas privadas de PostgreSQL',
            )]
            self.assertEqual(positions, sorted(positions))


if __name__ == '__main__':
    unittest.main()
