"""Pruebas del ejecutor del motor principal (integrante 2). No invocan Terraform ni AWS."""
import argparse
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
import terraform_tenant as tt

FIXTURES = ROOT / 'infrastructure' / 'terraform' / 'modules' / 'tenant' / 'tests' / 'fixtures'


def args(**overrides):
    base = dict(account_id='123456789012', member_id='integrante-2', ssh_cidr=['8.8.8.8/32'], monitoring_cidr=[],
                enable_nat=False, ssh_private_key_path='C:/claves/practico7-asistencia.pem')
    base.update(overrides)
    return argparse.Namespace(**base)


class TerraformTenantTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        for name in ('frontend.yaml', 'backend.yaml', 'database.yaml'):
            shutil.copy(FIXTURES / name, self.tmp / name)
        self.base = json.loads((FIXTURES / 'request.json').read_text(encoding='utf-8'))

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def write(self, **changes):
        request = dict(self.base, **changes)
        path = self.tmp / 'request.json'
        path.write_text(json.dumps(request), encoding='utf-8')
        return path

    def test_valid_request_is_accepted(self):
        path, request = tt.load_request(self.write())
        self.assertEqual(request['tenant_slug'], 'i2-fixture')
        self.assertTrue(path.is_absolute())

    def test_rejects_draft_foreign_engine_and_bad_slug(self):
        for changes in ({'deployable': False}, {'engine': 'pulumi'}, {'engine': 'cloudformation'}, {'tenant_slug': '../otro'}, {'schema_version': 2}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                tt.load_request(self.write(**changes))

    def test_rejects_images_from_other_region_and_missing_user_data(self):
        images = json.loads(json.dumps(self.base['images']))
        images['backend']['region'] = 'sa-east-1'
        with self.assertRaises(ValueError):
            tt.load_request(self.write(images=images))
        (self.tmp / 'database.yaml').unlink()
        with self.assertRaises(ValueError):
            tt.load_request(self.write())

    def test_ssh_cidr_only_public_single_hosts(self):
        self.assertEqual(tt.ssh_cidr('8.8.8.8/32'), '8.8.8.8/32')
        for bad in ('0.0.0.0/0', '8.8.8.0/24', '10.0.0.5/32', '192.168.1.1/32', 'abc'):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                tt.ssh_cidr(bad)

    def test_tfvars_contain_no_secrets_and_state_is_per_engine_and_tenant(self):
        path, request = tt.load_request(self.write())
        tfvars = tt.build_tfvars(path, request, args())
        text = json.dumps(tfvars)
        self.assertNotIn('PRIVATE KEY', text)
        self.assertNotIn('aws_secret_access_key', text)
        self.assertEqual(tfvars['ssh_private_key_path'], 'C:/claves/practico7-asistencia.pem')
        self.assertEqual(tfvars['state_reference']['key_or_stack'], 'infrastructure/terraform/state/i2-fixture/terraform.tfstate')
        other = tt.paths(dict(request, engine='opentofu', tenant_slug='i2-otro'))
        self.assertNotEqual(other['state'], tt.paths(request)['state'])
        self.assertNotEqual(other['work'], tt.paths(request)['work'])
        with self.assertRaises(ValueError):
            tt.build_tfvars(path, request, args(account_id='12'))

    def test_commands_are_argument_lists_with_tenant_state(self):
        _, request = tt.load_request(self.write())
        location = tt.paths(request)
        steps = tt.commands('terraform', 'apply', location, location['work'] / 'tenant.tfvars.json', auto_approve=False)
        self.assertTrue(all(isinstance(step, list) for step in steps))
        self.assertIn(f'-backend-config=path={location["state"].as_posix()}', steps[0])
        self.assertNotIn('-auto-approve', steps[1])
        self.assertEqual(tt.commands('tofu', 'plan', location, location['work'] / 'x.json', False)[1][:2], ['tofu', 'plan'])

    def test_destroy_requires_confirmation_and_draft_never_reaches_engine(self):
        path = self.write()
        with patch.object(tt.subprocess, 'run') as run:
            self.assertEqual(tt.main(['destroy', '--request', str(path), '--ssh-cidr', '8.8.8.8/32', '--account-id', '123456789012']), 2)
            draft = self.write(deployable=False)
            self.assertEqual(tt.main(['plan', '--request', str(draft), '--ssh-cidr', '8.8.8.8/32', '--account-id', '123456789012']), 2)
            run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
