import re
import unittest
from pathlib import Path

try:
    import yaml
except ImportError:
    yaml = None

ROOT = Path(__file__).resolve().parent.parent


@unittest.skipUnless(yaml, 'PyYAML es necesario para comprobar el playbook.')
class AnsiblePreflightContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plays = yaml.safe_load(
            (ROOT / 'infrastructure/ansible/preflight.yml').read_text(encoding='utf-8')
        )

    def test_inventory_matches_engine_and_slug_contract(self):
        template = (ROOT / 'infrastructure/terraform/modules/tenant/templates/inventory.tftpl').read_text(encoding='utf-8')
        inventory = self.plays[0]
        self.assertEqual(inventory['hosts'], 'localhost')
        self.assertTrue(inventory['any_errors_fatal'])
        for role in ('frontend', 'backend', 'database'):
            self.assertIn(f'[{role}]', template)
            self.assertTrue(any(f"groups.get('{role}', []) | length == 1" in condition
                                for condition in inventory['tasks'][0]['ansible.builtin.assert']['that']))
        conditions = inventory['tasks'][1]['ansible.builtin.assert']['that']
        expression = next(condition for condition in conditions if ' is match(' in condition)
        pattern = re.search(r"match\('([^']+)'\)", expression).group(1)
        contracts = (ROOT / 'packages/contracts/src/validation.ts').read_text(encoding='utf-8')
        self.assertIn(f'TENANT_SLUG_PATTERN = /{pattern}/', contracts)
        for valid in ('abc', 'a--', 'a' * 40):
            self.assertIsNotNone(re.fullmatch(pattern, valid))
        for invalid in ('ab', 'A123', '1abc', 'a' * 41, 'a b'):
            self.assertIsNone(re.fullmatch(pattern, invalid))

    def test_checks_match_image_and_cloud_init_metadata(self):
        tasks = self.plays[1]['tasks']
        self.assertEqual(self.plays[1]['hosts'], 'frontend:backend:database')
        self.assertTrue(self.plays[1]['any_errors_fatal'])
        self.assertEqual(tasks[1]['ansible.builtin.command']['argv'],
                         ['timeout', '300', 'cloud-init', 'status', '--wait'])
        self.assertFalse(tasks[1]['changed_when'])
        paths = {task['ansible.builtin.slurp']['src'] for task in tasks if 'ansible.builtin.slurp' in task}
        self.assertEqual(paths, {'/etc/campus-cloud/image.json', '/etc/campus-cloud/tenant.env'})
        for role in ('frontend', 'backend', 'database'):
            cloud_init = (ROOT / f'infrastructure/cloud-init/{role}.yaml.tmpl').read_text(encoding='utf-8')
            self.assertIn('TENANT_SLUG=__TENANT_SLUG__', cloud_init)
            self.assertIn(f'SERVER_ROLE={role}', cloud_init)
        provision = (ROOT / 'infrastructure/packer/scripts/provision.sh').read_text(encoding='utf-8')
        self.assertIn("'IMAGE_ROLE'", provision)

    def test_postgresql_probe_is_read_only_and_bounded_to_local_socket(self):
        play = self.plays[2]
        self.assertEqual(play['hosts'], 'database')
        task = play['tasks'][0]
        self.assertEqual(task['ansible.builtin.command']['argv'],
                         ['pg_isready', '-q', '-h', '/var/run/postgresql', '-p', '5432'])
        self.assertFalse(task['changed_when'])


if __name__ == '__main__':
    unittest.main()
