#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

echo "=== Esperando cloud-init ==="
cloud-init status --wait || true

echo "=== Paquetes base ==="
apt-get update -q
apt-get install -y -q \
  ca-certificates curl gnupg tar apt-transport-https \
  prometheus-node-exporter

# node_exporter en este servidor también
systemctl enable --now prometheus-node-exporter
curl --fail --silent http://127.0.0.1:9100/metrics -o /tmp/node-exporter.metrics
grep -q node_exporter_build_info /tmp/node-exporter.metrics
echo "node_exporter OK"

# ── Prometheus (binario) ──────────────────────────────────────────────────────
echo "=== Instalando Prometheus ${PROMETHEUS_VERSION} ==="

useradd --system --no-create-home --shell /usr/sbin/nologin prometheus || true

curl --fail --location --proto '=https' --tlsv1.2 \
  -o /tmp/prometheus.tar.gz \
  "https://github.com/prometheus/prometheus/releases/download/v${PROMETHEUS_VERSION}/prometheus-${PROMETHEUS_VERSION}.linux-amd64.tar.gz"

tar -xzf /tmp/prometheus.tar.gz -C /tmp
install -m 0755 /tmp/prometheus-${PROMETHEUS_VERSION}.linux-amd64/prometheus   /usr/local/bin/prometheus
install -m 0755 /tmp/prometheus-${PROMETHEUS_VERSION}.linux-amd64/promtool     /usr/local/bin/promtool

install -d -o prometheus -g prometheus -m 0755 /etc/prometheus
install -d -o prometheus -g prometheus -m 0755 /var/lib/prometheus
install -d -o prometheus -g prometheus -m 0755 /etc/prometheus/rules
install -d -o prometheus -g prometheus -m 0755 /etc/prometheus/targets/tenants
install -d -o prometheus -g prometheus -m 0755 /etc/prometheus/targets/postgres

# Verificar binario
prometheus --version

# ── Configuración de Prometheus ───────────────────────────────────────────────
cat > /etc/prometheus/prometheus.yml << 'EOF'
global:
  scrape_interval:     15s
  evaluation_interval: 15s
  external_labels:
    proyecto: "proyecto-modulo-2"
    rol:      "observabilidad"

rule_files:
  - "/etc/prometheus/rules/*.yml"

scrape_configs:
  - job_name: "prometheus"
    static_configs:
      - targets: ["localhost:9090"]
        labels:
          scope: "control-center"
          rol:   "observabilidad"

  - job_name: "node-exporter-obs"
    static_configs:
      - targets: ["localhost:9100"]
        labels:
          scope: "control-center"
          rol:   "observabilidad"

  - job_name: "node-exporter-tenants"
    file_sd_configs:
      - files:
          - "/etc/prometheus/targets/tenants/*.yml"
        refresh_interval: 30s

  - job_name: "postgres-exporter-tenants"
    file_sd_configs:
      - files:
          - "/etc/prometheus/targets/postgres/*.yml"
        refresh_interval: 30s
EOF
chown prometheus:prometheus /etc/prometheus/prometheus.yml

# Reglas de alerta
cat > /etc/prometheus/rules/tenant-alerts.yml << 'EOF'
groups:
  - name: tenant-disponibilidad
    rules:
      - alert: TenantServidorInaccesible
        expr: up{scope="tenant"} == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "Servidor {{ $labels.instance }} del tenant {{ $labels.tenant }} inaccesible"
          description: "No se reciben métricas desde hace más de 2 minutos."

  - name: tenant-cpu
    rules:
      - alert: TenantCPUAlta
        expr: >
          100 - (avg by (instance, tenant, environment, role)
            (rate(node_cpu_seconds_total{mode="idle", scope="tenant"}[5m])) * 100) > 85
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "CPU alta en {{ $labels.instance }} (tenant={{ $labels.tenant }})"

  - name: tenant-memoria
    rules:
      - alert: TenantMemoriaBaja
        expr: >
          (node_memory_MemAvailable_bytes{scope="tenant"} /
           node_memory_MemTotal_bytes{scope="tenant"}) * 100 < 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Memoria < 10% en {{ $labels.instance }} (tenant={{ $labels.tenant }})"

  - name: tenant-disco
    rules:
      - alert: TenantDiscoLleno
        expr: >
          (node_filesystem_avail_bytes{fstype!~"tmpfs|overlay", scope="tenant"} /
           node_filesystem_size_bytes{fstype!~"tmpfs|overlay", scope="tenant"}) * 100 < 15
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Disco < 15% libre en {{ $labels.instance }} (tenant={{ $labels.tenant }})"

  - name: tenant-postgres
    rules:
      - alert: TenantPostgresInaccesible
        expr: pg_up{scope="tenant"} == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "PostgreSQL inaccesible en {{ $labels.instance }} (tenant={{ $labels.tenant }})"
