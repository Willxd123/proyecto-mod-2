# Instrucción para el agente del integrante 6

Implementa RF-25 a RF-29 y consolida Entregables 3, 5, 6 y 8. Lee instrucciones raíz, plan, `infrastructure/observability/README.md` y la referencia de plantilla.

Ya existe instrumentación real del panel en `/api/metrics`, resumen local y un stack Compose con datasource y dashboard de base. Verifica su arranque en Docker; el entorno del agente inicial no pudo acceder al motor. Las métricas del panel no cumplen por sí solas las métricas de tenants.

Define la ubicación del recolector y acceso a las IPs de los servidores. Las imágenes incluyen node exporter en 9100; PostgreSQL exporter está instalado pero deshabilitado hasta la configuración del integrante 4. La cuenta IAM compartida no da conectividad hacia subredes privadas.

Usa los targets y etiquetas del contrato, construye tablero por tenant/entorno con disponibilidad, CPU, memoria, disco, latencia, errores del backend y PostgreSQL. Instrumenta o integra la aplicación de asistencia para sus métricas HTTP; no calcularlas a partir del proceso Nest del panel.

Configura alertas y recepción autenticada en el backend, guarda `tenant_alerts` y muestra tenant y hora. Las reglas Prometheus de ejemplo no envían por sí solas webhooks. Coordina suspensión/eliminación con integrante 5 para evitar alertas operativas engañosas.

Pruebas: targets reales, filtros, métricas de ambos tenants, una alerta por fallo inducido y resolución; persistencia de alertas; error de conexión sin mostrar credenciales. No usar números aleatorios ni alertas simuladas de la plantilla como evidencia.

Entrega dashboard exportado, reglas, configuración, pruebas, manual claro, arquitectura y video de hasta 15 minutos con contribuciones técnicas de todos. Solicita las evidencias de cada integrante sin afirmar trabajo cloud no comprobado.
