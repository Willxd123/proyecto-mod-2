"""Pruebas aisladas del contrato HTTPS de login inicial."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'scripts'))
import verify_demo_login


class Response:
    def __init__(self, status):
        self.status = status


class LoginVerifierTests(unittest.TestCase):
    def test_verifies_csrf_login_admin_access_and_logout_without_returning_password(self):
        slug = 'i3-fixture'
        calls = []
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            handoff = root / 'handoff' / slug
            result_dir = root / 'demo' / slug
            handoff.mkdir(parents=True)
            result_dir.mkdir(parents=True)
            request_id = 'a' * 32
            (handoff / 'request.json').write_text(json.dumps({
                'tenant_slug': slug, 'request_id': request_id, 'admin_email': 'admin@example.test',
            }), encoding='utf-8')
            (result_dir / 'provisioning-result.json').write_text(json.dumps({
                'tenant_slug': slug, 'request_id': request_id,
                'nodes': {'frontend': {'public_ip': '8.8.8.8'}},
            }), encoding='utf-8')

            class FakeOpener:
                def __init__(self, cookies):
                    self.cookies = cookies

                def open(self, request, timeout):
                    calls.append(request)
                    if request.full_url.endswith('/api/auth/csrf'):
                        cookie = verify_demo_login.http.cookiejar.Cookie(
                            version=0, name='csrftoken', value='csrf-token', port=None, port_specified=False,
                            domain='8.8.8.8', domain_specified=False, domain_initial_dot=False, path='/',
                            path_specified=True, secure=True, expires=None, discard=True, comment=None,
                            comment_url=None, rest={}, rfc2109=False,
                        )
                        self.cookies.set_cookie(cookie)
                    return Response(200)

            def build_fake_opener(*handlers):
                cookies = next(handler.cookiejar for handler in handlers
                               if isinstance(handler, verify_demo_login.urllib.request.HTTPCookieProcessor))
                return FakeOpener(cookies)

            with patch.object(verify_demo_login, 'HANDOFF', root / 'handoff'), \
                    patch.object(verify_demo_login, 'DEMO_RESULTS', root / 'demo'), \
                    patch.object(verify_demo_login, 'admin_password', return_value='synthetic-password'), \
                    patch.object(verify_demo_login.urllib.request, 'build_opener', side_effect=build_fake_opener):
                self.assertTrue(verify_demo_login.verify(slug))

        self.assertEqual(len(calls), 5)
        self.assertTrue(all(call.full_url.startswith('https://8.8.8.8/') for call in calls))
        login = next(call for call in calls if call.full_url.endswith('/api/auth/login/admin'))
        self.assertEqual(json.loads(login.data), {'correo': 'admin@example.test', 'password': 'synthetic-password'})
        self.assertEqual(next(call for call in calls if call.full_url.endswith('/api/admin/modules')).get_method(), 'GET')

    def test_rejects_non_public_frontend_address_before_network_access(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            handoff = root / 'handoff' / 'i3-fixture'
            result_dir = root / 'demo' / 'i3-fixture'
            handoff.mkdir(parents=True)
            result_dir.mkdir(parents=True)
            (handoff / 'request.json').write_text(json.dumps({
                'tenant_slug': 'i3-fixture', 'request_id': 'a' * 32,
            }), encoding='utf-8')
            (result_dir / 'provisioning-result.json').write_text(json.dumps({
                'tenant_slug': 'i3-fixture', 'request_id': 'a' * 32,
                'nodes': {'frontend': {'public_ip': '127.0.0.1'}},
            }), encoding='utf-8')
            with patch.object(verify_demo_login, 'HANDOFF', root / 'handoff'), \
                    patch.object(verify_demo_login, 'DEMO_RESULTS', root / 'demo'), \
                    patch.object(verify_demo_login.urllib.request, 'build_opener') as opener:
                with self.assertRaises(ValueError):
                    verify_demo_login.verify('i3-fixture')
                opener.assert_not_called()


if __name__ == '__main__':
    unittest.main()
