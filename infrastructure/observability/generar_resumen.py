"""Tablero de inicio de Grafana: «Resumen de la plataforma». Lo ejecuta generar_grafana.py y reutiliza sus ayudantes (DS, SI_NO, PORCENTAJE, base)."""
import json
import os

_ids2 = iter(range(1, 100))
SCOPE = 'scope="tenant"'
PANEL_URL = 'http://localhost:4200'
VERDE_ROJO_1 = [{'color': 'red', 'value': None}, {'color': 'green', 'value': 1}]
ROJO_VERDE_3 = [{'color': 'red', 'value': None}, {'color': 'orange', 'value': 2}, {'color': 'green', 'value': 3}]
LOGINS = [{'color': 'green', 'value': None}, {'color': 'orange', 'value': 5}, {'color': 'red', 'value': 10}]


def kpi(titulo, x, expr, descripcion, unidad=None, umbrales=None, decimales=None):
    """Tarjeta con un solo número para la fila superior del resumen."""
    campos = {'defaults': {'color': {'mode': 'thresholds'}, 'thresholds': {'mode': 'absolute', 'steps': umbrales or [{'color': 'blue', 'value': None}]}}, 'overrides': []}
    if unidad:
        campos['defaults']['unit'] = unidad
    if decimales is not None:
        campos['defaults']['decimals'] = decimales
    return {'id': next(_ids2), 'title': titulo, 'type': 'stat', 'description': descripcion, 'datasource': DS, 'gridPos': {'x': x, 'y': 0, 'w': 4, 'h': 4},
            'fieldConfig': campos, 'targets': [{'refId': 'A', 'datasource': DS, 'expr': expr, 'instant': True}],
            'options': {'reduceOptions': {'calcs': ['lastNotNull'], 'fields': '', 'values': False}, 'colorMode': 'background', 'graphMode': 'none', 'textMode': 'value'}}


def serie(titulo, x, y, expr, unidad, maximo=None):
    campos = {'defaults': {'unit': unidad, 'min': 0, 'custom': {}}, 'overrides': []}
    if maximo:
        campos['defaults']['max'] = maximo
    return {'id': next(_ids2), 'title': titulo, 'type': 'timeseries', 'datasource': DS, 'gridPos': {'x': x, 'y': y, 'w': 12, 'h': 8}, 'fieldConfig': campos,
            'targets': [{'refId': 'A', 'datasource': DS, 'expr': expr, 'legendFormat': '{{tenant}}'}]}


def sobrescribir(columna, propiedades):
    return {'matcher': {'id': 'byName', 'options': columna}, 'properties': propiedades}


COLUMNAS = [
    ('A', 'Servidores arriba (de 3)', f'count by (tenant) (up{{{SCOPE}, job="tenant-nodes"}} == 1)'),
    ('B', 'API responde', f'max by (tenant) (probe_success{{{SCOPE}, job="tenant-http"}})'),
    ('C', 'Latencia p95 (ms)', f'1000 * histogram_quantile(0.95, sum by (le, tenant) (rate(tcc_http_request_duration_seconds_bucket{{{SCOPE}, route!="/estaticos"}}[5m])))'),
    ('D', 'Peticiones/s', f'sum by (tenant) (rate(tcc_http_requests_total{{{SCOPE}}}[2m]))'),
    ('E', 'CPU %', f'100 - avg by (tenant) (rate(node_cpu_seconds_total{{{SCOPE}, mode="idle"}}[2m])) * 100'),
    ('F', 'Memoria %', f'100 * avg by (tenant) (1 - node_memory_MemAvailable_bytes{{{SCOPE}}} / node_memory_MemTotal_bytes{{{SCOPE}}})'),
    ('G', 'Logins fallidos (5 min)', f'sum by (tenant) (increase(tcc_login_attempts_total{{{SCOPE}, result="failed"}}[5m]))'),
]
FONDO = {'id': 'custom.cellOptions', 'value': {'type': 'color-background'}}
TEXTO = {'id': 'custom.cellOptions', 'value': {'type': 'color-text'}}

tabla = {
    'id': next(_ids2), 'title': 'Estado de cada tenant', 'type': 'table', 'datasource': DS, 'gridPos': {'x': 0, 'y': 4, 'w': 24, 'h': 9},
    'description': 'Una fila por tenant monitoreado. Abre «Salud por tenant» para el detalle.',
    'targets': [{'refId': ref, 'datasource': DS, 'expr': expr, 'instant': True, 'format': 'table'} for ref, _, expr in COLUMNAS],
    'transformations': [
        {'id': 'merge', 'options': {}},
        {'id': 'organize', 'options': {'excludeByName': {'Time': True}, 'indexByName': {'tenant': 0}, 'renameByName': {'tenant': 'Tenant', **{f'Value #{ref}': name for ref, name, _ in COLUMNAS}}}},
    ],
    'fieldConfig': {'defaults': {'custom': {'align': 'auto', 'cellOptions': {'type': 'auto'}}, 'decimals': 1}, 'overrides': [
        sobrescribir('API responde', [{'id': 'mappings', 'value': SI_NO}, {'id': 'decimals', 'value': 0}, FONDO, {'id': 'thresholds', 'value': {'mode': 'absolute', 'steps': VERDE_ROJO_1}}]),
        sobrescribir('Servidores arriba (de 3)', [{'id': 'decimals', 'value': 0}, FONDO, {'id': 'thresholds', 'value': {'mode': 'absolute', 'steps': ROJO_VERDE_3}}]),
        sobrescribir('CPU %', [{'id': 'unit', 'value': 'percent'}, TEXTO, {'id': 'thresholds', 'value': {'mode': 'absolute', 'steps': PORCENTAJE}}]),
        sobrescribir('Memoria %', [{'id': 'unit', 'value': 'percent'}, TEXTO, {'id': 'thresholds', 'value': {'mode': 'absolute', 'steps': PORCENTAJE}}]),
        sobrescribir('Latencia p95 (ms)', [{'id': 'unit', 'value': 'ms'}]),
        sobrescribir('Logins fallidos (5 min)', [{'id': 'decimals', 'value': 0}, TEXTO, {'id': 'thresholds', 'value': {'mode': 'absolute', 'steps': LOGINS}}]),
    ]},
    'options': {'showHeader': True, 'cellHeight': 'sm'},
}

