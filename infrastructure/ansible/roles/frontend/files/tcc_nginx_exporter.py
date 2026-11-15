#!/usr/bin/env python3
"""Exporter de métricas de peticiones HTTP del tenant, a partir del registro de Nginx (solo biblioteca estándar).

Nginx escribe una línea por petición con el formato `tcc_metrics`: "<msec> <método> <uri> <estado> <segundos>". No hay
direcciones IP, cabeceras, cookies ni parámetros de consulta. Este programa las cuenta y las publica en formato Prometheus
en 127.0.0.1:9102 (el panel lo alcanza por un túnel SSH):

  tcc_http_requests_total{route,method,status}      peticiones por ruta, método y código
  tcc_http_request_duration_seconds{route,le}       histograma de la duración por ruta
  tcc_http_errors_total{route}                      respuestas 5xx
  tcc_login_attempts_total{result}                  inicios de sesión: ok o failed (400, 401 o 403 en /api/auth/login)
"""
import argparse
import os
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BUCKETS = (0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0)
MAX_ROUTES = 200
LINE = re.compile(r'^(?P<msec>\d+(?:\.\d+)?) (?P<method>[A-Z]+) (?P<uri>\S+) (?P<status>\d{3}) (?P<time>\d+(?:\.\d+)?)$')
IDENTIFIER = re.compile(r'^(?:\d+|[0-9a-fA-F]{8}-[0-9a-fA-F-]{27}|[0-9a-fA-F]{16,})$')
LOGIN_ROUTE = re.compile(r'^/api/auth/login(?:/[a-z]+)?$')


def normalize(uri):
    """Reduce el URI a una plantilla de ruta para limitar las etiquetas: /api/students/12 -> /api/students/:id."""
    path = uri.split('?', 1)[0]
    if not path.startswith('/api/'):
        return '/estaticos'
    parts = [':id' if IDENTIFIER.match(part) else part for part in path.rstrip('/').split('/')]
    return '/'.join(parts)[:120] or '/api'


class Metrics:
    """Contadores en memoria protegidos por un candado; render produce el texto de /metrics."""
    def __init__(self):
        self.lock = threading.Lock()
        self.requests, self.errors, self.logins = {}, {}, {'ok': 0, 'failed': 0}
        self.buckets, self.sums, self.counts = {}, {}, {}
        self.routes = set()

    def record(self, method, uri, status, seconds):
        route = normalize(uri)
        with self.lock:
            if route not in self.routes:
                if len(self.routes) >= MAX_ROUTES:
                    route = 'otros'
                else:
                    self.routes.add(route)
            key = (route, method, str(status))
            self.requests[key] = self.requests.get(key, 0) + 1
            if status >= 500:
                self.errors[route] = self.errors.get(route, 0) + 1
            histogram = self.buckets.setdefault(route, [0] * len(BUCKETS))
            for index, limit in enumerate(BUCKETS):
                if seconds <= limit:
                    histogram[index] += 1
            self.sums[route] = self.sums.get(route, 0.0) + seconds
            self.counts[route] = self.counts.get(route, 0) + 1
            if method == 'POST' and LOGIN_ROUTE.match(uri.split('?', 1)[0]):
                if status in (400, 401, 403):
                    self.logins['failed'] += 1
                elif status == 200:
                    self.logins['ok'] += 1

    def feed(self, line):
        match = LINE.match(line.strip())
        if match:
            self.record(match['method'], match['uri'], int(match['status']), float(match['time']))

    def render(self):
        with self.lock:
            out = ['# HELP tcc_http_requests_total Peticiones HTTP por ruta, método y código.', '# TYPE tcc_http_requests_total counter']
            for (route, method, status), value in sorted(self.requests.items()):
                out.append(f'tcc_http_requests_total{{route="{route}",method="{method}",status="{status}"}} {value}')
            out += ['# HELP tcc_http_request_duration_seconds Duración de las peticiones por ruta.', '# TYPE tcc_http_request_duration_seconds histogram']
            for route in sorted(self.counts):
                for limit, value in zip(BUCKETS, self.buckets[route]):
                    out.append(f'tcc_http_request_duration_seconds_bucket{{route="{route}",le="{limit}"}} {value}')
                out.append(f'tcc_http_request_duration_seconds_bucket{{route="{route}",le="+Inf"}} {self.counts[route]}')
                out.append(f'tcc_http_request_duration_seconds_sum{{route="{route}"}} {self.sums[route]:.6f}')
                out.append(f'tcc_http_request_duration_seconds_count{{route="{route}"}} {self.counts[route]}')
            out += ['# HELP tcc_http_errors_total Respuestas 5xx por ruta.', '# TYPE tcc_http_errors_total counter']
            for route, value in sorted(self.errors.items()):
                out.append(f'tcc_http_errors_total{{route="{route}"}} {value}')
            out += ['# HELP tcc_login_attempts_total Inicios de sesión de la aplicación por resultado.', '# TYPE tcc_login_attempts_total counter']
            for result, value in self.logins.items():
                out.append(f'tcc_login_attempts_total{{result="{result}"}} {value}')
            return '\n'.join(out) + '\n'


def follow(path, metrics, stop, poll=0.5):
    """Sigue el archivo desde su final; reabre si Nginx lo rota (cambia el inodo o se trunca)."""
    handle, inode = None, None
    while not stop.is_set():
        try:
            status = os.stat(path)
            if handle is None or status.st_ino != inode or status.st_size < handle.tell():
                if handle:
                    handle.close()
                handle = open(path, 'rb')
                if inode is None:
                    handle.seek(0, os.SEEK_END)
                inode = status.st_ino
            line = handle.readline()
            if line.endswith(b'\n'):
                metrics.feed(line.decode('utf-8', 'replace'))
                continue
            if line:
                handle.seek(-len(line), os.SEEK_CUR)
        except (FileNotFoundError, PermissionError):
            handle, inode = None, None
        stop.wait(poll)
    if handle:
        handle.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--log', required=True)
    parser.add_argument('--listen', default='127.0.0.1:9102')
    args = parser.parse_args()
    metrics, stop = Metrics(), threading.Event()
    host, port = args.listen.rsplit(':', 1)
    if host not in ('127.0.0.1', 'localhost'):
        raise SystemExit('El exporter solo escucha en la dirección local.')

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path != '/metrics':
                self.send_error(404)
                return
            body = metrics.render().encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            return

    threading.Thread(target=follow, args=(args.log, metrics, stop), daemon=True).start()
    try:
        ThreadingHTTPServer((host, int(port)), Handler).serve_forever()
    finally:
        stop.set()


if __name__ == '__main__':
    main()
