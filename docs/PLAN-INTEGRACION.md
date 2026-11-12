# Plan de integración escalable — seis integrantes y sus agentes

## 1. Punto de partida y alcance

Una sola aplicación administradora: Angular 20 + NestJS 11 + PostgreSQL, en un monorepo pnpm. Una cuenta y un usuario IAM compartidos; la nube elegida es AWS. La aplicación de asistencia existente sigue siendo un componente separado hasta que el integrante 4 la integre. No se exige migrarla de Django a Nest para completar este módulo.

La plantilla HTML del docente es referencia de pantallas y RF. Sus AMIs, instituciones, IPs, logs, métricas y versiones simuladas no son datos reales ni se incorporan como evidencia. Ver `REFERENCIA-PLANTILLA.md`.

El integrante 1 entrega catálogo, base de interfaz/API, contratos, Packer, cloud-init y preparación de métricas. Las AMIs no se consideran entregadas hasta completar su construcción y primer arranque en AWS. El estado verificable está en `VERIFICACION.md`; no sustituirlo por afirmaciones de que todo está terminado.

## 2. Contrato de entrada, salida y eventos

| Artefacto | Productor | Consumidor | Fuente del contrato |
| --- | --- | --- | --- |
| Catálogo de planes | 1 | 2, 3 y formulario | `GET /api/plans`, tipo `Plan`, `config/plans.json`. |
| Registro de AMIs por región y rol | 1 | 2 y 3 | `GET /api/golden-images`, tipo `GoldenImage`. |
| Solicitud con copia del plan e imágenes | Formulario / 2 y 5 | Motores 2 y 3 | `DeploymentRequest` en `packages/contracts`. |
| Recursos creados e inventario | 2 o 3 | 4 y 5 | `ProvisioningResult`; cada motor produce exactamente los mismos campos. |
| Configuración de servicios | 4 | 5 | Comando Ansible con inventario, variables no secretas y mecanismo local de secretos. |
| Progreso y resultado | 5 | UI y 6 | `OperationEvent`, sin valores secretos. |
| Targets de monitoreo | 5 | 6 | Script `update_monitoring_targets.py`; etiquetas tenant/environment/role/scope. |
| Alertas y métricas por tenant | 6 | UI y defensa | RF-25 a RF-29, `tenant_alerts` y dashboard exportado. |

`schema_version=1` identifica el contrato inicial. Las adiciones compatibles son opcionales; los cambios incompatibles requieren una versión nueva y coordinación de consumidores. El cliente no proporciona comandos shell, rutas arbitrarias de ejecución ni credenciales AWS.

### Solicitud de integración

El formulario permite descargar un borrador con `deployable=false`. Conserva institución, identificador, contacto, plan, región AWS, entorno, motor y key pair. No crea un tenant ni ejecuta IaC.

Para entregar un paquete con user-data desde la raíz:

```powershell
python scripts/prepare_handoff.py --tenant i2-instituto-demo --name "Instituto Demo" --email admin@example.edu --plan basico --engine terraform --key-name practico7-asistencia --contract-only
```

Se genera `output/handoff/i2-instituto-demo/request.json` y tres YAML. Sin `--contract-only`, se requieren AMIs reales registradas de los tres roles y se produce `deployable=true`; aun así el motor debe verificar cuenta, región, imágenes y permisos antes de operar. El script nunca ejecuta IaC. No sobrescribe paquetes anteriores para conservar la copia de recursos solicitados.

`ProvisioningResult` incluye identificadores EC2, AMIs, direcciones privadas/públicas, VPC, subredes, grupos de seguridad y referencia de estado. No incluye contraseñas ni claves privadas. La ausencia de dirección pública se representa con `null`; no se inventa una URL antes de desplegar.

## 3. Cuenta IAM y clave SSH compartidas

Cada computadora usa un perfil AWS local. No distribuir access keys dentro del repositorio, en mensajes de agentes ni mediante archivos de configuración versionados. El mismo principal IAM no identifica individualmente a cada compañero: registrar `member_id` en los artefactos de desarrollo y etiquetas, sin considerarlo un control de autorización.

El `.pem` se entrega por el canal privado acordado por el equipo. En esta máquina permanece en `C:/P_Dtic/diplomado/lab3/practico7-asistencia.pem`. En las otras máquinas la ruta puede cambiar. El repositorio solo incluye el nombre del key pair y un ejemplo de ruta local en `infrastructure/.env.example`.

Antes de reutilizarlo, comprobar que el key pair existe en la región y corresponde a esa clave pública. `aws_images.py preflight --key-name ... --pem ...` hace la comparación sin imprimir la clave privada. Packer utiliza su propia clave temporal para construir las imágenes; no incorpora el `.pem` compartido a las AMIs.

### Evitar colisiones entre compañeros