EOF
chown -R prometheus:prometheus /etc/prometheus/rules

# Unidad systemd de Prometheus
cat > /etc/systemd/system/prometheus.service << 'EOF'
[Unit]
Description=Prometheus — servidor de métricas
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=prometheus
Group=prometheus
ExecStart=/usr/local/bin/prometheus \
  --config.file=/etc/prometheus/prometheus.yml \
  --storage.tsdb.path=/var/lib/prometheus \
  --storage.tsdb.retention.time=15d \
  --web.listen-address=0.0.0.0:9090 \
  --web.enable-lifecycle
ExecReload=/bin/kill -HUP $MAINPID
Restart=on-failure
RestartSec=5s
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable prometheus

# ── Grafana (apt) ─────────────────────────────────────────────────────────────
echo "=== Instalando Grafana ${GRAFANA_VERSION} ==="

install -d -m 0755 /etc/apt/keyrings
curl --fail --location --proto '=https' --tlsv1.2 \
  -o /etc/apt/keyrings/grafana.asc \
  https://apt.grafana.com/gpg.key

echo "deb [signed-by=/etc/apt/keyrings/grafana.asc] https://apt.grafana.com stable main" \
  > /etc/apt/sources.list.d/grafana.list

apt-get update -q
apt-get install -y -q "grafana=${GRAFANA_VERSION}"

systemctl enable grafana-server

# ── Provisioning de Grafana ───────────────────────────────────────────────────
cat > /etc/grafana/provisioning/datasources/prometheus.yml << 'EOF'
apiVersion: 1
datasources:
  - name: Prometheus
    uid:  prometheus
    type: prometheus
    access: proxy
    url: http://localhost:9090
    isDefault: true
    editable: false
    jsonData:
      timeInterval: "15s"
EOF

cat > /etc/grafana/provisioning/dashboards/provider.yml << 'EOF'
apiVersion: 1
providers:
  - name: "proyecto-modulo-2"
    orgId: 1
    type: file
    disableDeletion: true
    updateIntervalSeconds: 30
    allowUiUpdates: false
    options:
      path: /var/lib/grafana/dashboards
EOF

install -d -o grafana -g grafana -m 0755 /var/lib/grafana/dashboards

