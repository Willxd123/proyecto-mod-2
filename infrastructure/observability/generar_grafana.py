"""Genera el tablero y las reglas de alerta de Grafana como código (provisioning)."""
import json
import os

# Uso: python infrastructure/observability/generar_grafana.py  (regenera el tablero y las reglas de alerta)
base = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'grafana')
DS = {'type': 'prometheus', 'uid': 'prometheus'}
FILTRO = 'scope="tenant", tenant=~"$tenant", environment=~"$environment"'
_ids = iter(range(1, 100))


def panel(titulo, tipo, x, y, w, h, consultas, descripcion='', unidad=None, minimo=None, maximo=None, mapeos=None, umbrales=None, opciones=None):
    campos = {'defaults': {'color': {'mode': 'palette-classic'}, 'custom': {}}, 'overrides': []}
    if unidad:
        campos['defaults']['unit'] = unidad
    if minimo is not None:
        campos['defaults']['min'] = minimo
    if maximo is not None:
        campos['defaults']['max'] = maximo
    if mapeos:
        campos['defaults']['mappings'] = mapeos
    if umbrales:
        campos['defaults']['color'] = {'mode': 'thresholds'}
        campos['defaults']['thresholds'] = {'mode': 'absolute', 'steps': umbrales}
    resultado = {'id': next(_ids), 'title': titulo, 'type': tipo, 'description': descripcion, 'datasource': DS,
                 'gridPos': {'x': x, 'y': y, 'w': w, 'h': h}, 'fieldConfig': campos,
                 'targets': [{'refId': chr(65 + i), 'datasource': DS, 'expr': expr, 'legendFormat': leyenda, 'instant': tipo in ('stat', 'table')}
                             for i, (expr, leyenda) in enumerate(consultas)]}
    if opciones:
        resultado['options'] = opciones
    return resultado


SI_NO = [{'type': 'value', 'options': {'1': {'text': 'ARRIBA', 'color': 'green'}, '0': {'text': 'CAÍDO', 'color': 'red'}}}]
VERDE_ROJO = [{'color': 'red', 'value': None}, {'color': 'green', 'value': 1}]
PORCENTAJE = [{'color': 'green', 'value': None}, {'color': 'orange', 'value': 70}, {'color': 'red', 'value': 85}]
ESTADO = {'reduceOptions': {'calcs': ['lastNotNull'], 'fields': '', 'values': False}, 'colorMode': 'background', 'graphMode': 'none', 'textMode': 'value_and_name'}

