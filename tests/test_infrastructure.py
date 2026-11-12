import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parent.parent


def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / f'{name}.py')
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


class InfrastructureContracts(unittest.TestCase):
    def test_user_data_valid_and_rejects_injection(self):
        renderer = module('render_cloud_init')
        for role in ('frontend', 'backend', 'database'):
            text = renderer.render('instituto-demo', role)
            self.assertTrue(text.startswith('#cloud-config\n'))
            self.assertNotIn('__TENANT_SLUG__', text)
            self.assertIn(f'hostname: instituto-demo-{role}', text)
            try:
                import yaml
            except ImportError:
                yaml = None
            if yaml:
                data = yaml.safe_load(text)
                self.assertFalse(data['ssh_pwauth'])
                self.assertTrue(data['ssh_deletekeys'])
                self.assertEqual(data['swap']['size'], 2147483648)
        for slug in ['x; whoami', '../test', 'test\nrun: bad', 'AInvalid', 'a' * 41]:
            with self.assertRaises(ValueError): renderer.render(slug, 'frontend')
        with self.assertRaises(ValueError): renderer.render('instituto-demo', '../other')

    def test_ssh_public_keys_are_injected_and_validated(self):
        renderer = module('render_cloud_init')
        key = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyForTestOnly0000000000000000000 equipo@lab'
        for role in ('frontend', 'backend', 'database'):
            text = renderer.render('instituto-demo', role, [key])
            self.assertIn('ssh_authorized_keys:\n  - "' + key + '"', text)
            self.assertNotIn('__SSH_AUTHORIZED_KEYS__', text)
            self.assertIn('ssh_authorized_keys: []', renderer.render('instituto-demo', role))
        for bad in ['-----BEGIN OPENSSH PRIVATE KEY-----', 'ssh-ed25519 AAAA"\nruncmd: [x]', 'ssh-ed25519 AAAA\nssh-rsa BBBB', 'password123']:
            with self.assertRaises(ValueError): renderer.render('instituto-demo', 'backend', [bad])

    def test_packer_provisioning_covers_required_tooling(self):
        script = (ROOT / 'infrastructure/packer/scripts/provision.sh').read_text(encoding='utf-8')
        for needle in ('nginx', 'pnpm@', 'pm2@', 'gunicorn', 'postgresql-client', 'xz-utils', 'prometheus-node-exporter', 'postgresql-16', 'prometheus-postgres-exporter', 'net-tools', 'openssl'):
            self.assertIn(needle, script)

    def test_catalog_disks_fit_images_and_deliverable_matches(self):
        catalog = json.loads((ROOT / 'config/plans.json').read_text(encoding='utf-8'))
        self.assertEqual(len(catalog['plans']), 3)
        for plan in catalog['plans']:
            self.assertEqual(set(plan['roles']), {'frontend', 'backend', 'database'})
            self.assertIn('Manual', plan['backup_policy'])
            for capacity in plan['roles'].values(): self.assertGreaterEqual(capacity['disk_gib'], 12)
        self.assertEqual((ROOT / 'docs/CATALOGO-PLANES.md').read_text(encoding='utf-8'), module('generate_catalog').generate())

    def test_manifest_uses_latest_run_and_validates_artifact(self):
        importer = module('import_packer_manifest')
        build = {'packer_run_uuid': 'latest', 'artifact_id': 'us-east-1:ami-0123456789abcdef0', 'build_time': 1730000000,
                 'custom_data': {'role': 'frontend', 'image_version': '0.1.0', 'source_revision': 'abcdef0'}}
        previous = dict(build, packer_run_uuid='old')
        manifest = {'last_run_uuid': 'latest', 'builds': [previous, build]}
        result = importer.import_builds(manifest, '1.14.0')
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['ami_id'], 'ami-0123456789abcdef0')
        self.assertEqual(result[0]['source_revision'], 'abcdef0')
        build['artifact_id'] = 'us-east-1:not-an-ami'
        with self.assertRaises(ValueError): importer.import_builds(manifest, '1.14.0')
        with self.assertRaises(ValueError): importer.import_builds({'last_run_uuid': 'empty', 'builds': []}, '1.14.0')


if __name__ == '__main__': unittest.main()
