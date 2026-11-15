"""Pruebas del exporter de peticiones HTTP (Nginx → Prometheus). No necesita Nginx ni red."""
import importlib.util
from pathlib import Path
import tempfile
import threading
import time
import unittest

RUTA = Path(__file__).resolve().parent.parent / 'infrastructure' / 'ansible' / 'roles' / 'frontend' / 'files' / 'tcc_nginx_exporter.py'
spec = importlib.util.spec_from_file_location('tcc_nginx_exporter', RUTA)
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


def valor(texto, prefijo):
    lineas = [linea for linea in texto.splitlines() if linea.startswith(prefijo)]
    return float(lineas[0].rsplit(' ', 1)[1]) if lineas else None


class ExporterTests(unittest.TestCase):
    def test_normaliza_identificadores_y_agrupa_lo_estatico(self):
        self.assertEqual(exporter.normalize('/api/students/123'), '/api/students/:id')
        self.assertEqual(exporter.normalize('/api/courses/9f1c2a3b-1111-4222-8333-444455556666/attendance'), '/api/courses/:id/attendance')
        self.assertEqual(exporter.normalize('/api/auth/login/admin?x=1'), '/api/auth/login/admin')
        self.assertEqual(exporter.normalize('/assets/app.js'), '/estaticos')
        self.assertEqual(exporter.normalize('/'), '/estaticos')

    def test_cuenta_peticiones_errores_y_duraciones(self):
        m = exporter.Metrics()
        for linea in ('1731650000.123 GET /api/students/5 200 0.040', '1731650001.000 GET /api/students/6 200 0.300',
                      '1731650002.000 GET /api/students/7 500 1.200', 'basura que no es una línea', '1731650003.000 GET /index.html 200 0.002'):
            m.feed(linea)
        texto = m.render()
        self.assertEqual(valor(texto, 'tcc_http_requests_total{route="/api/students/:id",method="GET",status="200"}'), 2)
        self.assertEqual(valor(texto, 'tcc_http_requests_total{route="/api/students/:id",method="GET",status="500"}'), 1)
        self.assertEqual(valor(texto, 'tcc_http_errors_total{route="/api/students/:id"}'), 1)
        self.assertEqual(valor(texto, 'tcc_http_request_duration_seconds_count{route="/api/students/:id"}'), 3)
        self.assertAlmostEqual(valor(texto, 'tcc_http_request_duration_seconds_sum{route="/api/students/:id"}'), 1.54, places=3)
        self.assertEqual(valor(texto, 'tcc_http_request_duration_seconds_bucket{route="/api/students/:id",le="0.05"}'), 1)
        self.assertEqual(valor(texto, 'tcc_http_request_duration_seconds_bucket{route="/api/students/:id",le="0.5"}'), 2)
        self.assertEqual(valor(texto, 'tcc_http_request_duration_seconds_bucket{route="/api/students/:id",le="+Inf"}'), 3)
        self.assertEqual(valor(texto, 'tcc_http_requests_total{route="/estaticos",method="GET",status="200"}'), 1)

    def test_cuenta_los_inicios_de_sesion_fallidos_solo_en_la_ruta_de_login(self):
        m = exporter.Metrics()
        for linea in ('1.0 POST /api/auth/login/admin 401 0.05', '2.0 POST /api/auth/login/admin 200 0.05', '3.0 POST /api/auth/login 403 0.05',
                      '4.0 GET /api/auth/login 401 0.05', '5.0 POST /api/students 400 0.05', '6.0 POST /api/auth/logout 401 0.05'):
            m.feed(linea)
        texto = m.render()
        self.assertEqual(valor(texto, 'tcc_login_attempts_total{result="failed"}'), 2)
        self.assertEqual(valor(texto, 'tcc_login_attempts_total{result="ok"}'), 1)

    def test_limita_la_cantidad_de_rutas_distintas(self):
        m = exporter.Metrics()
        for n in range(exporter.MAX_ROUTES + 25):
            m.feed(f'1.0 GET /api/ruta{n}/x 200 0.01')
        self.assertLessEqual(len(m.routes), exporter.MAX_ROUTES)
        self.assertIn('route="otros"', m.render())

    def test_no_publica_direcciones_ni_parametros(self):
        m = exporter.Metrics()
        m.feed('1.0 GET /api/students?dni=12345678&token=abc 200 0.01')
        texto = m.render()
        self.assertNotIn('12345678', texto)
        self.assertNotIn('token', texto)

    def test_sigue_el_archivo_desde_el_final_y_cuenta_solo_lo_nuevo(self):
        with tempfile.TemporaryDirectory() as carpeta:
            archivo = Path(carpeta) / 'metrics.log'
            archivo.write_text('0.0 GET /api/viejo 200 0.01\n', encoding='utf-8')
            m, parar = exporter.Metrics(), threading.Event()
            hilo = threading.Thread(target=exporter.follow, args=(str(archivo), m, parar, 0.05), daemon=True)
            hilo.start()
            time.sleep(0.3)
            with archivo.open('a', encoding='utf-8') as salida:
                salida.write('1.0 GET /api/nuevo 200 0.02\n')
                salida.write('2.0 GET /api/nuevo 5')  # línea incompleta: no se cuenta hasta que termine
                salida.flush()
                time.sleep(0.3)
                self.assertEqual(sum(m.requests.values()), 1)
                salida.write('00 0.03\n')
            time.sleep(0.4)
            parar.set()
            hilo.join(timeout=2)
            self.assertEqual(valor(m.render(), 'tcc_http_requests_total{route="/api/nuevo",method="GET",status="200"}'), 1)
            self.assertEqual(valor(m.render(), 'tcc_http_requests_total{route="/api/nuevo",method="GET",status="500"}'), 1)
            self.assertNotIn('/api/viejo', m.render())


if __name__ == '__main__':
    unittest.main()