paneles = [
    panel('Disponibilidad de los servidores (RF-26)', 'stat', 0, 0, 12, 5,
          [(f'up{{{FILTRO}, job="tenant-nodes"}}', '{{tenant}} · {{role}}')],
          'Cada servidor del tenant responde a su node_exporter.', mapeos=SI_NO, umbrales=VERDE_ROJO, opciones=ESTADO),
    panel('Aplicación de asistencia (HTTPS)', 'stat', 12, 0, 6, 5,
          [(f'probe_success{{{FILTRO}, job="tenant-http"}}', '{{tenant}}')],
          'La API del tenant responde 200 en /api/health.', mapeos=SI_NO, umbrales=VERDE_ROJO, opciones=ESTADO),
    panel('Estado de PostgreSQL', 'stat', 18, 0, 6, 5,
          [(f'pg_up{{{FILTRO}, job="tenant-postgres"}}', '{{tenant}}')],
          'El servicio PostgreSQL del tenant acepta conexiones (postgres_exporter).', mapeos=SI_NO, umbrales=VERDE_ROJO, opciones=ESTADO),
    panel('Uso de CPU (%)', 'timeseries', 0, 5, 12, 8,
          [(f'100 - (avg by (tenant, role) (rate(node_cpu_seconds_total{{{FILTRO}, mode="idle"}}[2m])) * 100)', '{{tenant}} · {{role}}')],
          unidad='percent', minimo=0, maximo=100),
    panel('Uso de memoria (%)', 'timeseries', 12, 5, 12, 8,
          [(f'100 * (1 - node_memory_MemAvailable_bytes{{{FILTRO}}} / node_memory_MemTotal_bytes{{{FILTRO}}})', '{{tenant}} · {{role}}')],
          unidad='percent', minimo=0, maximo=100),
    panel('Uso de disco (%) — volumen raíz', 'timeseries', 0, 13, 12, 8,
          [(f'100 * (1 - node_filesystem_avail_bytes{{{FILTRO}, mountpoint="/", fstype!~"tmpfs|overlay"}} / node_filesystem_size_bytes{{{FILTRO}, mountpoint="/", fstype!~"tmpfs|overlay"}})', '{{tenant}} · {{role}}')],
          unidad='percent', minimo=0, maximo=100),
    panel('Latencia de la API (ms)', 'timeseries', 12, 13, 12, 8,
          [(f'probe_duration_seconds{{{FILTRO}, job="tenant-http"}} * 1000', '{{tenant}}')], 'Tiempo de respuesta de /api/health medido desde Prometheus.', unidad='ms', minimo=0),
    panel('Errores de la API: fallos en los últimos 5 min (%)', 'timeseries', 0, 21, 12, 8,
          [(f'100 * (1 - avg_over_time(probe_success{{{FILTRO}, job="tenant-http"}}[5m]))', '{{tenant}} fallos'),
           (f'probe_http_status_code{{{FILTRO}, job="tenant-http"}}', '{{tenant}} código HTTP')],
          'Porcentaje de sondas fallidas y el último código HTTP devuelto (5xx = error del backend).', minimo=0),
    panel('Conexiones activas a PostgreSQL', 'timeseries', 12, 21, 12, 8,
          [(f'sum by (tenant) (pg_stat_database_numbackends{{{FILTRO}, datname="control_asistencia"}})', '{{tenant}}')], minimo=0),
    {'id': next(_ids), 'title': 'Aplicación de asistencia — peticiones, latencia por ruta, errores 5xx e inicios de sesión', 'type': 'row', 'collapsed': False, 'gridPos': {'x': 0, 'y': 29, 'w': 24, 'h': 1}, 'panels': []},
    panel('Peticiones por segundo (por ruta)', 'timeseries', 0, 30, 12, 8,
          [(f'sum by (tenant, route) (rate(tcc_http_requests_total{{{FILTRO}, job="tenant-app", route!="/estaticos"}}[2m]))', '{{tenant}} {{route}}')],
          'Tráfico de la API del tenant, medido en Nginx. Las rutas con identificadores se agrupan (:id).', unidad='reqps', minimo=0),
    panel('Latencia p95 por ruta (ms)', 'timeseries', 12, 30, 12, 8,
          [(f'1000 * histogram_quantile(0.95, sum by (le, tenant, route) (rate(tcc_http_request_duration_seconds_bucket{{{FILTRO}, job="tenant-app", route!="/estaticos"}}[5m])))', '{{tenant}} {{route}}')],
          'El 95 % de las peticiones de cada ruta tarda menos que este valor.', unidad='ms', minimo=0),
    panel('Errores 5xx por segundo (por ruta)', 'timeseries', 0, 38, 12, 8,
          [(f'sum by (tenant, route) (rate(tcc_http_errors_total{{{FILTRO}, job="tenant-app"}}[2m]))', '{{tenant}} {{route}}')],
          'Respuestas 5xx del backend. Una ruta que aparece aquí es la que está fallando.', unidad='reqps', minimo=0),
    panel('Inicios de sesión fallidos (últimos 5 min)', 'stat', 12, 38, 6, 8,
          [(f'sum by (tenant) (increase(tcc_login_attempts_total{{{FILTRO}, job="tenant-app", result="failed"}}[5m]))', '{{tenant}}')],
          'Intentos rechazados (400, 401 o 403) en la ruta de login de la aplicación.', umbrales=[{'color': 'green', 'value': None}, {'color': 'orange', 'value': 5}, {'color': 'red', 'value': 10}],
          opciones={'reduceOptions': {'calcs': ['lastNotNull'], 'fields': '', 'values': False}, 'colorMode': 'background', 'graphMode': 'area', 'textMode': 'value_and_name'}),
    panel('Inicios de sesión correctos (últimos 5 min)', 'stat', 18, 38, 6, 8,
          [(f'sum by (tenant) (increase(tcc_login_attempts_total{{{FILTRO}, job="tenant-app", result="ok"}}[5m]))', '{{tenant}}')],
          'Inicios de sesión que respondieron 200.', opciones={'reduceOptions': {'calcs': ['lastNotNull'], 'fields': '', 'values': False}, 'colorMode': 'value', 'graphMode': 'area', 'textMode': 'value_and_name'}),
    panel('Rutas con más tráfico (última hora)', 'bargauge', 0, 46, 12, 8,
          [(f'topk(8, sum by (tenant, route) (increase(tcc_http_requests_total{{{FILTRO}, job="tenant-app", route!="/estaticos"}}[1h])))', '{{tenant}} {{route}}')],
          minimo=0, opciones={'reduceOptions': {'calcs': ['lastNotNull'], 'fields': '', 'values': False}, 'orientation': 'horizontal', 'displayMode': 'gradient'}),
    panel('Respuestas por código HTTP (por segundo)', 'timeseries', 12, 46, 12, 8,
          [(f'sum by (tenant, status) (rate(tcc_http_requests_total{{{FILTRO}, job="tenant-app"}}[2m]))', '{{tenant}} {{status}}')],
          '2xx correctas, 4xx errores del cliente (por ejemplo credenciales inválidas) y 5xx errores del backend.', unidad='reqps', minimo=0),
    {'id': next(_ids), 'title': 'Alertas activas', 'type': 'alertlist', 'datasource': DS, 'gridPos': {'x': 0, 'y': 59, 'w': 24, 'h': 8},
     'options': {'alertInstanceLabelFilter': '{tenant=~"$tenant"}', 'alertName': '', 'dashboardAlerts': False, 'groupBy': [], 'groupMode': 'default',
                 'maxItems': 20, 'sortOrder': 1, 'stateFilter': {'firing': True, 'pending': True, 'noData': False, 'normal': False, 'error': True}, 'viewMode': 'list'}},
]

