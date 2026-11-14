# Contratos de integración y responsabilidades

## Reglas compartidas

Una instalación pnpm desde la raíz y un solo `pnpm-lock.yaml`. No crear proyectos independientes ni introducir npm/yarn lockfiles. Usar los tipos de `@modulo2/contracts`; tras modificarlos, recompilar el paquete. Los imports de tipos no incorporan código NestJS en el navegador.

Los contratos de lectura entregados por integrante 1 usan JSON, rutas sin barra final y el prefijo `/api`:

| Método y ruta | Respuesta / comportamiento |
| --- | --- |
| `GET /api/health` | Estado de la API y consulta de conectividad PostgreSQL. |
| `GET /api/plans` | `{data: Plan[], meta: {provider: 'aws', quota_enforcement: false}}`. Orden Básico, Estándar, Avanzado. |
| `GET /api/plans/:slug` | `{data: Plan}` o 404 de Nest. |
| `GET /api/golden-images?region=us-east-1` | `{data: GoldenImage[], meta: {ready: {frontend, backend, database}}}`. Cada booleano indica existencia de registro para el rol, no prueba de salud ni verificación contra AWS. |
| `GET /api/tenants` | Lista real de registros. `meta.creation_enabled` refleja el opt-in local de demostración; no implica que la configuración del host esté lista. |
| `GET /api/capabilities` | Funciones implementadas y pendientes. |

El panel conserva borradores por defecto. El opt-in `DEMO_PROVISIONING_LOCAL`
agrega `GET /api/demo-provisioning/capabilities`,
`POST /api/demo-provisioning/:slug/start` y
`GET /api/demo-provisioning/operations/:slug`. Solo aceptan loopback, el origen
del panel local y confirmación del slug; el cliente no envía comandos, rutas,
variables cloud ni credenciales. El backend arma la solicitud desde PostgreSQL
y limita el modo demo a Terraform y CloudFormation. El worker ejecuta Trivy,
preflight AWS de solo lectura y, tras la confirmación de creación en la UI, el
motor elegido, Ansible y verificación HTTPS/login antes de marcar `ACTIVE`.
Un fallo pasa a `ERROR`; los resultados parciales verificados se conservan para
reconciliación y no hay borrado automático.

El opt-in no autentica al operador y puede crear recursos AWS con cargos; está
desactivado por defecto. Progreso en memoria y estados finales en `tenants`
evitan cambios de esquema, pero no constituyen una cola durable: tras un
reinicio durante el trabajo el tenant queda en `PROVISIONING` para revisión
manual y no se debe reintentar sin inspeccionar AWS. No se implementan aquí
suspensión, reanudación, eliminación, targets de monitoreo ni ciclo de vida
completo. Los eventos de progreso son mensajes estructurados; stdout/stderr
arbitrarios de IaC y Ansible no se reenvían.

El diagnóstico `GET /api/tenants/:slug/creation-readiness` consulta un tenant
guardado y muestra requisitos listos o bloqueados. Es de solo lectura: no
comprueba la disponibilidad real de AMIs en AWS, no ejecuta el escáner ni
crea trabajos o recursos. Devuelve `can_start=false` mientras no existan
autenticación, escáner, orquestación, controles de concurrencia y configuración
de Ansible integrados. No representa estado de ejecución ni sustituye un
registro durable de trabajos.
La respuesta también enumera las etapas previstas en orden, todas con estado
`not_started`: es un diagnóstico del flujo general y no sustituye el estado
del worker demo, consultable por la ruta de operaciones local.

El escáner Trivy y el segundo motor CloudFormation pueden ejecutarse localmente
según `infrastructure/cloudformation/README.md`. La pantalla de escaneo es
optativa y requiere activación local; no autentica al operador ni integra el
resultado con el flujo de producción. El worker demo vuelve a escanear el
handoff y bloquea hallazgos antes de cualquiera de los motores.

La consulta de credenciales de demostración está deshabilitada por defecto con
`DEMO_PROVISIONING_LOCAL=false`. Cuando se habilita, solo acepta solicitudes
desde loopback y el panel local; **no autentica al operador**. Solo muestra la
contraseña inicial de un tenant `ACTIVE` cuyo despliegue haya registrado
`demo_initial_credentials_verified=true` después de comprobar el inicio de
sesión real. El worker demo crea el Vault y ejecuta Ansible antes de establecer
esa marca. Nunca establecer la marca manualmente para una prueba o contraseña
no verificadas.
El cifrado no protege frente a quien pueda leer tanto el Vault como su clave
en la misma cuenta local. No exponer esta función en redes o equipos no
confiables.

La preparación de paquetes de asistencia es una utilidad optativa para
demostración local, deshabilitada por defecto. Tras confirmación consulta
`main` de dos repositorios configurados localmente y prepara o reutiliza
artefactos versionados. No autentica al operador, no ejecuta Ansible ni
aprovisiona recursos; no habilita la creación del tenant. Sus requisitos y
límites se describen en `infrastructure/ansible/README.md`.

