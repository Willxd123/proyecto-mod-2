# Instrucciones para operar un tenant desde el panel

Entregable 6 del docente: crear, actualizar, suspender, reanudar, respaldar, restaurar y eliminar un tenant. Todo se hace desde el panel local (`pnpm dev`, <http://localhost:4200>); cada acción queda registrada en **Auditoría** con quién la hizo, cuándo y su resultado.

> Estas acciones crean, detienen o borran recursos reales en AWS y pueden generar cargos. Solo las ejecuta el administrador del panel, desde el equipo con las credenciales de la cuenta autorizada.

## Antes de empezar

1. Seguir la lista de requisitos de la bóveda (`mapa/entorno-local`): AWS CLI con la cuenta autorizada, WSL con Ansible, Trivy, Checkov, cfn-lint, y las variables de `apps/backend/.env` (`DEMO_PROVISIONING_LOCAL=true`, `DEMO_ARTIFACT_RELEASE`, etc.).
2. Abrir el panel e iniciar sesión con `ADMIN_USER` y `ADMIN_PASSWORD`.
3. En **Crear tenant**, el paso 3 muestra «Actualizar requisitos»: debe decir que está listo para el motor elegido.

## Crear un tenant

1. **Crear tenant → Paso 1:** nombre de la institución, identificador (minúsculas y guiones), correo del administrador, región, **plan** y **motor** (CloudFormation, Terraform, OpenTofu o Pulumi).
2. **Paso 2:** revisar las Golden AMIs y, si se quiere, probar los 3 escáneres de seguridad sobre el borrador.
3. **Guardar borrador.** Queda como `PENDING`; todavía no se crea nada en AWS.
4. **Paso 3 → Iniciar aprovisionamiento** (o, desde **Tenants**, «Iniciar aprovisionamiento» en un borrador). Se ejecuta: escáneres → motor de infraestructura → Ansible → verificación HTTPS y login. El registro aparece en vivo. Tarda varios minutos.
5. Al terminar el tenant queda `ACTIVE` con su URL. La contraseña inicial del administrador de asistencia se consulta con «Ver credenciales demo» (queda auditada).

## Actualizar

- **Actualizar nombre:** botón «Actualizar nombre» en **Tenants**. Queda en la auditoría con el valor anterior y el nuevo.
- La actualización de la aplicación o de la infraestructura de un tenant ya creado **no está implementada**: hoy solo se puede cambiar el nombre.

## Suspender

Botón **Suspender** (tenant `ACTIVE`). Detiene las 3 instancias para no pagar cómputo. **Los discos y los datos se conservan.** Se libera la IP pública, así que el tenant queda sin URL (`SUSPENDED`).

## Reanudar

Botón **Reanudar** (tenant `SUSPENDED`). Inicia las 3 instancias y, como la IP pública cambia, vuelve a ejecutar la configuración con la IP nueva (nginx, certificado HTTPS y backend). Termina cuando el tenant responde; la URL nueva aparece en la lista. Tarda unos 8 minutos.

Si la reanudación falla y el tenant queda en `ERROR`, el mismo botón aparece como **Reintentar reanudación**: vuelve a iniciar las instancias (si ya estaban encendidas no pasa nada) y repite la configuración con la IP actual. El rol del frontend retira el certificado que no corresponde a la IP y emite uno nuevo; esta ruta se verificó en AWS real.

## Respaldar

Botón **Respaldar** (tenant `ACTIVE`). Copia la base de datos PostgreSQL del tenant con `pg_dump` y guarda el archivo **en el equipo del operador**, en `output/backups/<tenant>/`, junto con su checksum. El tenant sigue disponible. Los respaldos contienen datos reales: no se suben a Git ni se comparten.

## Restaurar

Botón **Restaurar** (tenant `ACTIVE` con al menos un respaldo).

1. Elegir el respaldo y escribir el identificador del tenant para confirmar.
2. Se comprueba el checksum del archivo, se detiene el backend unos instantes y se restaura la base en **una sola transacción**: si algo falla, los datos no cambian y el backend vuelve a iniciar.
3. **Reemplaza todos los datos actuales** por los del respaldo; lo registrado después se pierde.

La restauración solo aplica al mismo tenant del que se hizo el respaldo.

## Eliminar

Botón **Eliminar**. Muestra qué se borrará (instancias, discos y la base con todos sus datos, la red y el estado del motor) y pide escribir el identificador. Es definitivo. Llama al motor que creó el tenant (CloudFormation, Terraform, OpenTofu o Pulumi), que comprueba que los recursos sean de ese tenant antes de borrar. El registro queda como `DELETED` y su identificador no se reutiliza. Los respaldos guardados en el equipo no se borran.

## Logs de los servidores

Página **Logs** (tenant `ACTIVE`). Elija el tenant y la fuente: **Frontend** (Nginx accesos, Nginx errores, exporter de métricas, sistema), **Backend** (aplicación de asistencia, sistema) o **Base de datos** (PostgreSQL, sistema). Se leen por SSH en el momento, con una lista fija de comandos, y las líneas con contraseñas, tokens o claves se ocultan. Hay filtro de texto, 100/200/500 líneas, actualización cada 5 s y descarga `.log`. Un inicio de sesión rechazado se ve en **Nginx (accesos)** (`POST /api/auth/login/admin` con 4xx) y en el log de la aplicación. La primera consulta de cada fuente queda en la auditoría. También se abre desde Grafana: `Logs de este tenant (panel)`.

Las fuentes «sistema» ocultan el ruido propio de la imagen base de AWS (IPMI, firmware).

## Consultar lo que pasó

**Auditoría** lista cada acción con filtros por tenant, acción y resultado; «Ver operación» muestra la línea de tiempo completa. «Ver operación» en **Tenants** muestra el registro de la operación en curso.

## Qué no cubre

- No hay respaldos automáticos ni almacenamiento de respaldos fuera del equipo del operador.
- No hay cambio de plan ni reintento automático de una operación fallida.
- La evidencia de AWS real existe para CloudFormation (crear, suspender, reanudar, reintentar la reanudación y eliminar), para Terraform (crear) y para el visor de logs y las métricas. Respaldar y restaurar, OpenTofu y Pulumi están probados con pruebas automáticas y AWS simulado.
