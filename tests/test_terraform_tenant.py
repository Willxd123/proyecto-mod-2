"""Pruebas del ejecutor del motor principal (integrante 2). No invocan Terraform ni AWS."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
import terraform_tenant as tt
from render_cloud_init import render
from security_scan import FILES, update_digest

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

    def test_scanned_request_must_match_tfvars_and_be_deployable(self):
        _, tfvars = tt.load_tfvars(self.write())
        root = self.tmp / 'handoff'
        directory = root / tfvars['tenant_id']
        directory.mkdir(parents=True)
        request = {
            'schema_version': 1, 'provider': 'aws', 'deployable': True,
            'tenant_slug': tfvars['tenant_id'], 'institution_name': tfvars['tenant_name'],
            'region': tfvars['region'], 'engine': tfvars['engine'],
            'request_id': tfvars['request_id'], 'key_pair_name': tfvars['key_pair_name'],
            'user_data': {role: f'{role}.yaml' for role in tt.ROLES},
            'plan_snapshot': {'slug': tfvars['plan_type'], 'roles': tfvars['plan_capacity']},
            'images': {role: {'role': role, 'provider': 'aws', 'region': tfvars['region'],
                              'ami_id': tfvars[f'{role}_ami_id']} for role in tt.ROLES},
        }
        def save():
            (directory / 'request.json').write_text(json.dumps(request), encoding='utf-8')
            for role in tt.ROLES:
                (directory / f'{role}.yaml').write_text(render(tfvars['tenant_id'], role), encoding='utf-8', newline='\n')
        save()
        def scan(tenant, root):
            digest = hashlib.sha256()
            for name in FILES:
                update_digest(digest, name, (directory / name).read_bytes())
            for name, data in tt.infrastructure_snapshot(tfvars['engine']).items():
                update_digest(digest, name, data)
            return {'status': 'clean', 'content_sha256': digest.hexdigest()}
        with patch.object(tt, 'scan_handoff', side_effect=scan):
            self.assertEqual(len(tt.verify_handoff(tfvars, root)), 64)
            with self.assertRaisesRegex(ValueError, 'ajenos'):
                tt.verify_handoff(dict(tfvars, ssh_authorized_keys=['not-scanned']), root)
            request['deployable'] = False
            save()
            with self.assertRaisesRegex(ValueError, 'no desplegable'):
                tt.verify_handoff(tfvars, root)
            request['deployable'] = True
            request['images']['backend']['ami_id'] = 'ami-0ddddddddddddddd4'
            save()
            with self.assertRaisesRegex(ValueError, 'backend'):
                tt.verify_handoff(tfvars, root)
            request['images']['backend']['ami_id'] = tfvars['backend_ami_id']
            save()
            (directory / 'backend.yaml').write_text('unexpected\n', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'cloud-init'):
                tt.verify_handoff(tfvars, root)
        save()
        with patch.object(tt, 'scan_handoff', return_value={'status': 'blocked', 'content_sha256': 'x' * 64}):
            with self.assertRaisesRegex(ValueError, 'escaneo'):
                tt.verify_handoff(tfvars, root)
        if shutil.which('trivy'):
            self.assertEqual(len(tt.verify_handoff(tfvars, root)), 64)

    def test_scanner_errors_and_changed_content_block_the_guard(self):
        _, tfvars = tt.load_tfvars(self.write())
        with patch.object(tt, 'verify_handoff', side_effect=ValueError('escaneo bloqueado')), \
                patch.object(tt.subprocess, 'run') as run:
            self.assertEqual(tt.main(['apply', '--tfvars', str(self.tmp / 'terraform.tfvars.json'),
                                      '--account-id', '123456789012', '--ssh-cidr', '8.8.8.8/32',
                                      '--verify-handoff', '--yes']), 2)
            run.assert_not_called()

    def test_verified_mode_rejects_implicit_terraform_inputs(self):
        tt.verify_implicit_inputs(self.tmp, {})
        for env in ({'TF_VAR_ssh_authorized_keys': 'anything'}, {'TF_CLI_ARGS_apply': '-refresh=false'},
                    {'TF_WORKSPACE': 'other'}):
            with self.subTest(env=env), self.assertRaises(ValueError):
                tt.verify_implicit_inputs(self.tmp, env)
        (self.tmp / 'unexpected.auto.tfvars.json').write_text('{}', encoding='utf-8')
        with self.assertRaises(ValueError):
            tt.verify_implicit_inputs(self.tmp, {})

    def test_change_after_initial_scan_never_runs_apply(self):
        path = self.write()
        engine_root = self.tmp / 'engine'
        engine_root.mkdir()
        location = {'root': engine_root, 'workspace': 'i2-fixture', 'state': self.tmp / 'state',
                    'work': self.tmp / 'work', 'plugins': self.tmp / 'plugins', 'inventories': self.tmp / 'inventory'}
        with patch.object(tt, 'verify_handoff', side_effect=['a' * 64, 'b' * 64]), \
                patch.object(tt, 'paths', return_value=location), patch.object(tt, 'operator_tfvars', return_value={}), \
                patch.object(tt, 'initialize_local_backend_metadata'), \
                patch.object(tt, 'run') as run:
            code = tt.main(['apply', '--tfvars', str(path), '--binary', 'terraform',
                            '--account-id', '123456789012', '--ssh-cidr', '8.8.8.8/32',
                            '--verify-handoff', '--yes'])
            self.assertEqual(code, 2)
            self.assertEqual([call.args[0][1] for call in run.call_args_list], ['init', 'workspace'])

    @unittest.skipUnless(shutil.which('terraform'), 'Terraform no está disponible')
    def test_new_backend_metadata_preserves_existing_workspace_state(self):
        root = self.tmp / 'engine'
        root.mkdir()
        (root / 'main.tf').write_text('terraform {\n  backend "local" {}\n}\noutput "value" { value = "fixture" }\n',
                                      encoding='utf-8')
        existing_data = self.tmp / 'existing-data'
        new_data = self.tmp / 'new-data'
        new_data.mkdir()
        env = {key: value for key, value in os.environ.items()
               if not key.startswith(('TF_VAR_', 'TF_CLI_ARGS')) and key not in ('TF_WORKSPACE', 'TF_DATA_DIR')}
        env.update(TF_DATA_DIR=str(existing_data), TF_IN_AUTOMATION='1')
        binary = shutil.which('terraform')
        for command in (['init', '-input=false'], ['workspace', 'new', 'other'], ['apply', '-input=false', '-auto-approve']):
            subprocess.run([binary, *command], cwd=root, env=env, check=True, capture_output=True, text=True)
        state = root / 'terraform.tfstate.d' / 'other' / 'terraform.tfstate'
        original = state.read_bytes()
        env['TF_DATA_DIR'] = str(new_data)
        tt.initialize_local_backend_metadata(binary, {'work': new_data}, env)
        subprocess.run([binary, 'init', '-input=false'], cwd=root, env=env, check=True, capture_output=True, text=True)
        subprocess.run([binary, 'workspace', 'select', '-or-create=true', 'new-tenant'],
                       cwd=root, env=env, check=True, capture_output=True, text=True)
        subprocess.run([binary, 'workspace', 'select', 'other'], cwd=root, env=env, check=True, capture_output=True, text=True)
        result = subprocess.run([binary, 'output', '-raw', 'value'], cwd=root, env=env,
                                check=True, capture_output=True, text=True)
        self.assertEqual(result.stdout.strip(), 'fixture')
        self.assertEqual(state.read_bytes(), original)
        self.assertTrue((root / 'terraform.tfstate.d' / 'new-tenant').exists())


if __name__ == '__main__':
    unittest.main()
