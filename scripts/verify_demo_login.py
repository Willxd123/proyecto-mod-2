"""Verifica HTTPS y el login inicial sin imprimir ni devolver la contraseña."""
import argparse
import http.cookiejar
import ipaddress
import json
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.request

from demo_vault import admin_password

ROOT = Path(__file__).resolve().parent.parent
SLUG = re.compile(r'[a-z][a-z0-9-]{2,39}\Z')
DEMO_RESULTS = ROOT / 'output' / 'demo'
HANDOFF = ROOT / 'output' / 'handoff'


def verify(slug):
    if not isinstance(slug, str) or not SLUG.fullmatch(slug):
        raise ValueError('Tenant inválido.')
    request_path = HANDOFF / slug / 'request.json'
    result_path = DEMO_RESULTS / slug / 'provisioning-result.json'
    if (HANDOFF.is_symlink() or (HANDOFF / slug).is_symlink() or request_path.is_symlink()
            or DEMO_RESULTS.is_symlink() or (DEMO_RESULTS / slug).is_symlink() or result_path.is_symlink()):
        raise ValueError('Solicitud o resultado inválido.')
    if request_path.stat().st_size > 1024 * 1024 or result_path.stat().st_size > 1024 * 1024:
        raise ValueError('Solicitud o resultado demasiado grande.')
    request = json.loads(request_path.read_text(encoding='utf-8'))
    result = json.loads(result_path.read_text(encoding='utf-8'))
    if request.get('tenant_slug') != slug or result.get('tenant_slug') != slug or result.get('request_id') != request.get('request_id'):
        raise ValueError('Solicitud y recursos no coinciden.')
    ip = ipaddress.ip_address(result['nodes']['frontend']['public_ip'])
    if not isinstance(ip, ipaddress.IPv4Address) or not ip.is_global:
        raise ValueError('IP del frontend inválida.')
    base = 'https://' + str(ip)
    jar = http.cookiejar.CookieJar()

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, new_url):
            return None

    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(jar), NoRedirect())

    def call(method, route, payload=None, headers=None, timeout=20):
        data = json.dumps(payload).encode() if payload is not None else None
        request = urllib.request.Request(base + route, data=data, method=method, headers=headers or {})
        try:
            return opener.open(request, timeout=timeout)
        except urllib.error.HTTPError as error:
            return error

    deadline = time.monotonic() + 300
    while time.monotonic() < deadline:
        try:
            response = call('GET', '/api/health', timeout=10)
            if response.status == 200:
                break
        except (urllib.error.URLError, TimeoutError, OSError):
            pass
        time.sleep(10)
    else:
        return False
    csrf = call('GET', '/api/auth/csrf')
    if csrf.status != 200:
        return False
    token = next((cookie.value for cookie in jar if cookie.name == 'csrftoken'), '')
    if not token:
        return False
    headers = {'Content-Type': 'application/json', 'X-CSRFToken': token,
               'Referer': base + '/', 'Origin': base}
    login = call('POST', '/api/auth/login/admin',
                 {'correo': request['admin_email'], 'password': admin_password(slug)}, headers)
    if login.status != 200:
        return False
    modules = call('GET', '/api/admin/modules')
    if modules.status != 200:
        return False
    logout = call('POST', '/api/auth/logout', {}, headers)
    return logout.status == 200


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tenant', required=True)
    args = parser.parse_args()
    try:
        verified = verify(args.tenant)
    except (OSError, ValueError, KeyError, TypeError):
        verified = False
    print(json.dumps({'verified': verified}))
    return 0 if verified else 1


if __name__ == '__main__':
    sys.exit(main())