variables = [
    {'name': 'tenant', 'label': 'Tenant', 'type': 'query', 'datasource': DS, 'query': {'query': 'label_values(up{scope="tenant"}, tenant)', 'refId': 'tenant'},
     'refresh': 2, 'multi': True, 'includeAll': True, 'allValue': '.+', 'current': {'text': 'All', 'value': '$__all'}, 'sort': 1},
    {'name': 'environment', 'label': 'Entorno', 'type': 'query', 'datasource': DS,
     'query': {'query': 'label_values(up{scope="tenant", tenant=~"$tenant"}, environment)', 'refId': 'environment'},
     'refresh': 2, 'multi': True, 'includeAll': True, 'allValue': '.+', 'current': {'text': 'All', 'value': '$__all'}, 'sort': 1},
]

dashboard = {
    'uid': 'tenant-health', 'title': 'Salud por tenant', 'tags': ['tenant-control-center'], 'timezone': 'browser', 'schemaVersion': 39, 'version': 1,
    'refresh': '15s', 'time': {'from': 'now-1h', 'to': 'now'}, 'editable': False, 'graphTooltip': 1,
    'description': 'RF-25 a RF-27: disponibilidad, CPU, memoria, disco, latencia, errores y PostgreSQL por tenant y entorno.',
    'links': [
        {'title': 'Resumen de la plataforma', 'type': 'link', 'url': '/d/plataforma', 'icon': 'apps', 'targetBlank': False},
        {'title': 'Logs de este tenant (panel)', 'type': 'link', 'url': 'http://localhost:4200/logs?tenant=${tenant:raw}', 'icon': 'doc', 'targetBlank': True},
        {'title': 'Panel: monitoreo y alertas', 'type': 'link', 'url': 'http://localhost:4200/monitoreo', 'icon': 'bolt', 'targetBlank': True},
    ],
    'templating': {'list': variables}, 'annotations': {'list': []}, 'panels': paneles,
}
with open(os.path.join(base, 'dashboards', 'tenant-health.json'), 'w', encoding='utf-8', newline='\n') as f:
    json.dump(dashboard, f, indent=2, ensure_ascii=False)
    f.write('\n')


# ---- alertas: Grafana evalúa estas reglas sobre Prometheus y entrega cada alerta al panel por webhook ----
def regla(uid, titulo, expr, comparador, umbral, espera, severidad, resumen, descripcion):
    return {
        'uid': uid, 'title': titulo, 'condition': 'C',
        'data': [
            {'refId': 'A', 'relativeTimeRange': {'from': 600, 'to': 0}, 'datasourceUid': 'prometheus',
             'model': {'expr': expr, 'instant': True, 'intervalMs': 15000, 'maxDataPoints': 43200, 'refId': 'A'}},
            {'refId': 'B', 'datasourceUid': '__expr__', 'model': {'type': 'reduce', 'expression': 'A', 'reducer': 'last', 'refId': 'B', 'settings': {'mode': 'dropNN'}}},
            {'refId': 'C', 'datasourceUid': '__expr__',
             'model': {'type': 'threshold', 'expression': 'B', 'refId': 'C', 'conditions': [{'evaluator': {'type': comparador, 'params': [umbral]}}]}},
        ],
        'noDataState': 'OK', 'execErrState': 'OK', 'for': espera,
        'labels': {'severity': severidad},
        'annotations': {'summary': resumen, 'description': descripcion},
    }


