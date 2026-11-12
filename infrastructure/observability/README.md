# Base de observabilidad para el integrante 6

El panel ya entrega métricas reales de su proceso en `/api/metrics` y un resumen visible en Monitoreo. Esta base no sustituye RF-25 a RF-29: aún faltan los tableros y alertas por tenant, latencia y errores de la aplicación de asistencia, estado de PostgreSQL y recepción de alertas en la plataforma.

## Stack local

Docker Desktop debe estar iniciado. Completar `infrastructure/observability/.env` con una contraseña local de Grafana y ejecutar desde la raíz:

```powershell
Copy-Item infrastructure/observability/.env.example infrastructure/observability/.env
# Completar GRAFANA_ADMIN_PASSWORD.
docker compose --env-file infrastructure/observability/.env -f infrastructure/observability/compose.yaml config --quiet
docker compose --env-file infrastructure/observability/.env -f infrastructure/observability/compose.yaml up -d
```

Grafana: `http://localhost:3002`, usuario `admin`. Prometheus: `http://localhost:9090`. La fuente y el tablero Control Center se provisionan desde archivos. Las reglas iniciales se evalúan en Prometheus; enviar alertas al panel y configurar notificaciones es tarea pendiente del integrante 6.

Prometheus consulta `host.docker.internal:3000`. Si Docker no alcanza una API enlazada a loopback, definir `HOST=0.0.0.0` en el `.env` local del backend, reiniciarla y limitar el acceso con el firewall del equipo. Mantener `127.0.0.1` cuando no se use Docker. Ajustar el target si se cambia el puerto. Los puertos publicados por Compose solo se exponen en loopback.

Detener con `docker compose --env-file infrastructure/observability/.env -f infrastructure/observability/compose.yaml down`. No agregar `--volumes` si se quiere conservar la información local.

## Integración con los tenants

Las imágenes Packer incluyen `prometheus-node-exporter`, habilitado en el puerto 9100. Las de base de datos incluyen además el paquete `prometheus-postgres-exporter`, deshabilitado hasta que Ansible configure el usuario de monitoreo y la conexión privada. Nunca abrir esos puertos a todo Internet.

El integrante 5 registra y retira targets usando `scripts/update_monitoring_targets.py`; el integrante 6 establece la conectividad desde el recolector hacia los servidores. Prometheus en un portátil no alcanza automáticamente IPs privadas de VPC aisladas: se debe acordar una ubicación del recolector y rutas, reglas o túneles apropiados. El mismo usuario IAM no da conectividad de red.

Los targets usan etiquetas `tenant`, `environment`, `role` y `scope=tenant`. Los indicadores del panel usan `scope=control-center`. No mezclar ambos alcances ni presentar métricas del panel como métricas de instituciones.

Imágenes fijadas: Prometheus 3.16.0 y Grafana OSS 13.3.1. Validación pendiente contra Docker en este entorno por falta de acceso al motor. Referencias: [Prometheus](https://prometheus.io/docs/instrumenting/exposition_formats/), [provisioning Grafana](https://grafana.com/docs/grafana/latest/administration/provisioning/).
