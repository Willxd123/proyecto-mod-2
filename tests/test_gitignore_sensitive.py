import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


@unittest.skipUnless(shutil.which('git'), 'Se requiere Git.')
class GitignoreSensitiveTests(unittest.TestCase):
    def test_private_artifacts_are_ignored_and_example_is_visible(self):
        private_paths = (
            'apps/backend/.env',
            'inventories/example/hosts.ini',
            'output/tenants/example/provisioning-result.json',
            'infrastructure/terraform/terraform.tfstate.d/example/terraform.tfstate',
            'infrastructure/terraform/.work/example/operator.tfvars.json',
            'infrastructure/ansible/.vault_pass',
            'infrastructure/ansible/group_vars/all/vault.yml',
            'infrastructure/ansible/group_vars/all/vault-prod.yaml',
            'infrastructure/ansible/group_vars/all/secrets.yml',
            'infrastructure/ansible/vars/private/artifact-sources.json',
            'private.pem',
            'application.log',
        )
        for path in private_paths:
            with self.subTest(path=path):
                result = subprocess.run(
                    ['git', 'check-ignore', '--no-index', '-q', '--', path],
                    cwd=ROOT, capture_output=True,
                )
                self.assertEqual(result.returncode, 0)
        example = subprocess.run(
            ['git', 'check-ignore', '--no-index', '-q', '--',
             'infrastructure/ansible/tenant-vars.example.yml'],
            cwd=ROOT, capture_output=True,
        )
        self.assertEqual(example.returncode, 1)


if __name__ == '__main__':
    unittest.main()
