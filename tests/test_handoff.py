import copy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
import aws_images
from prepare_handoff import prepare
from update_monitoring_targets import targets_for


class HandoffTests(unittest.TestCase):
    def request(self, registry, **kwargs):
        return prepare('i2-instituto-demo', 'Instituto Demo', 'admin@example.edu', 'basico', 'us-east-1', 'terraform', 'practico7-asistencia', registry, **kwargs)

    def test_missing_images_cannot_produce_deployable_request(self):
        with self.assertRaises(ValueError): self.request({'images': []})
        request = self.request({'images': []}, contract_only=True)
        self.assertFalse(request['deployable'])
        self.assertEqual(set(request['user_data']), {'frontend', 'backend', 'database'})
        self.assertNotIn('private_key', json.dumps(request))

    def test_snapshot_is_preserved_and_region_must_match(self):
        fixtures = {'images': [dict(role=role, region='us-east-1', ami_id='ami-0123456789abcdef0', image_version='0.1.0', source_revision='abcdef0', packer_version='1.14.3', built_at='2026-11-12T00:00:00Z') for role in ('frontend', 'backend', 'database')]}
        request = self.request(fixtures)
        self.assertTrue(request['deployable'])
        self.assertEqual(request['plan_snapshot']['roles']['database']['disk_gib'], 20)
        other_region = copy.deepcopy(fixtures)
        other_region['images'][0]['region'] = 'sa-east-1'
        with self.assertRaises(ValueError): self.request(other_region)
        with self.assertRaises(ValueError): self.request({'images': fixtures['images'] + [fixtures['images'][0]]})

    def test_monitoring_targets_are_tenant_specific_and_validate_addresses(self):
        nodes = {'frontend': '10.0.1.10', 'backend': '10.0.2.10', 'database': '10.0.3.10'}
        targets = targets_for('i2-demo', 'produccion', nodes)
        self.assertEqual(len(targets), 3)
        self.assertTrue(all(item['labels']['tenant'] == 'i2-demo' and item['labels']['scope'] == 'tenant' for item in targets))
        self.assertTrue(all(item['targets'][0].endswith(':9100') for item in targets))
        with self.assertRaises(ValueError): targets_for('../otro', 'produccion', nodes)
        with self.assertRaises(ValueError): targets_for('i2-demo', 'produccion', dict(nodes, backend='http://public.example/secret'))

    def test_account_guard_and_cleanup_ownership(self):
        with patch.object(aws_images, 'aws', return_value={'Account': 'different'}):
            with self.assertRaises(ValueError): aws_images.check_account({'region': 'us-east-1', 'account_id': 'expected'})
        tags = [{'Key': key, 'Value': value} for key, value in {'Project': 'proyecto-modulo-2', 'Purpose': 'image-verification', 'RunId': 'our-run'}.items()]
        self.assertTrue(aws_images.owned_instance({'Tags': tags}, 'our-run'))
        self.assertFalse(aws_images.owned_instance({'Tags': tags}, 'other-run'))
        self.assertFalse(aws_images.owned_instance({'Tags': []}, 'our-run'))
        for cidr in ('0.0.0.0/0', '10.0.0.1/32', '8.8.8.0/24', '2001:4860:4860::8888/128'):
            with self.assertRaises(ValueError): aws_images.public_cidr(cidr)
        self.assertEqual(aws_images.public_cidr('8.8.8.8/32'), '8.8.8.8/32')

    def test_preflight_selects_canonical_image_and_public_subnet_without_mutations(self):
        calls = []
        def fake_aws(region, *args):
            calls.append(args[1])
            return {
                'get-caller-identity': {'Account': '000000000000', 'Arn': 'test-fixture'},
                'describe-vpcs': {'Vpcs': [{'VpcId': 'vpc-fixture'}]},
                'describe-subnets': {'Subnets': [{'SubnetId': 'subnet-fixture', 'State': 'available', 'AvailableIpAddressCount': 5}]},
                'describe-route-tables': {'RouteTables': [{'Associations': [{'Main': True}], 'Routes': [{'DestinationCidrBlock': '0.0.0.0/0', 'GatewayId': 'igw-fixture', 'State': 'active'}]}]},
                'describe-images': {'Images': [{'ImageId': 'ami-old', 'CreationDate': '2025-01-01'}, {'ImageId': 'ami-new', 'CreationDate': '2026-01-01'}]},
            }[args[1]]
        with patch.object(aws_images, 'aws', side_effect=fake_aws):
            result = aws_images.preflight('us-east-1', '8.8.8.8/32')
        self.assertEqual(result['source_ami'], 'ami-new')
        self.assertEqual(result['subnet_id'], 'subnet-fixture')
        self.assertTrue(all(name.startswith('describe-') or name == 'get-caller-identity' for name in calls))

    def test_failed_preflight_does_not_write_cloud_artifacts(self):
        with patch.object(aws_images, 'aws', side_effect=RuntimeError('network unavailable')):
            with self.assertRaises(RuntimeError): aws_images.preflight('us-east-1', '8.8.8.8/32')


if __name__ == '__main__': unittest.main()
