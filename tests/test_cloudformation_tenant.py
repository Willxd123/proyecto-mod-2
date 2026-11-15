import copy
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
import cloudformation_tenant as engine
from prepare_handoff import prepare
from render_cloud_init import render


class CloudFormationTenantTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.patch = patch.object(engine, 'HANDOFF', self.root)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        registry = {'images': [dict(role=role, provider='aws', region='us-east-1', ami_id=f'ami-{n:017x}',
                                    image_version='1', source_revision='test', packer_version='1', built_at='test')
                               for n, role in enumerate(engine.ROLES, 1)]}
        self.request = prepare('i3-test', 'Instituto prueba', 'admin@example.edu', 'basico',
                               'us-east-1', 'cloudformation', 'test-key', registry)
        self.directory = self.root / 'i3-test'
        self.directory.mkdir()
        self.save()

    def save(self):
        (self.directory / 'request.json').write_text(json.dumps(self.request), encoding='utf-8')
        for role in engine.ROLES:
            (self.directory / f'{role}.yaml').write_text(render('i3-test', role), encoding='utf-8')

    def test_request_snapshot_and_cloud_init_are_required(self):
        request, user_data, digest, _, _ = engine.load_request('i3-test')
        self.assertEqual(len(digest), 64)
        params = {x['ParameterKey']: x['ParameterValue'] for x in engine.parameters(request, user_data, 'us-east-1a', '8.8.8.8/32', False)}
        self.assertEqual(params['DatabaseDisk'], str(request['plan_snapshot']['roles']['database']['disk_gib']))
        self.assertEqual(params['FrontendAmi'], request['images']['frontend']['ami_id'])
        self.request['deployable'] = False
        self.save()
        with self.assertRaisesRegex(ValueError, 'no desplegable'):
            engine.load_request('i3-test')
        self.request['deployable'] = True
        self.save()
        (self.directory / 'backend.yaml').write_text('unexpected', encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'cloud-init'):
            engine.load_request('i3-test')

    def test_aws_cli_file_reference_uses_native_path(self):
        path = self.root / 'name with spaces.json'
        self.assertEqual(engine.aws_file(path), 'file://' + str(path.resolve()))

    def test_ownership_and_scan_fail_closed(self):
        stack_id = 'arn:aws:cloudformation:us-east-1:000000000000:stack/i3-i3-test/abc'
        with patch.object(engine, 'aws', return_value={'Stacks': [{'StackId': stack_id, 'Tags': []}]}):
            with self.assertRaisesRegex(ValueError, 'etiquetas'):
                engine.owned_stack(self.request, stack_id)
        with self.assertRaisesRegex(ValueError, 'registro local'):
            engine.read_owner(self.directory, self.request, '000000000000')
        with patch.object(engine, 'scan_handoff', return_value={'status': 'blocked', 'content_sha256': ''}), \
                patch.object(engine, 'preflight') as preflight:
            code = engine.main(['create', '--tenant', 'i3-test', '--account-id', '000000000000', '--ssh-cidr', '8.8.8.8/32'])
            self.assertEqual(code, 2)
            preflight.assert_not_called()
        for cidr in ('0.0.0.0/0', '10.0.0.1/32', '8.8.8.0/24'):
            with self.assertRaises(ValueError):
                engine.ssh_cidr(cidr)

    def test_validate_uses_the_same_template_snapshot_as_the_scan(self):
        snapshot = {'infrastructure/cloudformation/tenant.yaml': b'safe immutable snapshot'}
        with patch.object(engine, 'infrastructure_snapshot', return_value=snapshot):
            _, _, digest, _, _ = engine.load_request('i3-test')
            def validate(region, *arguments):
                self.assertEqual(arguments[:2], ('cloudformation', 'validate-template'))
                filename = arguments[3].removeprefix('file://')
                self.assertEqual(Path(filename).read_bytes(), snapshot['infrastructure/cloudformation/tenant.yaml'])
                return {}
            with patch.object(engine, 'scan_handoff', return_value={'status': 'clean', 'content_sha256': digest}), \
                    patch.object(engine, 'preflight', return_value='us-east-1a'), \
                    patch.object(engine, 'aws', side_effect=validate):
                self.assertEqual(engine.main(['validate', '--tenant', 'i3-test', '--account-id', '000000000000',
                                              '--ssh-cidr', '8.8.8.8/32']), 0)

    def test_result_and_inventory_for_ansible(self):
        outputs = {'VpcId': 'vpc-fixture', 'PublicSubnetId': 'subnet-public', 'PrivateSubnetId': 'subnet-private',
                   'FrontendPublicIp': '8.8.8.8'}
        for index, role in enumerate(engine.ROLES, 1):
            name = role.capitalize()
            outputs[name + 'Id'] = 'i-' + role
            outputs[name + 'PrivateIp'] = f'10.42.1.{index}'
            outputs[name + 'SecurityGroupId'] = 'sg-' + role
        stack = {'StackStatus': 'CREATE_COMPLETE', 'StackId': 'arn:fixture',
                 'Outputs': [{'OutputKey': k, 'OutputValue': v} for k, v in outputs.items()]}
        result = engine.result_from_stack(self.request, stack)
        self.assertIsNone(result['nodes']['database']['public_ip'])
        hosts = engine.inventory(self.request, result, '/home/test/key with spaces.pem')
        children = hosts['all']['children']
        self.assertEqual(set(children['private']['children']), {'backend', 'database'})
        self.assertEqual(children['frontend']['hosts']['i3-test-frontend']['ansible_host'], '8.8.8.8')
        self.assertEqual(children['database']['hosts']['i3-test-database']['ansible_host'], '10.42.1.3')
        self.assertIn('ProxyCommand=', children['private']['vars']['ansible_ssh_common_args'])
        bad = copy.deepcopy(stack)
        bad['StackStatus'] = 'ROLLBACK_COMPLETE'
        with self.assertRaises(ValueError):
            engine.result_from_stack(self.request, bad)

    def test_stack_resources_require_matching_ownership(self):
        stack_id = 'arn:aws:cloudformation:us-east-1:000000000000:stack/i3-i3-test/abc'
        resource = {'LogicalResourceId': 'Vpc', 'ResourceType': 'AWS::EC2::VPC',
                    'PhysicalResourceId': 'vpc-fixture', 'ResourceStatus': 'CREATE_COMPLETE'}
        tags = [{'ResourceId': 'vpc-fixture', 'Key': k, 'Value': v} for k, v in engine.stack_tags(self.request).items()]
        with patch.object(engine, 'aws', side_effect=[{'StackResourceSummaries': [resource]}, {'Tags': tags}]):
            engine.verify_stack_resources(self.request, stack_id)
        with patch.object(engine, 'aws', side_effect=[{'StackResourceSummaries': [resource]}, {'Tags': tags[:-1]}]):
            with self.assertRaisesRegex(ValueError, 'etiquetas'):
                engine.verify_stack_resources(self.request, stack_id)
        foreign = dict(resource, LogicalResourceId='ForeignResource')
        with patch.object(engine, 'aws', return_value={'StackResourceSummaries': [foreign]}):
            with self.assertRaisesRegex(ValueError, 'ajeno'):
                engine.verify_stack_resources(self.request, stack_id)

    def test_inventory_is_not_used_when_instance_identity_changed(self):
        nodes = {role: {'instance_id': 'i-' + role, 'image_id': self.request['images'][role]['ami_id'],
                        'private_ip': f'10.42.1.{index}', 'public_ip': '8.8.8.8' if role == 'frontend' else None}
                 for index, role in enumerate(engine.ROLES, 1)}
        result = {'nodes': nodes, 'network': {'vpc_id': 'vpc-fixture', 'subnet_ids': ['public', 'private']}}
        instances = []
        for role, node in nodes.items():
            tags = dict(engine.stack_tags(self.request), Role=role)
            instances.append({'InstanceId': node['instance_id'], 'ImageId': node['image_id'],
                              'State': {'Name': 'running'}, 'VpcId': 'vpc-fixture',
                              'SubnetId': 'public' if role == 'frontend' else 'private',
                              'PrivateIpAddress': node['private_ip'], 'PublicIpAddress': node['public_ip'],
                              'Tags': [{'Key': k, 'Value': v} for k, v in tags.items()]})
        with patch.object(engine, 'aws', return_value={'Reservations': [{'Instances': instances}]}):
            engine.verify_instances(self.request, result)
            instances[1]['VpcId'] = 'another-vpc'
            with self.assertRaisesRegex(ValueError, 'identidad'):
                engine.verify_instances(self.request, result)

    def test_inventory_is_accepted_by_ansible(self):
        executable = shutil.which('ansible-inventory')
        wsl = shutil.which('wsl.exe') if sys.platform == 'win32' else None
        if not executable and not wsl:
            self.skipTest('Ansible no está disponible.')
        # En Windows se usa la distribución de WSL con Ansible (WSL_DISTRO); si no la tiene, la prueba se omite.
        distro = os.environ.get('WSL_DISTRO', '').strip()
        wsl_command = [wsl] + (['-d', distro] if distro else []) if wsl else []
        if wsl and subprocess.run(wsl_command + ['--exec', 'which', 'ansible-inventory'], capture_output=True).returncode != 0:
            self.skipTest('ansible-inventory no está disponible en la distribución de WSL (defina WSL_DISTRO).')
        result = {'nodes': {'frontend': {'public_ip': '8.8.8.8', 'private_ip': '10.42.1.2'},
                            'backend': {'private_ip': '10.42.2.3'},
                            'database': {'private_ip': '10.42.2.4'}}}
        path = self.root / 'hosts.yml'
        path.write_text(json.dumps(engine.inventory(self.request, result, '/tmp/test key.pem')), encoding='utf-8')
        if wsl:
            wsl_path = subprocess.check_output(wsl_command + ['--exec', 'wslpath', '-a', str(path)], text=True).strip()
            command = wsl_command + ['--exec', 'ansible-inventory', '-i', wsl_path, '--list']
        else:
            command = [executable, '-i', str(path), '--list']
        completed = subprocess.run(command, capture_output=True, text=True, check=True)
        parsed = json.loads(completed.stdout)
        self.assertEqual(parsed['frontend']['hosts'], ['i3-test-frontend'])
        self.assertEqual(set(parsed['private']['children']), {'backend', 'database'})
        self.assertEqual(parsed['_meta']['hostvars']['i3-test-database']['tenant_slug'], 'i3-test')


if __name__ == '__main__':
    unittest.main()
