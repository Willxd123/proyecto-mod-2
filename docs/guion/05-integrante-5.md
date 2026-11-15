# Guion — Integrante 5: Orquestación, ciclo de vida, auditoría y respaldo

**Tiempo:** 3:30 · **Cubre:** RF-11, RF-14 a RF-18, RF-19, RF-20 · **Entregables:** 6 y parte del 1 · Guía común: [README](README.md)

> El integrante 5 se dio de baja; este guion lo usa quien presente su parte (el equipo restante retomó y completó ese trabajo). Quien lo presente debe decir «nosotros implementamos…» y poder explicar el código de abajo.

## Tu aporte en una frase
«Construí el orquestador: el panel que crea, suspende, reanuda y elimina tenants desde la web, muestra cada paso en vivo y deja cada operación auditada.»

## Antes de grabar
- Sesión del panel ya iniciada (no grabar la contraseña).
- **Un tenant `ACTIVE`** en la lista. Si hay un segundo tenant suspendido, mejor para mostrar «Reanudar».
- En **Auditoría**, localizar de antemano: (a) una **creación** completa para abrirla con *Ver operación*, y (b) la **reanudación que falló** por el certificado (el tenant `edu-log`, estado `ERROR` → luego reintentado). Es una demostración real del historial y del reintento.
- En el editor: `apps/backend/src/lifecycle/lifecycle.service.ts`, `scripts/lifecycle_worker.py`, `scripts/live_log.py`, `tests/lifecycle.test.cjs`.
- **No ejecutar en cámara** una creación (10 min) ni una reanudación (8 min): mostrar los logs guardados.

## Minuto a minuto

| Tiempo | Mostrar | Decir |
| --- | --- | --- |
| 0:00–0:30 | Panel: **Inicio / Lista Tenants** (filtros por nombre, estado, plan y entorno; estado de cada tenant; enlace `https://…`) | «Este es el panel. Se entra con un usuario administrador y todo lo que hago queda registrado. La lista tiene filtros por nombre, estado, plan y entorno, y cada fila muestra su estado y su dirección HTTPS.» |
| 0:30–1:20 | **Auditoría → Ver operación** de una creación: la consola de log en vivo guardada. Mostrar el filtro «pasos principales» y «Descargar .log» | «Así se crea un tenant: guardo el borrador, escanea con tres herramientas, comprueba la cuenta y las imágenes de AWS, crea la infraestructura con el motor elegido, espera el primer arranque, configura con Ansible y verifica HTTPS y el login. Cada paso real aparece aquí mientras ocurre: no es una barra falsa. Las líneas que podrían tener contraseñas se ocultan.» |
| 1:20–2:20 | **Suspender** sobre el tenant activo: mostrar solo el **diálogo de confirmación** (qué se detiene, que los discos se conservan) y cancelar o confirmar según el tiempo. Luego **Eliminar**: el diálogo con el detalle de recursos y el campo para escribir el identificador | «Suspender apaga las tres máquinas para no pagar cómputo y **conserva los discos y los datos**. Al reanudar, la IP pública cambia, así que el sistema reconfigura Nginx, el certificado HTTPS y la aplicación con la IP nueva. Eliminar muestra exactamente qué se borrará y me obliga a escribir el identificador del tenant; solo borra recursos de ese tenant, por ID exacto, usando el mismo motor que lo creó. Y solo hay una operación a la vez por tenant.» |
| 2:20–2:50 | **Auditoría**: la reanudación fallida (estado `ERROR`) → *Ver operación* con el error del certificado → mostrar el botón **Reintentar reanudación** y el reintento exitoso | «Esto fue una falla real. Al reanudar un tenant, el certificado seguía siendo el de la IP anterior. La auditoría guardó el historial y la causa: OpenSSL ignoraba la comprobación de IP. Lo corregimos y, como el tenant quedó en `ERROR`, el panel ahora permite **reintentar la reanudación**; el reintento terminó con el tenant activo y el certificado correcto.» |
| 2:50–3:10 | Botones **Respaldar** y **Restaurar** de la fila; diálogo de restaurar | «También implementamos respaldar y restaurar: `pg_dump` guarda la base en el equipo del operador y restaurar usa `pg_restore` en una sola transacción, así que si falla no quedan datos a medias.» *(Decir «lo probamos en AWS real» solo si el compañero que lo prueba ya lo hizo.)* |
| 3:10–3:30 | Editor: `lifecycle.service.ts` (el objeto `RULES` y la reclamación atómica del estado) y `lifecycle_worker.py` (función `resume` / `reconfigure_application`) | «Cada acción está definida en una tabla de reglas: desde qué estados se permite y a cuál pasa. Reclamo el estado con una actualización atómica en la base, por eso no pueden correr dos operaciones sobre el mismo tenant. El trabajo pesado lo hace un worker en Python que emite cada paso al panel.» |

## Código que puedes abrir
1. `apps/backend/src/lifecycle/lifecycle.service.ts` — `RULES`, reclamación atómica, recuperación tras un reinicio (marca `ERROR` lo que quedó a medias).
2. `scripts/lifecycle_worker.py` — suspender, reanudar (`reconfigure_application`), eliminar por motor, respaldar y restaurar.
3. `scripts/demo_worker.py` y `scripts/live_log.py` — creación y registro en vivo con redacción de datos sensibles.
4. `apps/backend/src/audit/` y `apps/backend/src/auth/` — auditoría de solo inserción y login del administrador.
5. `apps/frontend/src/app/pages/tenants.component.ts`, `log-console.component.ts`, `audit.component.ts`.
6. `tests/lifecycle.test.cjs` — pruebas del ciclo de vida (incluye reintentar desde `ERROR`).

## Preguntas probables del docente y cómo responder
- **¿Qué pasa si se cae el backend en medio de una operación?** Al arrancar, lo que quedó en un estado intermedio se marca `ERROR` y se audita; desde ahí se puede reintentar la reanudación o eliminar.
- **¿Se pierden datos al suspender?** No: se detienen las instancias pero los volúmenes EBS se conservan. Sí se pierde la IP pública (cambia al reanudar).
- **¿Cómo evitas borrar recursos de otro tenant?** Se verifican cuenta, región y propiedad (etiquetas `TenantId`) antes de actuar y se borra solo por ID exacto, nunca por nombre parcial.
- **¿Qué es `LIFECYCLE_SIMULATE`?** Un modo de prueba que no toca AWS y marca todo como **[SIMULADO]**; no se usa como evidencia real.
- **¿Se puede cambiar el plan de un tenant?** No está implementado (opcional según el docente). Hoy solo se puede cambiar el nombre.
- **¿Hay reintentos automáticos?** No; el reintento es manual desde el panel.

## No mostrar
Contraseña del administrador, `.env`, la carpeta `output/backups` (datos reales), credenciales demo.

## Evidencia que debes tener lista
- Capturas del log de una creación, del diálogo de eliminar y de la auditoría.
- La reanudación fallida y su reintento exitoso (auditoría).
- Si se hace: el respaldo y la restauración en AWS real.
