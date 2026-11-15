# Guion — Integrante 6 (líder): Observabilidad, logs, arquitectura y documentación

**Tiempo:** 0:30 de apertura + 3:15 de tu parte + el cierre del video · **Cubre:** RF-25 a RF-29, visor de logs (RF-11, RF-26) · **Entregables:** 3, 5, 6, 8 · Guía común: [README](README.md)

> El integrante 6 se dio de baja; este guion lo usa quien presente su parte (el equipo restante rehízo y completó la observabilidad). Quien lo presente debe poder explicar el código de abajo.

## Tu aporte en una frase
«Armé la observabilidad: Prometheus y Grafana con un tablero por tenant, alertas que llegan al panel, y un visor de logs de los tres servidores de cada institución; además la arquitectura y la documentación final.»

## Antes de grabar
- Docker arriba (`infrastructure/observability`) y **un tenant `ACTIVE`** con unos minutos de datos (los gráficos necesitan historia).
- Grafana en `http://localhost:3002`, **sesión ya iniciada** (no grabar la contraseña). Abre en «Resumen de la plataforma».
- Panel en **Monitoreo** y en **Logs**.
- Generar tráfico antes de grabar: entrar al sitio del tenant, navegar y **fallar un login a propósito 2 o 3 veces desde el navegador** (con `curl` solo se obtiene un 403 de CSRF).
- Si se puede: **una alerta real ya disparada** (detener `campus-cloud-<tenant>.service` en el backend unos minutos y volver a iniciarlo) para mostrarla activa y luego resuelta. Si no se hace, decir que la entrega al panel se probó de punta a punta con un destino inaccesible.
- En el editor: `infrastructure/observability/compose.yaml`, `grafana/provisioning/alerting/alertas.yaml`, `apps/backend/src/monitoring/tunnels.service.ts`, `apps/backend/src/logs/logs.service.ts`.
- Tener abierto el informe final (`docs/PROYECTO FINAL DOCUMENTO FINAL.md`) en la sección 3.1 (diagrama).

## Apertura del video (0:30)
«Somos el equipo del Tenant Control Center. Es una plataforma que crea y opera instituciones, cada una con su propio frontend, backend y base de datos en AWS, aprovisionadas con infraestructura como código. Vamos a ver el panel funcionando y después cada uno explica su parte. Todo el proyecto está en un monorepo.»

## Minuto a minuto (tu parte)

| Tiempo | Mostrar | Decir |
| --- | --- | --- |
| 0:00–0:30 | Informe final → **3.1**, el diagrama de arquitectura (panel local → AWS; Prometheus/Grafana; túneles SSH) | «Hay dos capas. En mi equipo corre el plano de control: el panel, el backend, los workers, Prometheus y Grafana. En AWS, cada tenant tiene su propia VPC con frontend público, backend y base de datos privados. Los servidores del tenant no exponen sus métricas a Internet; el backend abre por SSH cinco túneles por tenant y Prometheus los lee.» |
| 0:30–1:30 | Grafana → **Resumen de la plataforma** y luego **Salud por tenant** (selector de **Tenant** y de **Entorno**): disponibilidad de los 3 servidores, CPU, memoria, disco, latencia, PostgreSQL y la sección de la aplicación (peticiones, errores, logins) | «El inicio de Grafana lo personalizamos: resume todos los tenants, con una fila por institución. Para el detalle elijo el tenant: disponibilidad de sus tres servidores, CPU, memoria y disco, latencia y errores de la API, estado y conexiones de PostgreSQL. Las métricas de la aplicación salen del registro de Nginx con un exportador propio. Todo el tablero está definido como código y se carga solo al levantar Grafana.» |
| 1:30–2:10 | Grafana → **Alerting** (las 8 reglas) y el panel → **Monitoreo**: tabla de alertas con tenant y hora | «Definimos ocho alertas: servidor caído, API sin responder, PostgreSQL caído, CPU, memoria y disco sobre 85 %, errores 5xx y logins fallidos. Cuando se dispara una, Grafana llama por webhook al backend del panel, con un token, y la alerta aparece aquí con el tenant afectado y la hora. Cuando se resuelve, también se registra.» *(Mostrar la alerta real si existe.)* |
| 2:10–2:50 | Panel → **Logs**: elegir el tenant; **Frontend → Nginx (accesos)** con el filtro `login`; luego **Backend → aplicación** y **Base de datos → PostgreSQL** | «Además de las métricas, hice un visor de logs de los tres servidores de cada tenant. Se leen por SSH en el momento, sin instalar agentes. Aquí vemos el login fallido que acabo de hacer: la petición al login con su estado, y en Grafana sube el contador. Los comandos son una lista fija, las líneas con contraseñas o tokens se ocultan y cada consulta queda en la auditoría.» |
| 2:50–3:15 | Editor: `compose.yaml` y `alertas.yaml`; luego `tunnels.service.ts` y `logs.service.ts`; al final el informe final (índice y manual) | «Prometheus, Grafana y Blackbox se levantan con Docker Compose; los tableros y las alertas se generan con un script y se aprovisionan como código. Los túneles los abre y mantiene el backend, y los quita al suspender o eliminar un tenant. Dejé el informe final con la arquitectura, la matriz de pruebas y el manual de usuario.» |

