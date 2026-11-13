import os
import shutil
import sqlite3
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
class IsolationContractTests(unittest.TestCase):
    def test_query_is_parameterized_and_read_only(self):
        plays = yaml.safe_load((ANSIBLE / 'verify-isolation.yml').read_text(encoding='utf-8'))
        task = next(item for item in plays[1]['tasks'] if 'community.postgresql.postgresql_query' in item)
        query = task['community.postgresql.postgresql_query']
        self.assertIn('%(marker_a)s', query['query'])
        self.assertIn('%(marker_b)s', query['query'])
        self.assertEqual(task['environment']['PGOPTIONS'], '-c default_transaction_read_only=on')
        self.assertTrue(task['no_log'])
        self.assertFalse(task['changed_when'])
        # SQLite comprueba la lógica SQL con datos sintéticos, no PostgreSQL ni AWS.
        statement = query['query'].replace('%(marker_a)s', ':marker_a').replace('%(marker_b)s', ':marker_b')
        connection = sqlite3.connect(':memory:')
        self.addCleanup(connection.close)
        connection.execute('CREATE TABLE estudiantes (numero_registro TEXT)')
        connection.executemany('INSERT INTO estudiantes VALUES (?)', [('I4-ISO-aaaa1111',), ('otra',)])
        self.assertEqual(connection.execute(statement, {'marker_a': 'I4-ISO-aaaa1111', 'marker_b': 'I4-ISO-bbbb2222'}).fetchone(), (1, 0))


@unittest.skipUnless(yaml and shutil.which('ansible-playbook'), 'Se requieren PyYAML y Ansible en Linux o WSL.')
class IsolationPlaybookTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='i4-isolation-test-')
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)

    def run_play(self, playbook, inventory, variables=None):
        args = ['ansible-playbook', '-i', str(inventory), str(playbook)]
        if variables:
            import json
            args.extend(['-e', json.dumps(variables)])
        return subprocess.run(args, text=True, capture_output=True,
                              env=dict(os.environ, ANSIBLE_NOCOLOR='1'))

    def test_verdict_accepts_only_correct_cross_counts(self):
        inventory = self.directory / 'hosts.ini'
        inventory.write_text('localhost ansible_connection=local\n', encoding='utf-8')
        playbook = self.directory / 'verdict.yml'
        playbook.write_text(yaml.safe_dump([{
            'hosts': 'localhost',
            'gather_facts': False,
            'tasks': [
                {'ansible.builtin.add_host': {'name': 'mock_a', 'groups': 'isolation_a',
                                             'isolation_counts': {'query_result': [{'a': '{{ aa }}', 'b': '{{ ab }}'}]}}},
                {'ansible.builtin.add_host': {'name': 'mock_b', 'groups': 'isolation_b',
                                             'isolation_counts': {'query_result': [{'a': '{{ ba }}', 'b': '{{ bb }}'}]}}},
                {'ansible.builtin.import_tasks': str(ANSIBLE / 'tasks' / 'isolation-verdict.yml')},
            ],
        }]), encoding='utf-8')
        for values, expected in [
            ({'aa': 1, 'ab': 0, 'ba': 0, 'bb': 1}, True),
            ({'aa': 0, 'ab': 0, 'ba': 0, 'bb': 1}, False),
            ({'aa': 1, 'ab': 1, 'ba': 0, 'bb': 1}, False),
            ({'aa': 1, 'ab': 0, 'ba': 1, 'bb': 1}, False),
            ({'aa': 1, 'ab': 0, 'ba': 0, 'bb': 2}, False),
        ]:
            with self.subTest(values=values):
                result = self.run_play(playbook, inventory, values)
                self.assertEqual(result.returncode == 0, expected, result.stdout + result.stderr)

    def test_invalid_inputs_fail_before_remote_connections(self):
        inventory = self.directory / 'inventory.ini'
        inventory.write_text(
            '[isolation_a]\na ansible_host=192.0.2.1 tenant_slug=tenant-a\n'
            '[isolation_b]\nb ansible_host=192.0.2.2 tenant_slug=tenant-b\n',
            encoding='utf-8',
        )
        for variables in (
            {},
            {'isolation_marker_a': 'I4-ISO-aaaaaaaa', 'isolation_marker_b': 'I4-ISO-aaaaaaaa'},
            {'isolation_marker_a': "I4-ISO-aaaaaaaa';DROP", 'isolation_marker_b': 'I4-ISO-bbbbbbbb'},
        ):
            with self.subTest(variables=variables):
                result = self.run_play(ANSIBLE / 'verify-isolation.yml', inventory, variables)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn('Leer identidad declarada', result.stdout)


if __name__ == '__main__':
    unittest.main()
