"""Pruebas del orquestador local sin ejecutar comandos de escritura en AWS."""
import json
from pathlib import Path, PureWindowsPath
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'scripts'))
import demo_worker


def sample_request():
    roles = {
        role: {'instance_type': 't3.small', 'disk_gib': 20}
        for role in demo_worker.ROLES
    }
    images = {
        role: {'role': role, 'provider': 'aws', 'region': 'us-east-1', 'ami_id': f'ami-{"a" * 17}'}
        for role in demo_worker.ROLES
    }
    return {
        'tenant_slug': 'i3-fixture', 'institution_name': 'Fixture', 'admin_email': 'admin@example.test',
        'plan_slug': 'estandar', 'region': 'us-east-1', 'engine': 'terraform', 'request_id': 'a' * 32,
        'key_pair_name': 'practico7-asistencia', 'deployable': True, 'plan_snapshot': {'slug': 'estandar', 'roles': roles},
        'images': images,
    }


class DemoWorkerTests(unittest.TestCase):
    def test_worker_refuses_to_run_without_explicit_local_opt_in(self):
        with patch.dict('os.environ', {'DEMO_PROVISIONING_LOCAL': 'false'}):
            with self.assertRaises(demo_worker.DemoError):
                demo_worker.run({})

    def test_build_request_rejects_plan_snapshot_drift(self):
        source = {
            'tenant': {
                'slug': 'i3-fixture', 'name': 'Fixture', 'email': 'admin@example.test',
                'plan_slug': 'estandar', 'region': 'us-east-1', 'engine': 'terraform',
                'request_id': 'a' * 32,
            },
            'plan': {'slug': 'estandar', 'roles': {}},
            'images': [{'role': role, 'provider': 'aws', 'region': 'us-east-1', 'ami_id': 'ami-' + 'b' * 17}
                       for role in demo_worker.ROLES],
        }
        prepared = {'deployable': True, 'plan_snapshot': {'slug': 'estandar', 'roles': {'drift': {}}}, 'images': {}}
        with patch.object(demo_worker, 'prepare', return_value=prepared):
            with self.assertRaises(demo_worker.DemoError):
                demo_worker.build_request(source)

    def test_readiness_allows_cloudformation_when_terraform_cli_is_missing(self):
        settings = {'account_id': '1' * 12, 'private_key_wsl': '/home/user/key.pem',
                    'psycopg_deb_wsl': '/home/user/driver.deb', 'artifact_release': 'a' * 32}
        with patch.dict('os.environ', {'DEMO_PROVISIONING_LOCAL': 'true'}):
            with patch.object(demo_worker.shutil, 'which', side_effect=lambda name: None if name == 'terraform' else 'tool'):
                with patch.object(demo_worker, 'configured', return_value=settings), \
                        patch.object(demo_worker, 'check_wsl_private_file'), \
                        patch.object(demo_worker, 'verify_artifacts'), \
                        patch.object(demo_worker, 'wsl', return_value=b'ok'), \
                        patch.object(demo_worker, 'aws_json', return_value={'Account': '1' * 12}):
                    result = demo_worker.check_setup()
        self.assertTrue(result['ready'])
        self.assertEqual(result['supported_engines'], ['cloudformation'])
        self.assertIn('terraform', result['missing'])

    def test_preflight_requires_the_local_private_key_to_match_aws_key_pair(self):
        request = sample_request()
        settings = {'account_id': '1' * 12, 'key_name': 'practico7-asistencia',
                    'private_key_wsl': '/home/user/key.pem'}
        public_key = 'ssh-ed25519 AAAATEST fixture'
        def aws(region, service, command, *args):
            if service == 'sts':
                return {'Account': '1' * 12}
            if command == 'describe-key-pairs':
                return {'KeyPairs': [{'PublicKey': public_key}]}
            if service == 'resourcegroupstaggingapi':
                return {'ResourceTagMappingList': []}
            if command == 'describe-images':
                return {'Images': [{
                    'State': 'available', 'Architecture': 'x86_64', 'RootDeviceName': '/dev/sda1',
                    'BlockDeviceMappings': [{'DeviceName': '/dev/sda1', 'Ebs': {'VolumeSize': 20}}],
                }]}
            if command == 'describe-instance-type-offerings':
                return {'InstanceTypeOfferings': [{'Location': 'us-east-1a'}]}
            self.fail(f'Unexpected AWS command: {service} {command}')

        with patch.object(demo_worker, 'aws_json', side_effect=aws) as aws_call, \
                patch.object(demo_worker, 'wsl', return_value=public_key.encode()) as wsl_call:
            self.assertEqual(demo_worker.preflight(request, settings), 'us-east-1a')
        self.assertIn('--include-public-key', aws_call.call_args_list[1].args)
        self.assertNotIn('', wsl_call.call_args.args[0])
        self.assertEqual(wsl_call.call_args.kwargs['input_data'], b'')

        with patch.object(demo_worker, 'aws_json', side_effect=aws), \
                patch.object(demo_worker, 'wsl', return_value=b'ssh-ed25519 AAAADIFFERENT fixture'):
            with self.assertRaisesRegex(demo_worker.DemoError, 'no corresponde'):
                demo_worker.preflight(request, settings)

    def test_tfvars_is_not_overwritten_when_request_changes(self):
        request = sample_request()
        with tempfile.TemporaryDirectory() as temporary:
            with patch.object(demo_worker, 'ROOT', Path(temporary)):
                path = demo_worker.write_tfvars(request)
                existing = json.loads(path.read_text(encoding='utf-8'))
                existing['tenant_name'] = 'another request'
                path.write_text(json.dumps(existing), encoding='utf-8')
                with self.assertRaises(demo_worker.DemoError):
                    demo_worker.write_tfvars(request)

    def test_ansible_keeps_linux_variable_paths_on_windows(self):
        variables = '/home/user/demo/tenant-vars.json'
        staged = ['/home/user/demo/inventory.yml', variables, '/home/user/demo/vault', '/home/user/demo/key']
        with patch.object(demo_worker, 'Path', PureWindowsPath), \
                patch.object(demo_worker, 'wsl_path', return_value='/mnt/repo'), \
                patch.object(demo_worker, 'run_silent') as run, \
                patch.object(demo_worker, 'wsl', return_value=b'{"verified":true}'):
            demo_worker.configure_and_verify('i3-fixture', {}, {}, staged)
        command = run.call_args.args[0]
        self.assertIn('@' + variables, command)

    def test_https_verifier_accepts_json_output_and_rejects_unverified_results(self):
        staged = ['/home/user/inventory', '/home/user/variables', '/home/user/vault', '/home/user/key']
        with patch.object(demo_worker, 'wsl_path', return_value='/mnt/repo'), \
                patch.object(demo_worker, 'run_silent'), \
                patch.object(demo_worker, 'wsl', return_value=b'{"verified": true}\n'):
            demo_worker.configure_and_verify('i3-fixture', {}, {}, staged)
        for output in (b'{"verified": false}', b'{"verified": 1}', b'{"verified": true, "extra": 1}', b'invalid'):
            with self.subTest(output=output), patch.object(demo_worker, 'wsl_path', return_value='/mnt/repo'), \
                    patch.object(demo_worker, 'run_silent'), patch.object(demo_worker, 'wsl', return_value=output):
                with self.assertRaises(demo_worker.DemoError):
                    demo_worker.configure_and_verify('i3-fixture', {}, {}, staged)

    def test_artifact_manifest_checks_all_package_digests(self):
        import hashlib
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            release = 'a' * 32
            directory = root / 'output' / 'ansible-artifacts' / 'releases' / release
            directory.mkdir(parents=True)
            files = {'source.tar.gz': b'source', 'wheels.tar.gz': b'wheels', 'build.tar.gz': b'build'}
            for name, value in files.items():
                (directory / name).write_bytes(value)
            manifest = {
                'schema_version': 1, 'revisions': {'backend': 'b' * 40, 'frontend': 'c' * 40},
                'sha256': {name: hashlib.sha256(value).hexdigest() for name, value in files.items()},
            }
            (directory / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
            with patch.object(demo_worker, 'ROOT', root):
                self.assertEqual(demo_worker.verify_artifacts(release)[1], manifest)
                (directory / 'build.tar.gz').write_bytes(b'tampered')
                with self.assertRaises(demo_worker.DemoError):
                    demo_worker.verify_artifacts(release)


if __name__ == '__main__':
    unittest.main()
