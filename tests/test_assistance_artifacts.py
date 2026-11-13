import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('prepare_assistance_artifacts', ROOT / 'scripts' / 'prepare_assistance_artifacts.py')
artifacts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(artifacts)


class AssistanceArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.config = {'backend': 'https://github.com/example/backend', 'frontend': 'https://github.com/example/frontend'}
        self.revisions = {'backend': 'a' * 40, 'frontend': 'b' * 40}

    def test_config_accepts_only_github_urls_without_credentials(self):
        config = self.root / 'config.json'
        with patch.object(artifacts, 'CONFIG', config):
            config.write_text(json.dumps(self.config), encoding='utf-8')
            self.assertEqual(artifacts.load_config(), self.config)
            for url in ('https://user:secret@github.com/example/backend', 'file:///tmp/repo',
                        'https://example.com/repo', 'https://github.com/a/b?token=secret'):
                config.write_text(json.dumps(dict(self.config, backend=url)), encoding='utf-8')
                with self.subTest(url=url), self.assertRaises(artifacts.PreparationError):
                    artifacts.load_config()

    def test_existing_release_is_verified_and_corruption_is_rejected(self):
        directory = self.root / 'release'
        directory.mkdir()
        for name in artifacts.FILES:
            (directory / name).write_bytes(name.encode())
        manifest = {'sources': self.config, 'revisions': self.revisions,
                    'sha256': {name: artifacts.digest(directory / name) for name in artifacts.FILES}}
        (directory / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
        self.assertTrue(artifacts.verify_release(directory, self.config, self.revisions))
        (directory / 'build.tar.gz').write_bytes(b'damaged')
        with self.assertRaises(artifacts.PreparationError):
            artifacts.verify_release(directory, self.config, self.revisions)

    def test_build_reuses_release_and_preserves_existing_files(self):
        output = self.root / 'releases'
        directory = output / 'release'
        calls = []

        def fake_build(work, staging, config, revisions):
            calls.append(True)
            for name in artifacts.FILES:
                (staging / name).write_bytes(name.encode())

        with patch.object(artifacts, 'OUTPUT', output), patch.object(artifacts, 'make_archives', fake_build), \
                patch.object(artifacts, 'node_tools', return_value=(['node'], ['npm'])), \
                patch.object(artifacts, 'command', return_value='test-version'):
            artifacts.prepare(self.config, self.revisions, directory)
            artifacts.prepare(self.config, self.revisions, directory)
            self.assertEqual(len(calls), 1)
            self.assertTrue(artifacts.verify_release(directory, self.config, self.revisions))
            self.assertFalse((output / '.preparation.lock').exists())

    def test_lock_rejects_simultaneous_preparation(self):
        output = self.root / 'releases'
        (output / '.preparation.lock').mkdir(parents=True)
        with patch.object(artifacts, 'OUTPUT', output), self.assertRaises(artifacts.PreparationError):
            artifacts.prepare(self.config, self.revisions, output / 'release')

    def test_release_identity_changes_with_sources_and_revisions(self):
        original = artifacts.release_id(self.config, self.revisions)
        self.assertNotEqual(original, artifacts.release_id(self.config, dict(self.revisions, frontend='c' * 40)))
        self.assertNotEqual(original, artifacts.release_id(dict(self.config, backend='https://github.com/other/backend'), self.revisions))

    def test_prepare_rejects_revisions_that_changed_after_confirmation(self):
        argv = ['prepare_assistance_artifacts.py', 'prepare', '--backend', 'c' * 40, '--frontend', 'b' * 40]
        with patch.object(sys, 'argv', argv), \
                patch.object(artifacts, 'inspect', return_value=(self.config, self.revisions, self.root, False)), \
                patch.object(artifacts, 'prepare') as prepare, self.assertRaises(artifacts.PreparationError):
            artifacts.main()
        prepare.assert_not_called()


if __name__ == '__main__':
    unittest.main()
