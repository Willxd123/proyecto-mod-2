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
| Latencia y errores del backend | sonda `probe_duration_seconds` y `probe_success` sobre `/api/health`, **y las peticiones reales de la aplicación** (ver abajo) |
| Peticiones por segundo, latencia p95 por ruta, errores 5xx por ruta, códigos HTTP e inicios de sesión fallidos | exporter de Nginx en el frontend (`tcc_http_*`, `tcc_login_attempts_total`) |
| Estado de PostgreSQL | postgres_exporter del servidor de base de datos (`pg_up`, conexiones activas) |
| Por tenant y entorno (RF-27) | variables **Tenant** y **Entorno** del tablero; cada target lleva `tenant`, `environment`, `role` y `scope=tenant` |

Los tableros y las alertas son código (se regeneran con `python infrastructure/observability/generar_grafana.py`): `grafana/dashboards/tenant-health.json` y `grafana/provisioning/alerting/alertas.yaml`. No se configura nada a mano en la interfaz.

## Métricas de la aplicación (peticiones reales)

Nginx del frontend recibe todas las llamadas a la API. El rol de Ansible del frontend registra una línea por petición con un formato mínimo (hora, método, ruta sin parámetros, código y duración; sin IP ni cabeceras) y un exporter de Python de la biblioteca estándar (`roles/frontend/files/tcc_nginx_exporter.py`) la convierte en métricas en `127.0.0.1:9102`:

- `tcc_http_requests_total{route,method,status}`: peticiones por ruta (los identificadores se agrupan: `/api/students/:id`).
- `tcc_http_request_duration_seconds`: histograma por ruta (latencia p95).
- `tcc_http_errors_total{route}`: respuestas 5xx.
- `tcc_login_attempts_total{result}`: inicios de sesión correctos y fallidos (400, 401 o 403 en `/api/auth/login`).

Si la instalación del exporter fallara, el tenant sigue operativo y solo faltan estas métricas. Solo los tenants creados o reconfigurados con esta versión las tienen.

## Alertas (RF-28 y RF-29)

Ocho reglas evaluadas cada minuto: servidor sin respuesta, API sin responder 200, PostgreSQL caído, más de 5 % de respuestas 5xx, más de 10 inicios de sesión fallidos en 5 minutos, y CPU, memoria o disco sobre el 85 %. Grafana entrega cada alerta (disparada y resuelta) al panel con `POST /api/monitoring/alerts`, autenticada con `WEBHOOK_TOKEN`. El panel la guarda en `tenant_alerts` con su tenant y la hora de detección y la muestra en **Monitoreo**.

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

Los servidores de cada tenant no son alcanzables desde fuera: el backend y la base de datos no tienen IP pública. El panel abre, por cada tenant, cinco túneles SSH con la llave local (`DEMO_SSH_PRIVATE_KEY_WSL_PATH`), pasando por el frontend como bastión:

| Servidor | Destino remoto | Puerto local |
| --- | --- | --- |
| frontend | `127.0.0.1:9100` | base |
| backend | `127.0.0.1:9100` | base + 1 |
| database | `127.0.0.1:9100` | base + 2 |
| database (PostgreSQL) | `127.0.0.1:9187` | base + 3 |
| frontend (peticiones de la aplicación) | `127.0.0.1:9102` | base + 4 |

El bloque de puertos (desde 19100, de 10 en 10) se asigna una vez por tenant y se guarda en la base. Prometheus los alcanza como `host.docker.internal:<puerto>`. Los archivos de targets los escribe el panel en `prometheus/targets*/tenant-<id>.json` (Git los ignora). Si un túnel se cae se reintenta con espera creciente; **Monitoreo** muestra su estado.

## Variables

- `apps/backend/.env`: `WEBHOOK_TOKEN`, `GRAFANA_PORT` (3002 por defecto) y, opcionalmente, `MONITORING_TUNNELS=false` para no abrir túneles.
- `infrastructure/observability/.env`: `GRAFANA_ADMIN_USER`, `GRAFANA_ADMIN_PASSWORD`, `WEBHOOK_TOKEN`, `CONTROL_CENTER_URL`.

## Límites

- Solo funciona mientras el panel y los túneles estén en el equipo del operador; no hay monitoreo si ese equipo está apagado.
- No hay métricas internas de la aplicación de asistencia (memoria del proceso, consultas): las de peticiones salen del registro de Nginx.
- Las alertas de errores 5xx y de inicios de sesión dependen de que el exporter esté instalado en el frontend.
- Las alertas de una suspensión no se silencian solas: un tenant suspendido no tiene túneles ni targets, así que no genera alertas de servidor caído.
- No se persiste el historial de Grafana fuera del volumen de Docker.
