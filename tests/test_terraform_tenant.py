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

# Mismo formato que genera POST /api/tenants/:slug/tfvars.
TFVARS = {
    'tenant_id': 'i2-fixture', 'tenant_name': 'Instituto Fixture', 'plan_type': 'estandar', 'region': 'us-east-1',
    'frontend_ami_id': 'ami-0aaaaaaaaaaaaaaa1', 'backend_ami_id': 'ami-0bbbbbbbbbbbbbbb2', 'database_ami_id': 'ami-0ccccccccccccccc3',
    'plan_capacity': {'frontend': {'instance_type': 't3.micro', 'disk_gib': 16}, 'backend': {'instance_type': 't3.small', 'disk_gib': 20},
                      'database': {'instance_type': 't3.small', 'disk_gib': 40}},
    'engine': 'terraform', 'request_id': '00000000-0000-4000-8000-000000000001', 'key_pair_name': 'practico7-asistencia',
}


def args(**overrides):
    base = dict(account_id='123456789012', member_id='integrante-2', ssh_cidr=['8.8.8.8/32'], monitoring_cidr=[],
                enable_nat=False, enable_frontend_https=False, ssh_private_key_path='C:/claves/practico7-asistencia.pem')
    base.update(overrides)
    return argparse.Namespace(**base)


class TerraformTenantTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def write(self, **changes):
        data = json.loads(json.dumps(TFVARS))
        data.update(changes)
        path = self.tmp / 'terraform.tfvars.json'
        path.write_text(json.dumps(data), encoding='utf-8')
        return path

    def test_valid_tfvars_is_accepted(self):
        path, tfvars = tt.load_tfvars(self.write())
        self.assertEqual(tfvars['tenant_id'], 'i2-fixture')
        self.assertTrue(path.is_absolute())

    def test_rejects_foreign_engine_bad_slug_plan_and_amis(self):
        for changes in ({'engine': 'pulumi'}, {'engine': 'cloudformation'}, {'tenant_id': '../otro'}, {'tenant_id': 'Colegio Demo'},
                        {'plan_type': 'premium'}, {'tenant_name': ' '}, {'region': 'marte'}, {'database_ami_id': 'ubuntu'}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                tt.load_tfvars(self.write(**changes))

    def test_rejects_small_disk_and_operator_data_inside_tenant_tfvars(self):
        capacity = json.loads(json.dumps(TFVARS['plan_capacity']))
        capacity['frontend']['disk_gib'] = 10
        with self.assertRaises(ValueError):
            tt.load_tfvars(self.write(plan_capacity=capacity))
        with self.assertRaises(ValueError):
            tt.load_tfvars(self.write(expected_account_id='123456789012'))

    def test_ssh_cidr_only_public_single_hosts(self):
        self.assertEqual(tt.ssh_cidr('8.8.8.8/32'), '8.8.8.8/32')
        for bad in ('0.0.0.0/0', '8.8.8.0/24', '10.0.0.5/32', '192.168.1.1/32', 'abc'):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                tt.ssh_cidr(bad)

    def test_operator_tfvars_have_no_secrets_and_workspace_is_per_tenant(self):
        _, tfvars = tt.load_tfvars(self.write())
        operator = tt.operator_tfvars(tfvars, args())
        text = json.dumps(operator)
        self.assertNotIn('PRIVATE KEY', text)
        self.assertNotIn('aws_secret_access_key', text)
        self.assertEqual(operator['ssh_private_key_path'], 'C:/claves/practico7-asistencia.pem')
        self.assertEqual(operator['state_reference']['key_or_stack'], 'infrastructure/terraform/terraform.tfstate.d/i2-fixture/terraform.tfstate')
        other = tt.paths(dict(tfvars, engine='opentofu', tenant_id='i2-otro'))
        self.assertEqual(other['workspace'], 'i2-otro')
        self.assertEqual(other['root'], ROOT / 'infrastructure' / 'opentofu')
        self.assertNotEqual(other['work'], tt.paths(tfvars)['work'])
        with self.assertRaises(ValueError):
            tt.operator_tfvars(tfvars, args(account_id='12'))

    def test_https_is_opt_in_and_does_not_override_tenant_tfvars_by_default(self):
        _, tfvars = tt.load_tfvars(self.write(enable_frontend_https=True))
        self.assertNotIn('enable_frontend_https', tt.operator_tfvars(tfvars, args()))
        self.assertTrue(tt.operator_tfvars(tfvars, args(enable_frontend_https=True))['enable_frontend_https'])

    def test_commands_select_tenant_workspace_before_running(self):
        _, tfvars = tt.load_tfvars(self.write())
        location = tt.paths(tfvars)
        files = [self.tmp / 'terraform.tfvars.json', self.tmp / 'operator.tfvars.json']
        steps = tt.commands('terraform', 'apply', location, files, auto_approve=False)
        self.assertTrue(all(isinstance(step, list) for step in steps))
        self.assertEqual(steps[1], ['terraform', 'workspace', 'select', '-or-create=true', 'i2-fixture'])
        self.assertEqual(sum(arg.startswith('-var-file=') for arg in steps[2]), 2)
        self.assertNotIn('-auto-approve', steps[2])
        self.assertEqual(tt.commands('tofu', 'plan', location, files, False)[2][:2], ['tofu', 'plan'])

    def test_destroy_requires_confirmation_and_invalid_tfvars_never_reach_engine(self):
        path = self.write()
        with patch.object(tt.subprocess, 'run') as run:
            self.assertEqual(tt.main(['destroy', '--tfvars', str(path), '--ssh-cidr', '8.8.8.8/32', '--account-id', '123456789012']), 2)
            bad = self.write(engine='pulumi')
            self.assertEqual(tt.main(['plan', '--tfvars', str(bad), '--ssh-cidr', '8.8.8.8/32', '--account-id', '123456789012']), 2)
            run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