F = 'scope="tenant"'
reglas = [
    regla('tcc-servidor-caido', 'Servidor del tenant sin respuesta', f'up{{{F}, job="tenant-nodes"}}', 'lt', 1, '1m', 'critical',
          'Servidor {{ $labels.role }} del tenant {{ $labels.tenant }} sin respuesta', 'Prometheus no puede leer el node_exporter del servidor.'),
    regla('tcc-api-caida', 'API del tenant con errores', f'probe_success{{{F}, job="tenant-http"}}', 'lt', 1, '1m', 'critical',
          'La API del tenant {{ $labels.tenant }} no responde 200', '/api/health falla o devuelve un código de error.'),
    regla('tcc-postgres-caido', 'PostgreSQL del tenant caído', f'pg_up{{{F}, job="tenant-postgres"}}', 'lt', 1, '1m', 'critical',
          'PostgreSQL del tenant {{ $labels.tenant }} no acepta conexiones', 'El postgres_exporter reporta pg_up = 0.'),
    regla('tcc-cpu-alta', 'CPU alta en servidor del tenant', f'100 - (avg by (tenant, environment, role) (rate(node_cpu_seconds_total{{{F}, mode="idle"}}[2m])) * 100)', 'gt', 85, '2m', 'warning',
          'CPU de {{ $labels.role }} del tenant {{ $labels.tenant }} sobre 85%', 'Uso de CPU por encima del límite durante 2 minutos.'),
    regla('tcc-memoria-alta', 'Memoria alta en servidor del tenant', f'100 * (1 - node_memory_MemAvailable_bytes{{{F}}} / node_memory_MemTotal_bytes{{{F}}})', 'gt', 85, '2m', 'warning',
          'Memoria de {{ $labels.role }} del tenant {{ $labels.tenant }} sobre 85%', 'Uso de memoria por encima del límite durante 2 minutos.'),
    regla('tcc-errores-5xx', 'Errores 5xx en la aplicación del tenant',
          f'100 * sum by (tenant) (rate(tcc_http_errors_total{{{F}, job="tenant-app"}}[5m])) / sum by (tenant) (rate(tcc_http_requests_total{{{F}, job="tenant-app"}}[5m]))', 'gt', 5, '2m', 'critical',
          'Más del 5% de las peticiones del tenant {{ $labels.tenant }} devuelven error 5xx', 'El backend de la aplicación está fallando; ver el panel de errores por ruta.'),
    regla('tcc-login-fallidos', 'Muchos inicios de sesión fallidos en el tenant',
          f'sum by (tenant) (increase(tcc_login_attempts_total{{{F}, job="tenant-app", result="failed"}}[5m]))', 'gt', 10, '1m', 'warning',
          'Más de 10 inicios de sesión fallidos en 5 minutos en el tenant {{ $labels.tenant }}', 'Posible ataque de fuerza bruta o un problema con las credenciales.'),
    regla('tcc-disco-alto', 'Disco casi lleno en servidor del tenant', f'100 * (1 - node_filesystem_avail_bytes{{{F}, mountpoint="/", fstype!~"tmpfs|overlay"}} / node_filesystem_size_bytes{{{F}, mountpoint="/", fstype!~"tmpfs|overlay"}})', 'gt', 85, '5m', 'warning',
          'Disco de {{ $labels.role }} del tenant {{ $labels.tenant }} sobre 85%', 'El volumen raíz supera el 85% de uso.'),
]

alertas = '''apiVersion: 1
# Reglas de alerta como código (RF-28). Grafana las evalúa sobre Prometheus y entrega cada alerta al panel
# (POST /api/monitoring/alerts) con el token compartido; el panel la guarda con su tenant y hora (RF-29).
contactPoints:
  - orgId: 1
    name: Tenant Control Center
    receivers:
      - uid: tcc-webhook
        type: webhook
        settings:
          url: ${CONTROL_CENTER_URL}/api/monitoring/alerts
          httpMethod: POST
          authorization_scheme: Bearer
          authorization_credentials: ${WEBHOOK_TOKEN}
          maxAlerts: 20
        disableResolveMessage: false
policies:
  - orgId: 1
    receiver: Tenant Control Center
    group_by: [alertname, tenant, role]
    group_wait: 10s
    group_interval: 1m
    repeat_interval: 1h
groups:
  - orgId: 1
    name: salud-de-tenants
    folder: Tenant Control Center
    interval: 1m
    rules:
'''
for r in reglas:
    bloque = json.dumps(r, ensure_ascii=False, indent=2)
    alertas += '      - ' + bloque.replace('\n', '\n        ')[0:] + '\n'
with open(os.path.join(base, 'provisioning', 'alerting', 'alertas.yaml'), 'w', encoding='utf-8', newline='\n') as f:
    f.write(alertas)
print('ok', len(paneles), 'paneles', len(reglas), 'reglas')


# Tablero de inicio: resumen de toda la plataforma (usa los mismos ayudantes definidos arriba).
exec(compile(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'generar_resumen.py'), encoding='utf-8').read(), 'generar_resumen.py', 'exec'))