| Control | Acuerdo obligatorio de integración |
| --- | --- |
| Identidad de recursos | `Project=proyecto-modulo-2`, `MemberId=integrante-N`, `TenantId=<slug>` para recursos de tenants y `RunId=<id>` para pruebas/builds. |
| Nombres de pruebas | Prefijo por integrante, por ejemplo `i2-demo-<sufijo>`; un identificador distinto para cada prueba independiente. |
| Estado IaC | Clave o stack por `tenant_slug` y motor. Nunca reutilizar estados de los prácticos ni aplicar dos motores al mismo tenant. |
| Concurrencia | Un solo trabajo mutante por tenant. Integrante 5 debe implementar bloqueo compartido/durable antes de habilitar varios workers o equipos sobre el mismo tenant. Un archivo local solo evita concurrencia en una copia del repo. |
| Actualizaciones | El motor conserva su propiedad del tenant durante todo el ciclo de vida; no cambiar de Terraform a Pulumi sobre los mismos recursos sin un proceso de importación/migración explícito. |
| Eliminación | Mostrar alcance, confirmar desde el panel y eliminar únicamente recursos del tenant, cuenta y motor correspondientes. No borrar por usuario IAM ni por una etiqueta Project sola. |
| Red | SSH desde las IPs autorizadas; base de datos desde backend; exporters desde el recolector. Compartir IAM no elimina VPC, rutas ni security groups. |
| Metadatos | Conservar versiones, AMIs y copia del plan por despliegue; nunca sobrescribir el pasado con la configuración actual del catálogo. |

## 4. Hitos de integración y criterios de salida

### M0 — Base compartida (integrante 1)

Ejecutar `pnpm install --frozen-lockfile`, configurar `.env` local, `pnpm check` y `pnpm dev`. Comprobar catálogo desde PostgreSQL, navegación y formulario con resumen y validaciones. Descargar un borrador marcado como no desplegable. Conservar un único lockfile.

### M1 — Imágenes y primer arranque (integrante 1)

Instalar Packer, realizar preflight AWS, construir tres AMIs e importarlas. Ejecutar smoke tests por rol: cloud-init, hostname, zona horaria, swap, SSH, runtime y node exporter. El servidor PostgreSQL debe crear su cluster en el primer arranque. Entregar manifiestos y evidencia de limpieza de instancias temporales. Este hito sigue pendiente si no hay acceso a AWS.

### M2 — Dos motores compatibles (integrantes 2 y 3)

Consumir la misma solicitud, AMIs y planes. Crear un tenant de prueba por motor, con estado separado, y producir `ProvisioningResult`. Mostrar que ambos generan inventario válido para el mismo playbook. El escáner real del integrante 3 debe producir resultados ocultando los secretos detectados.

### M3 — Aplicación por institución (integrante 4)

Configurar database → backend → frontend sin volver a instalar lo que está en la imagen. Mantener secretos fuera del bundle. Verificar importación de estudiantes y asistencia, y demostrar que el tenant A no puede acceder a datos de B. Configurar exporters y accesos privados junto al integrante 6.

### M4 — Orquestación y ciclo de vida (integrante 5)

Conectar solicitud → escáner → motor → Ansible → verificación → registro/targets. Logs reales en pantalla, estado consultable y errores redactados. Validar transiciones, concurrencia, suspensión/reanudación con conservación de datos y eliminación confirmada. No es obligatorio almacenar logs completos ni implementar reintento avanzado.

### M5 — Observabilidad por tenant (integrante 6)

Partir de la base Compose y del endpoint `/api/metrics` del panel, pero implementar los indicadores de los servidores y la aplicación de asistencia por separado. Conectar descubrimiento de targets, filtros, paneles, reglas y webhook de alertas. Provocar una alerta real y comprobar tenant y hora en la UI. Exportar el dashboard y documentar conectividad del recolector.

### M6 — Defensa del equipo

Dos tenants con planes distintos y dos motores en AWS; aplicación funcional y aislada; suspensión/reanudación y eliminación; métricas y alerta reales. Cada integrante aporta evidencia y explica su herramienta. El Team Lead consolida manual, arquitectura, catálogo, enlaces y video de hasta 15 minutos.

## 5. Guías listas para los agentes

Cada compañero entrega a su agente el repo y la guía correspondiente. No comparte el `.pem` pegándolo en el prompt; configura su ruta en la computadora.

- [Integrante 1: cierre de imágenes y catálogo](agentes/01-imagenes-catalogo.md).
- [Integrante 2: motor principal y creación](agentes/02-motor-principal.md).
- [Integrante 3: segundo motor y seguridad](agentes/03-motor-seguridad.md).
- [Integrante 4: Ansible y asistencia](agentes/04-configuracion-asistencia.md).
- [Integrante 5: orquestación y ciclo de vida](agentes/05-orquestacion.md).
- [Integrante 6: observabilidad y entrega](agentes/06-observabilidad.md).

Trabajar en ramas por integrante y tareas pequeñas. Acordar cambios de contratos y migraciones antes de integrar; no editar simultáneamente una migración aplicada. Cada entrega debe incluir pruebas, comandos, evidencia, archivos cambiados y limitaciones. La guía de un agente no autoriza tocar recursos ajenos a su tarea.
