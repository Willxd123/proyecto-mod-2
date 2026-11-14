# Módulo de Observabilidad — Integrante 6

Implementa RF-25 a RF-29. El servidor de observabilidad corre **Prometheus 2.54.1** y **Grafana 11.2.0** en una instancia EC2 dedicada. Los servidores de cada tenant ya tienen `node_exporter` preinstalado en el puerto **9100** (integrante 1); los de base de datos también tienen `postgres_exporter` instalado pero deshabilitado hasta que el integrante 4 configure el usuario de monitoreo.

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────┐
│  Instancia EC2  — observabilidad (t3.small)             │
│                                                         │
│  Prometheus :9090  ──scrape──►  node_exporter :9100     │
│                                 (en cada servidor       │
│  Grafana    :3000               de cada tenant)         │
│                                                         │
│  node_exporter :9100 (propio)   postgres_exporter :9187 │
└──────────────────┬──────────────────────────────────────┘
                   │ webhook POST /api/monitoring/alerts
                   ▼
        Backend NestJS (Control Center)
        → persiste en tabla tenant_alerts
        → el frontend Angular lo muestra en /monitoreo
```

---

## Estructura de archivos

```
infrastructure/observability/
├── packer/
│   ├── observability.pkr.hcl          # AMI de observabilidad
│   ├── build.example.pkrvars.hcl      # Variables de ejemplo para Packer
│   └── ansible/
│       ├── observability.yml          # Playbook principal (Prometheus + Grafana)
│       └── files/
│           ├── prometheus/
│           │   ├── prometheus.yml     # Configuración de scrape (usa file_sd)
│           │   └── rules/
│           │       └── tenant-alerts.yml  # Reglas de alerta
│           ├── grafana/
│           │   ├── provisioning/
│           │   │   ├── datasources/prometheus.yml
│           │   │   └── dashboards/provider.yml
│           │   └── dashboards/
│           │       ├── tenant-overview.json   # Dashboard por tenant (RF-25)
│           │       └── control-center.json    # Dashboard del servidor obs.
│           └── systemd/
│               └── prometheus.service
├── terraform/
│   ├── main.tf         # Instancia EC2 + SG + EIP
│   ├── variables.tf
│   ├── outputs.tf
│   └── terraform.example.tfvars
└── scripts/
    └── update_monitoring_targets.py   # Registrar/retirar tenants en Prometheus
```

---

## Pasos de despliegue

### 1 — Construir la AMI con Packer

```bash
cd infrastructure/observability/packer
cp build.example.pkrvars.hcl build.pkrvars.hcl
# Editar build.pkrvars.hcl con los valores reales
packer init .
packer build -var-file=build.pkrvars.hcl .
```

### 2 — Desplegar la instancia con Terraform

```bash
cd infrastructure/observability/terraform
cp terraform.example.tfvars terraform.tfvars
# Editar terraform.tfvars con vpc_id y subnet_id reales
terraform init
terraform apply -var-file=terraform.tfvars
```

Terraform imprime la IP pública en `observabilidad_ip_publica`.

### 3 — Configurar el backend

Añadir en `apps/backend/.env`:

```
OBS_SERVER_IP=<IP del output de Terraform>
GRAFANA_ADMIN_USER=admin
GRAFANA_PORT=3000
PROMETHEUS_PORT=9090
WEBHOOK_TOKEN=<token secreto — compartir con la configuración de Alertmanager>
```

### 4 — Cambiar la contraseña de Grafana

```bash
ssh ubuntu@<IP>
sudo grafana-cli admin reset-admin-password '<nueva-contraseña>'
```

---

## Integración con tenants (Integrante 5)

Al crear un tenant:

```bash
ssh ubuntu@<IP-obs>
python3 /opt/scripts/update_monitoring_targets.py add \
  --tenant <slug> --env produccion \
  --node-ip <ip-frontend>,<ip-backend>,<ip-database> \
  --db-ip <ip-database>
# Prometheus recarga targets en ≤ 30 segundos (file_sd refresh_interval: 30s)
```

Al suspender o eliminar:

```bash
python3 /opt/scripts/update_monitoring_targets.py remove --tenant <slug>
```

---

## Puertos y reglas de seguridad

| Puerto | Servicio       | Acceso recomendado          |
|--------|----------------|-----------------------------|
| 3000   | Grafana        | Solo tu IP (SG de Terraform)|
| 9090   | Prometheus     | Solo tu IP (SG de Terraform)|
| 9100   | node_exporter  | Solo desde la IP del servidor de observabilidad (SG de los tenants) |
| 9187   | postgres_exp.  | Solo desde la IP del servidor de observabilidad |
| 22     | SSH            | Solo tu IP                  |

> **Nunca abrir 9100 ni 9187 a 0.0.0.0/0.**

---

## Variables de entorno requeridas en el backend

| Variable           | Descripción                                              |
|--------------------|----------------------------------------------------------|
| `OBS_SERVER_IP`    | IP pública del servidor de observabilidad               |
| `GRAFANA_ADMIN_USER` | Usuario de Grafana (default: `admin`)                 |
| `GRAFANA_PORT`     | Puerto de Grafana (default: `3000`)                     |
| `PROMETHEUS_PORT`  | Puerto de Prometheus (default: `9090`)                  |
| `WEBHOOK_TOKEN`    | Token secreto para el webhook de Alertmanager (RF-28)   |

---

## Limitaciones conocidas

- Prometheus en la instancia EC2 no alcanza IPs privadas de VPC de otros tenants si están en subredes sin peering. Coordinar con el integrante 2/3 que las IPs de los servidores de tenants sean alcanzables desde la subred del servidor de observabilidad.
- `postgres_exporter` requiere que el integrante 4 configure el usuario `monitoring` en PostgreSQL. Hasta entonces, los targets de postgres mostrarán `DOWN` y las alertas `TenantPostgresInaccesible` se dispararán; filtrar por severity si es necesario durante el desarrollo.
- La contraseña de Grafana no se gestiona por Terraform para evitar que quede en el estado; cambiarla manualmente tras el primer arranque.
