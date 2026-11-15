# Guiones del video (Entregable 8)

Guía común para grabar la demostración. Cada integrante tiene su guion con **qué mostrar, qué decir y qué código abrir**:

- [Integrante 1 — Imágenes y catálogo](01-integrante-1.md)
- [Integrante 5 — Orquestación, ciclo de vida y auditoría](05-integrante-5.md)
- [Integrante 6 — Observabilidad, logs, arquitectura y documentación](06-integrante-6.md)

Los integrantes 2, 3 y 4 necesitan su propio guion con el mismo formato (motores IaC, escáneres, Ansible y aislamiento); estos tres documentos sirven de modelo.

## Reglas del docente (clase 11)

- **Un solo video por grupo, máximo 15 minutos.** Se graba solo la pantalla (sin cámara).
- **Se empieza mostrando la plataforma funcionando** y después un poco de código.
- **Cada integrante explica qué hizo** («yo hice esto»). Cuenta la infraestructura y las herramientas; **la interfaz de la aplicación de asistencia no tiene mérito** para la nota.
- Solo el líder sube la documentación con los nombres, el nombre del equipo y el enlace del video.

## Reparto de tiempo (total 15:00)

| Tramo | Quién | Tiempo | Qué cubre |
| --- | --- | :---: | --- |
| Apertura | Integrante 6 (líder) | 0:30 | Qué es la plataforma y qué se verá |
| Imágenes y catálogo | Integrante 1 | 2:30 | Planes, Golden Images, Packer y cloud-init |
| Motor principal | Integrante 2 | 1:45 | Terraform (y OpenTofu) |
| Motor secundario y escáneres | Integrante 3 | 1:45 | CloudFormation, Trivy, Checkov, cfn-lint |
| Configuración y aislamiento | Integrante 4 | 1:45 | Ansible, Vault, aislamiento entre tenants |
| Orquestación y ciclo de vida | Integrante 5 | 3:30 | Creación en vivo, suspender, reanudar, eliminar, auditoría, respaldo |
| Observabilidad y cierre | Integrante 6 | 3:15 | Arquitectura, Grafana, alertas, logs y documentación |
| **Total** | | **15:00** | |

Si un tramo se pasa de tiempo, se recorta código, nunca la demostración.

## Antes de grabar (todos)

1. **Entorno arriba:** Docker Desktop, `docker compose ... up -d` de `infrastructure/observability`, y el panel con `pnpm dev` (demo local real, `LIFECYCLE_SIMULATE=false`).
2. **Tenants listos, no creados en cámara.** Crear un tenant tarda unos 10 minutos y reanudar unos 8, y el video dura 15. Dejar **un tenant `ACTIVE` ya creado** y, si el equipo los hace, un segundo tenant y un respaldo. Para mostrar cómo se crea, abrir **Auditoría → Ver operación** de una creación anterior (el log en vivo queda guardado) o grabar la creación aparte y cortar la espera al editar.
3. **Pestañas abiertas y en orden:** panel (`:4200`), Grafana (`:3002`), consola de AWS (EC2 → Instancias y AMIs), el editor con el código. Cerrar cualquier otra.
4. **Ensayar una vez** cada tramo con el cronómetro. Hablar sobre lo que se ve, no leer.
5. **Costos:** al terminar la grabación, **eliminar los tenants de prueba** desde el panel y comprobar en AWS que no queden instancias ni volúmenes. Las AMIs facturan mientras existan.

## Qué NO mostrar en pantalla

- Los archivos `.env`, `.pem`, claves de AWS, `*.tfstate`, inventarios, Vault y la carpeta `output/` (los respaldos contienen datos reales).
- La contraseña del administrador del panel, la de Grafana y el `WEBHOOK_TOKEN`. Al iniciar sesión, grabar de modo que no se vea lo que se escribe, o tener la sesión ya iniciada.
- El ID de cuenta de AWS de la barra de direcciones: recortar la imagen o no mostrar esa barra.
- Credenciales de las cuentas demo de un tenant, salvo que se usen datos de prueba sin valor.

## Honestidad: qué es real y qué no

El docente premia explicar bien lo que se hizo. No presentar una simulación como un despliegue real. Estado al 2026-11-15 (el detalle está en la sección 1.3 del [informe final](../PROYECTO%20FINAL%20DOCUMENTO%20FINAL.md)):

| Capacidad | Cómo decirlo |
| --- | --- |
| CloudFormation y Terraform | «Los desplegamos de verdad en AWS desde el panel» |
| OpenTofu y Pulumi | «Están disponibles en el panel y probados con simulación y vista previa; no los desplegamos aún» |
| Respaldo y restauración | «Está implementado con `pg_dump` y `pg_restore`»; decir «lo ejecutamos en AWS real» **solo si el compañero que lo prueba ya lo hizo** |
| Aislamiento entre tenants | Mostrarlo **solo si** se ejecuta la prueba con dos tenants; si no, decir que está por demostrar |
| Alertas | La entrega al panel se probó de punta a punta; mostrar una alerta real apagando un servicio solo si se hace en la demo |

## Si algo falla durante la grabación

- Un fallo real que se explica bien vale más que ocultarlo. Ejemplo ya vivido: tras reanudar, el certificado seguía siendo el de la IP anterior; se encontró la causa (OpenSSL ignoraba `-checkip`), se corrigió y el panel ofrece **Reintentar reanudación**. Está documentado en la sección 6.2 del informe.
- Si el panel o Grafana no responden, volver a levantarlos y repetir el tramo; se corta al editar.
- Si AWS tarda, mostrar el log de la operación anterior en **Auditoría** en lugar de esperar.

## Para el cierre (integrante 6)

Repasar en una frase por integrante qué aportó, mencionar que el proyecto es un **monorepo** (un repositorio, carpetas por entregable), nombrar los entregables y dónde están, y recordar que la aplicación de asistencia viene de dos repositorios aparte (`control-asistencia-backend` y `control-asistencia-frontend`, rama `main`).
