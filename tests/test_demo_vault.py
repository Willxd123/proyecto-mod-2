"""Pruebas del almacenamiento local cifrado, sin credenciales reales."""
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'scripts'))
import demo_vault


@unittest.skipUnless(os.name == 'posix', 'Requiere permisos POSIX en Linux/WSL.')
class DemoVaultTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / 'private'
        self.root_patch = patch.object(demo_vault, 'ROOT', self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        self.addCleanup(self.tmp.cleanup)

    def test_create_and_read_vault_without_plaintext_files(self):
        key, vault = demo_vault.create('i3-fixture')
        password = demo_vault.admin_password('i3-fixture')
        self.assertGreaterEqual(len(password), 12)
        self.assertTrue(vault.read_bytes().startswith(b'$ANSIBLE_VAULT;'))
        self.assertNotIn(password.encode(), vault.read_bytes())
        self.assertEqual(key.stat().st_mode & 0o777, 0o600)
        self.assertEqual(vault.stat().st_mode & 0o777, 0o600)
        with self.assertRaises(FileExistsError):
            demo_vault.create('i3-fixture')
        self.assertEqual(demo_vault.admin_password('i3-fixture'), password)

    def test_rejects_bad_slug_and_insecure_permissions(self):
        with self.assertRaises(ValueError):
            demo_vault.create('../otro')
        key, _ = demo_vault.create('i3-fixture')
        key.chmod(0o644)
        with self.assertRaises(ValueError):
            demo_vault.admin_password('i3-fixture')

    def test_failed_encryption_does_not_leave_key(self):
        with patch.object(demo_vault, 'run_vault', side_effect=RuntimeError('fallo')):
            with self.assertRaises(RuntimeError):
                demo_vault.create('i3-fixture')
        self.assertFalse((self.root / 'keys' / 'i3-fixture.key').exists())

    def test_stage_keeps_inventory_and_variables_private_and_returns_existing_vault_paths(self):
        demo_vault.create('i3-fixture')
        inventory = Path(self.tmp.name) / 'hosts.ini'
        inventory.write_text('[frontend]\ni3-fixture-frontend ansible_host=8.8.8.8\n', encoding='utf-8')
        artifacts = []
        for name in ('source.tar.gz', 'wheels.tar.gz', 'build.tar.gz', 'psycopg2.deb'):
            path = Path(self.tmp.name) / name
            path.write_bytes(b'local-fixture')
            artifacts.append(str(path))
        variables = {
            'tenant_slug': 'i3-fixture', 'admin_name': 'Admin', 'admin_email': 'admin@example.test',
            'certbot_email': 'admin@example.test', 'institution_name': 'Fixture',
            'tenant_plan_name': 'Estándar', 'backend_revision': 'a' * 40,
            'backend_source_archive': artifacts[0], 'backend_wheels_archive': artifacts[1],
            'frontend_revision': 'b' * 40, 'frontend_build_archive': artifacts[2],
            'frontend_build_sha256': 'c' * 64, 'frontend_server_name': '8.8.8.8',
            'frontend_public_ip': '8.8.8.8', 'backend_private_ip': '10.0.0.10',
            'database_private_ip': '10.0.0.20', 'backend_port': 8000,
            'postgresql_psycopg_deb': artifacts[3],
        }
        demo_vault.stage('i3-fixture', {'inventory': str(inventory), 'variables': variables})
        paths = demo_vault.tenant_paths('i3-fixture')
        inventory_copy = Path(paths['inventory'])
        variables_copy = Path(paths['variables'])
        self.assertEqual(inventory_copy.read_text(encoding='utf-8'), inventory.read_text(encoding='utf-8'))
        self.assertEqual(inventory_copy.stat().st_mode & 0o777, 0o600)
        self.assertEqual(variables_copy.stat().st_mode & 0o777, 0o600)
        self.assertEqual(Path(paths['vault']), self.root / 'vaults' / 'i3-fixture.vault')
        self.assertEqual(Path(paths['vault_password_file']), self.root / 'keys' / 'i3-fixture.key')
        with self.assertRaises(FileExistsError):
            demo_vault.stage('i3-fixture', {'inventory': str(inventory), 'variables': variables})


if __name__ == '__main__':
    unittest.main()