La base del formulario de la plantilla ya está implementada y descarga un contrato `DeploymentRequest` marcado `deployable=false`. No persiste datos de contacto en el navegador ni agrega registros a `tenants`. La validación compartida está en `packages/contracts/src/validation.ts`; el integrante 2 debe aplicar también validación autoritativa en servidor al habilitar creación.

Observabilidad del panel: `GET /api/metrics` expone formato Prometheus y `GET /api/monitoring/control-center` devuelve memoria, tiempo activo, CPU acumulada y contadores reales. Esto no es monitoreo de tenants. El stack inicial y los targets se describen en `infrastructure/observability/README.md`.

## Datos

Tres tablas funcionales: `catalog_plans`, `tenants` y `tenant_alerts`. TypeORM mantiene además `migrations`, una tabla técnica. La migración está en `apps/backend/src/database/migrations`; `synchronize=false`.

- `config/plans.json` es la fuente versionada. Al iniciar, la carga actualiza por slug dentro de una transacción y no elimina planes anteriores ni tenants. La edición de planes desde la interfaz no se implementa.
- El plan contiene recursos **por rol**, no un único tamaño ambiguo para todo el tenant. Todos los discos deben ser iguales o mayores que los 12 GiB de las imágenes base.
- `config/golden-images.local.json` es el registro generado de AMIs, ignorado por Git. Puede compartirse una copia sanitizada mediante el proceso de integración acordado o una ruta `GOLDEN_IMAGES_PATH`. No contiene credenciales. Si no existe, se usa el registro inicial vacío.
- `tenants.deployment_metadata` está preparado para RF-13: guardar versión de aplicación, plantillas, motor, Ansible, imágenes y una copia del plan aplicado. No guardar contraseñas, logs completos ni referencias al catálogo que pierdan el valor histórico.

## Integrante 1 → integrantes 2 y 3

Entregar catálogo, AMIs por región/rol, user-data renderizado y versión de las plantillas. Consumir las capacidades de `Plan.roles`; no volver a definir los tamaños en cada motor. Verificar que existen las tres imágenes de la misma región antes de aprovisionar. El manifiesto de Packer registra una construcción, pero la disponibilidad real de las imágenes debe comprobarse en AWS antes de usarlas.

El user-data usa el identificador del tenant validado, zona horaria, swap y configuración de SSH. Las llaves públicas se suministran mediante el key pair de EC2; las privadas nunca se incorporan. Esperar `cloud-init status --wait` antes de Ansible. La AMI de base de datos no captura un cluster: el primer arranque crea PostgreSQL 16; Ansible configura después usuarios, permisos y base exclusiva.

## Desarrollo incremental

| Integrante | Carpeta / responsabilidad | Salida esperada |
| --- | --- | --- |
| 1 | Catálogo, base web/API, Packer y cloud-init | Planes y artefactos reales; Entregable 4 y aportes RF-09/RF-13. |
| 2 | `infrastructure/terraform`, formulario de `crear` | Solicitud validada y motor principal; recursos, direcciones e inventario por tenant. |
| 3 | `infrastructure/pulumi` o `cloudformation`, página `seguridad` | Escaneo y segundo motor con el mismo contrato de salida. |
| 4 | `infrastructure/ansible`, aplicación de asistencia | Configuración del tenant y comprobaciones de aislamiento. |
| 5 | Módulo de trabajos/ciclo de vida, página `tenants` | Ejecución en segundo plano, logs, estado y operaciones reales. |
| 6 | Página `monitoreo`, configuración de observabilidad | Métricas y alertas, documentación y defensa consolidada. |

Los integrantes pueden desarrollar con fixtures identificados antes de recibir recursos reales. No introducir fixtures en la tabla `tenants` como si fueran despliegues existentes. El segundo motor debe funcionar de manera independiente del primero.

## Próximos contratos por acordar

La demo local ya permite guardar borradores y comenzar una operación de creación con confirmación. No es una API de producción: los integrantes 2 y 5 deben acordar autenticación, acceso al estado, recuperación y política de concurrencia compartida antes de habilitarla fuera de un equipo local confiable.

Para evitar nombres divergentes, usar el contrato exportado `DeploymentRequest`: `tenant_slug` e `institution_name` son los nombres definitivos de intercambio para los campos de identificador e institución; los adaptadores mapean explícitamente a las columnas actuales `tenants.slug` y `tenants.name`. Los endpoints de la demo se describen arriba; no sustituyen la orquestación definitiva. El detalle de hitos y guías está en `PLAN-INTEGRACION.md`.

Para el ciclo de vida, acordar la máquina de estados (por ejemplo PENDING, PROVISIONING, ACTIVE, SUSPENDING, SUSPENDED, RESUMING, DELETING, DELETED, FAILED), los errores y la conservación de metadatos. No mezclar estados visuales de una simulación con estados reales en AWS.