## Cierre del video (lo dices tú, ~0:30 dentro del tiempo total)
1. Una frase por integrante: qué aportó (imágenes y catálogo, motores IaC, escáneres, Ansible y aislamiento, orquestación, observabilidad).
2. «El proyecto es un **monorepo**: un solo repositorio con carpetas por entregable; el código del panel y la infraestructura están en el mismo enlace.»
3. «La aplicación de asistencia viene de dos repositorios aparte, backend y frontend, rama `main`; lo evaluado es la infraestructura que los despliega.»
4. Nombrar dónde están los entregables: repositorio, informe final, tablero de Grafana y este video.

## Código que puedes abrir
1. `infrastructure/observability/compose.yaml` y `prometheus/prometheus.yml` — stack y `file_sd` de targets.
2. `infrastructure/observability/generar_grafana.py` y `generar_resumen.py` — generan los tableros y las alertas.
3. `infrastructure/observability/grafana/provisioning/` — datasource, tableros y alertas como código.
4. `apps/backend/src/monitoring/tunnels.service.ts` — túneles SSH y targets; `monitoring.service.ts` — webhook y alertas.
5. `apps/backend/src/logs/logs.service.ts` — lista blanca de fuentes y redacción de datos sensibles.
6. `infrastructure/ansible/roles/frontend/files/tcc_nginx_exporter.py` — métricas de peticiones y logins fallidos.

## Preguntas probables del docente y cómo responder
- **¿Por qué Grafana corre en tu PC y no en la nube?** Para llegar a las subredes privadas se usan túneles SSH desde el operador; es una decisión de alcance. Como limitación: si ese equipo está apagado, no hay monitoreo. Un servidor dedicado sería la mejora natural.
- **¿Cómo ves logs si Grafana no los muestra?** Grafana muestra métricas; los logs de texto están en la página Logs del panel y se enlazan desde el tablero. No integramos Loki.
- **¿Las alertas son reales?** La cadena completa se probó de punta a punta con un destino inaccesible (pasó a disparada y llegó al panel, luego a resuelta). Mostrar una alerta real solo si se provocó en la demo.
- **¿Cómo se protege el webhook?** Con un token en la cabecera, comparado en tiempo constante; sin token válido se rechaza.
- **¿Cómo evitas alertas de un tenant suspendido?** Al suspender se cierran sus túneles y se quitan sus targets, así que no genera alertas de servidor caído.
- **¿Qué pasa con la cardinalidad de métricas?** El exportador normaliza las rutas para no crear una serie por cada valor de parámetro (lo detectamos con 201 rutas y lo corregimos).

## No mostrar
Contraseña de Grafana y del panel, `WEBHOOK_TOKEN`, `.env`, la barra de AWS con el ID de cuenta.

## Evidencia que debes tener lista
- Captura del Resumen y de «Salud por tenant» con datos de un tenant real.
- Captura de la alerta en **Monitoreo** (y en Grafana).
- Captura de **Logs → Nginx (accesos)** con el login fallido.
- El tablero exportado: `infrastructure/observability/grafana/dashboards/*.json`.