# Dashboard tenant-overview
cat > /var/lib/grafana/dashboards/tenant-overview.json << 'EOF'
{
  "uid": "tenant-overview",
  "title": "Tenant Overview — proyecto-modulo-2",
  "description": "Disponibilidad, CPU, memoria, disco y PostgreSQL por tenant (RF-25 a RF-29)",
  "tags": ["proyecto-modulo-2","tenants"],
  "schemaVersion": 39,
  "version": 1,
  "refresh": "30s",
  "time": { "from": "now-1h", "to": "now" },
  "templating": {
    "list": [
      {
        "name": "tenant", "label": "Tenant", "type": "query",
        "datasource": { "type": "prometheus", "uid": "prometheus" },
        "query": "label_values(up{scope=\"tenant\"}, tenant)",
        "refresh": 2, "multi": false, "includeAll": true, "allValue": ".*"
      },
      {
        "name": "environment", "label": "Entorno", "type": "query",
        "datasource": { "type": "prometheus", "uid": "prometheus" },
        "query": "label_values(up{scope=\"tenant\", tenant=~\"$tenant\"}, environment)",
        "refresh": 2, "multi": false, "includeAll": true, "allValue": ".*"
      },
      {
        "name": "role", "label": "Rol", "type": "query",
        "datasource": { "type": "prometheus", "uid": "prometheus" },
        "query": "label_values(up{scope=\"tenant\", tenant=~\"$tenant\"}, role)",
        "refresh": 2, "multi": true, "includeAll": true, "allValue": ".*"
      }
    ]
  },
  "panels": [
    {
      "id": 1, "title": "Disponibilidad de servidores", "type": "stat",
      "gridPos": { "h": 4, "w": 24, "x": 0, "y": 0 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "fieldConfig": {
        "defaults": {
          "mappings": [
            { "type": "value", "options": { "0": { "text": "CAÍDO", "color": "red" }, "1": { "text": "OK", "color": "green" } } }
          ],
          "thresholds": { "mode": "absolute", "steps": [{ "value": null, "color": "red" }, { "value": 1, "color": "green" }] }
        }
      },
      "targets": [{ "refId": "A", "expr": "up{scope=\"tenant\",tenant=~\"$tenant\",environment=~\"$environment\",role=~\"$role\"}", "legendFormat": "{{tenant}} / {{role}} / {{instance}}" }],
      "options": { "reduceOptions": { "calcs": ["lastNotNull"] }, "colorMode": "background" }
    },
    {
      "id": 2, "title": "CPU (%) por servidor", "type": "timeseries",
      "gridPos": { "h": 8, "w": 12, "x": 0, "y": 4 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "fieldConfig": { "defaults": { "unit": "percent", "min": 0, "max": 100 } },
      "targets": [{ "refId": "A", "expr": "100 - (avg by (instance,tenant,role) (rate(node_cpu_seconds_total{mode=\"idle\",scope=\"tenant\",tenant=~\"$tenant\",environment=~\"$environment\",role=~\"$role\"}[5m])) * 100)", "legendFormat": "{{tenant}} / {{role}}" }]
    },
    {
      "id": 3, "title": "Memoria disponible (%)", "type": "timeseries",
      "gridPos": { "h": 8, "w": 12, "x": 12, "y": 4 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "fieldConfig": { "defaults": { "unit": "percent", "min": 0, "max": 100 } },
      "targets": [{ "refId": "A", "expr": "(node_memory_MemAvailable_bytes{scope=\"tenant\",tenant=~\"$tenant\",environment=~\"$environment\",role=~\"$role\"} / node_memory_MemTotal_bytes{scope=\"tenant\",tenant=~\"$tenant\",environment=~\"$environment\",role=~\"$role\"}) * 100", "legendFormat": "{{tenant}} / {{role}}" }]
    },
    {
      "id": 4, "title": "Disco libre (%)", "type": "timeseries",
      "gridPos": { "h": 8, "w": 12, "x": 0, "y": 12 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "fieldConfig": { "defaults": { "unit": "percent", "min": 0, "max": 100 } },
      "targets": [{ "refId": "A", "expr": "(node_filesystem_avail_bytes{fstype!~\"tmpfs|overlay\",mountpoint=\"/\",scope=\"tenant\",tenant=~\"$tenant\",environment=~\"$environment\",role=~\"$role\"} / node_filesystem_size_bytes{fstype!~\"tmpfs|overlay\",mountpoint=\"/\",scope=\"tenant\",tenant=~\"$tenant\",environment=~\"$environment\",role=~\"$role\"}) * 100", "legendFormat": "{{tenant}} / {{role}}" }]
    },
    {
      "id": 5, "title": "PostgreSQL UP", "type": "stat",
      "gridPos": { "h": 8, "w": 12, "x": 12, "y": 12 },
      "datasource": { "type": "prometheus", "uid": "prometheus" },
      "fieldConfig": {
        "defaults": {
          "mappings": [
            { "type": "value", "options": { "0": { "text": "CAÍDO", "color": "red" }, "1": { "text": "OK", "color": "green" } } }
          ],
          "thresholds": { "mode": "absolute", "steps": [{ "value": null, "color": "red" }, { "value": 1, "color": "green" }] }
        }
      },
      "targets": [{ "refId": "A", "expr": "pg_up{scope=\"tenant\",tenant=~\"$tenant\",environment=~\"$environment\"}", "legendFormat": "{{tenant}} / {{instance}}" }],
      "options": { "reduceOptions": { "calcs": ["lastNotNull"] }, "colorMode": "background" }
    }
  ]
}
EOF
chown grafana:grafana /var/lib/grafana/dashboards/tenant-overview.json

# Script de targets
install -d -m 0755 /opt/scripts
cat > /opt/scripts/update_monitoring_targets.py << 'PYEOF'
#!/usr/bin/env python3
"""Gestiona los archivos file_sd de Prometheus para tenants."""
import argparse, json, os, sys
from pathlib import Path

TARGETS_DIR  = Path(os.environ.get("OBS_TARGETS_DIR", "/etc/prometheus/targets"))
TENANTS_DIR  = TARGETS_DIR / "tenants"
POSTGRES_DIR = TARGETS_DIR / "postgres"

def add(tenant, environment, node_ips, db_ip):
    TENANTS_DIR.mkdir(parents=True, exist_ok=True)
    POSTGRES_DIR.mkdir(parents=True, exist_ok=True)
    roles = ["frontend", "backend", "database"]
    targets = []
    for idx, ip in enumerate([x.strip() for x in node_ips.split(",")]):
        role = roles[idx] if idx < len(roles) else f"server-{idx}"
        targets.append({"targets": [f"{ip}:9100"], "labels": {"tenant": tenant, "environment": environment, "role": role, "scope": "tenant"}})
    (TENANTS_DIR / f"{tenant}.yml").write_text(json.dumps(targets, indent=2) + "\n")
    print(f"[OK] node_exporter targets para '{tenant}'")
    if db_ip:
        pg = [{"targets": [f"{db_ip}:9187"], "labels": {"tenant": tenant, "environment": environment, "role": "database", "scope": "tenant"}}]
        (POSTGRES_DIR / f"{tenant}.yml").write_text(json.dumps(pg, indent=2) + "\n")
        print(f"[OK] postgres_exporter target para '{tenant}'")

def remove(tenant):
    removed = False
    for p in [TENANTS_DIR / f"{tenant}.yml", POSTGRES_DIR / f"{tenant}.yml"]:
        if p.exists():
            p.unlink(); print(f"[OK] Eliminado {p}"); removed = True
    if not removed:
        print(f"[WARN] No hay targets para '{tenant}'", file=sys.stderr)

parser = argparse.ArgumentParser()
sub = parser.add_subparsers(dest="cmd", required=True)
pa = sub.add_parser("add");    pa.add_argument("--tenant", required=True); pa.add_argument("--env", required=True); pa.add_argument("--node-ip", required=True); pa.add_argument("--db-ip", default=None)
pr = sub.add_parser("remove"); pr.add_argument("--tenant", required=True)
args = parser.parse_args()
if args.cmd == "add":    add(args.tenant, args.env, args.node_ip, args.db_ip)
elif args.cmd == "remove": remove(args.tenant)
PYEOF
chmod +x /opt/scripts/update_monitoring_targets.py

# ── Limpieza ──────────────────────────────────────────────────────────────────
echo "=== Limpieza ==="
rm -rf /tmp/prometheus.tar.gz "/tmp/prometheus-${PROMETHEUS_VERSION}.linux-amd64"
apt-get autoremove -y -q
truncate -s 0 /etc/machine-id

echo "=== Provisioning completado ==="
prometheus --version
grafana-server -v