resumen = {
    'uid': 'plataforma', 'title': 'Resumen de la plataforma', 'tags': ['tenant-control-center'], 'timezone': 'browser', 'schemaVersion': 39, 'version': 1,
    'refresh': '15s', 'time': {'from': 'now-1h', 'to': 'now'}, 'editable': False, 'graphTooltip': 1,
    'description': 'Vista general de todos los tenants: cuántos hay, si responden, tráfico, errores y alertas. Es la página de inicio de Grafana.',
    'links': [
        {'title': 'Salud por tenant', 'type': 'link', 'url': '/d/tenant-health', 'icon': 'dashboard', 'targetBlank': False, 'keepTime': True},
        {'title': 'Panel: monitoreo y alertas', 'type': 'link', 'url': f'{PANEL_URL}/monitoreo', 'icon': 'bolt', 'targetBlank': True},
        {'title': 'Panel: logs de los tenants', 'type': 'link', 'url': f'{PANEL_URL}/logs', 'icon': 'doc', 'targetBlank': True},
        {'title': 'Panel: auditoría', 'type': 'link', 'url': f'{PANEL_URL}/auditoria', 'icon': 'info-circle', 'targetBlank': True},
    ],
    'templating': {'list': []}, 'annotations': {'list': []},
    'panels': [
        kpi('Tenants monitoreados', 0, f'count(count by (tenant) (up{{{SCOPE}, job="tenant-nodes"}}))', 'Tenants con servidores conectados al monitoreo.'),
        kpi('Servidores arriba', 4, f'sum(up{{{SCOPE}, job="tenant-nodes"}})', 'Servidores de tenants que responden (3 por tenant).', umbrales=VERDE_ROJO_1),
        kpi('Aplicaciones que responden', 8, f'sum(probe_success{{{SCOPE}, job="tenant-http"}})', 'Tenants cuya API devuelve 200 en /api/health.', umbrales=VERDE_ROJO_1),
        kpi('Peticiones por segundo', 12, f'sum(rate(tcc_http_requests_total{{{SCOPE}}}[2m]))', 'Tráfico total de las aplicaciones.', unidad='reqps', decimales=2),
        kpi('Errores 5xx (%)', 16, f'100 * sum(rate(tcc_http_errors_total{{{SCOPE}}}[5m])) / sum(rate(tcc_http_requests_total{{{SCOPE}}}[5m]))', 'Parte de las peticiones que terminan en error del backend.',
            unidad='percent', umbrales=[{'color': 'green', 'value': None}, {'color': 'orange', 'value': 1}, {'color': 'red', 'value': 5}], decimales=2),
        kpi('Logins fallidos (5 min)', 20, f'sum(increase(tcc_login_attempts_total{{{SCOPE}, result="failed"}}[5m]))', 'Inicios de sesión rechazados en todas las aplicaciones.', umbrales=LOGINS, decimales=0),
        tabla,
        {'id': next(_ids2), 'title': 'Alertas activas de todos los tenants', 'type': 'alertlist', 'datasource': DS, 'gridPos': {'x': 0, 'y': 13, 'w': 24, 'h': 8},
         'options': {'alertInstanceLabelFilter': '', 'alertName': '', 'dashboardAlerts': False, 'groupBy': [], 'groupMode': 'default', 'maxItems': 20, 'sortOrder': 1,
                     'stateFilter': {'firing': True, 'pending': True, 'noData': False, 'normal': False, 'error': True}, 'viewMode': 'list'}},
        serie('Peticiones por segundo por tenant', 0, 21, f'sum by (tenant) (rate(tcc_http_requests_total{{{SCOPE}}}[2m]))', 'reqps'),
        serie('CPU por tenant (%)', 12, 21, f'100 - avg by (tenant) (rate(node_cpu_seconds_total{{{SCOPE}, mode="idle"}}[2m])) * 100', 'percent', 100),
    ],
}
with open(os.path.join(base, 'dashboards', 'plataforma.json'), 'w', encoding='utf-8', newline='\n') as f:
    json.dump(resumen, f, indent=2, ensure_ascii=False)
    f.write('\n')
print('resumen de la plataforma:', len(resumen['panels']), 'paneles')
