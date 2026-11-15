# Observabilidad del Tenant Control Center (RF-25 a RF-29)

Prometheus, Grafana y un sondeador HTTP (blackbox) corren con Docker Compose en el **equipo del operador**, separados de los servidores de los tenants. El panel les da acceso a cada tenant sin abrir ningún puerto en AWS.

```text
 tenant (AWS)                         equipo del operador
 ┌─────────────┐  túnel SSH (por el bastión)   ┌──────────────────────────────┐
 │ frontend    │◄──────────────────────────────┤ panel (NestJS) mantiene 4     │
 │ backend     │   node_exporter :9100         │ túneles por tenant            │
 │ database    │   postgres_exporter :9187     │        │ puertos 191xx        │
 └─────────────┘                               │ Prometheus ─► Grafana         │
        ▲  GET /api/health (HTTPS)             │      ▲   │   tablero + alertas│
        └──────────── blackbox ────────────────┤      │   └─webhook─► panel    │
                                               └──────────────────────────────┘
```

## Qué mide

| Requisito | Origen |
| --- | --- |
| Disponibilidad (RF-26) | `up` del node_exporter de cada servidor y sonda HTTPS a `/api/health` |
| CPU, memoria y disco | node_exporter de los 3 servidores (`node_cpu_*`, `node_memory_*`, `node_filesystem_*`) |
| Latencia y errores del backend | sonda `probe_duration_seconds`, `probe_http_status_code` y `probe_success` |
| Estado de PostgreSQL | postgres_exporter del servidor de base de datos (`pg_up`, conexiones activas) |
| Por tenant y entorno (RF-27) | variables **Tenant** y **Entorno** del tablero; cada target lleva `tenant`, `environment`, `role` y `scope=tenant` |

Los tableros y las alertas son código: `grafana/dashboards/tenant-health.json` y `grafana/provisioning/alerting/alertas.yaml`. No se configura nada a mano en la interfaz.

## Alertas (RF-28 y RF-29)

Seis reglas evaluadas cada minuto: servidor sin respuesta, API sin responder 200, PostgreSQL caído, y CPU, memoria o disco sobre el 85 %. Grafana entrega cada alerta (disparada y resuelta) al panel con `POST /api/monitoring/alerts`, autenticada con `WEBHOOK_TOKEN`. El panel la guarda en `tenant_alerts` con su tenant y la hora de detección y la muestra en **Monitoreo**.

## Puesta en marcha

1. Tener Docker Desktop abierto.
2. Copiar `infrastructure/observability/.env.example` a `infrastructure/observability/.env` y completar `GRAFANA_ADMIN_PASSWORD` y `WEBHOOK_TOKEN` (el **mismo** valor que `WEBHOOK_TOKEN` en `apps/backend/.env`).
3. Desde la raíz del monorepo:
   ```powershell
   docker compose --env-file infrastructure/observability/.env -f infrastructure/observability/compose.yaml up -d
   ```
4. Grafana: <http://localhost:3002> (usuario `admin` y la contraseña del `.env`); Prometheus: <http://localhost:9090>. El tablero es **Tenant Control Center → Salud por tenant**.
5. Con el panel en marcha y la demo local real habilitada, cada tenant `ACTIVE` abre solo sus túneles y aparece en el tablero. Al suspender o eliminar un tenant se cierran los túneles y desaparecen sus targets; al reanudar se vuelven a abrir con las direcciones nuevas.

Detener: `docker compose --env-file infrastructure/observability/.env -f infrastructure/observability/compose.yaml down` (con `-v` también borra el historial).

## Cómo se conectan los tenants

Los servidores de cada tenant no son alcanzables desde fuera: el backend y la base de datos no tienen IP pública. El panel abre, por cada tenant, cuatro túneles SSH con la llave local (`DEMO_SSH_PRIVATE_KEY_WSL_PATH`), pasando por el frontend como bastión:

| Servidor | Destino remoto | Puerto local |
| --- | --- | --- |
| frontend | `127.0.0.1:9100` | base |
| backend | `127.0.0.1:9100` | base + 1 |
| database | `127.0.0.1:9100` | base + 2 |
| database (PostgreSQL) | `127.0.0.1:9187` | base + 3 |

El bloque de puertos (desde 19100, de 10 en 10) se asigna una vez por tenant y se guarda en la base. Prometheus los alcanza como `host.docker.internal:<puerto>`. Los archivos de targets los escribe el panel en `prometheus/targets*/tenant-<id>.json` (Git los ignora). Si un túnel se cae se reintenta con espera creciente; **Monitoreo** muestra su estado.

## Variables

- `apps/backend/.env`: `WEBHOOK_TOKEN`, `GRAFANA_PORT` (3002 por defecto) y, opcionalmente, `MONITORING_TUNNELS=false` para no abrir túneles.
- `infrastructure/observability/.env`: `GRAFANA_ADMIN_USER`, `GRAFANA_ADMIN_PASSWORD`, `WEBHOOK_TOKEN`, `CONTROL_CENTER_URL`.

## Límites

- Solo funciona mientras el panel y los túneles estén en el equipo del operador; no hay monitoreo si ese equipo está apagado.
- La latencia y los errores son los de `/api/health` medidos desde Prometheus, no métricas internas de la aplicación de asistencia.
- Las alertas de una suspensión no se silencian solas: un tenant suspendido no tiene túneles ni targets, así que no genera alertas de servidor caído.
- No se persiste el historial de Grafana fuera del volumen de Docker.
