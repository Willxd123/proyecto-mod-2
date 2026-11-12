# Tenant Control Center — Proyecto Módulo 2

Monorepo académico del panel administrador de tenants de la aplicación de asistencia. Primera entrega del **integrante 1**: base compartida, catálogo de planes, registro de imágenes y plantillas Packer/cloud-init. Uso exclusivo de AWS.

La plantilla del docente se usa como referencia funcional: formulario de tres pasos, resumen del tenant, catálogo, imágenes, operaciones y guía del equipo. Se reemplazan sus datos simulados por consultas reales o estados pendientes explícitos. Ver [adaptación de la plantilla](docs/REFERENCIA-PLANTILLA.md).

## Tecnologías acordadas

- Frontend: Angular **20.3**, componentes standalone y rutas por módulo.
- Backend: NestJS **11**, TypeScript y TypeORM con migraciones explícitas.
- Base central: PostgreSQL, base `proyecto_modulo_2`.
- Gestor: **pnpm workspaces** para todo el monorepo, incluido NestJS.
- Node.js: 22.12 o superior dentro de la rama 22; Python 3.10+ para utilidades de infraestructura.

## Inicio local

Desde esta carpeta:

```powershell
pnpm install
Copy-Item apps/backend/.env.example apps/backend/.env
# Completar DATABASE_PASSWORD en el archivo local.
pnpm dev
```

Si ya existe `.env`, conservarlo; la configuración local proporcionada por el equipo ya está guardada allí y excluida de Git. No sobrescribirla con el ejemplo vacío.

```dotenv
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=postgres
DATABASE_PASSWORD=<contraseña local>
DATABASE_NAME=proyecto_modulo_2
DATABASE_SSL=false
```

PostgreSQL debe estar iniciado y la base debe existir. La conexión local fue comprobada durante la preparación del proyecto. Nest ejecuta la migración inicial y carga el catálogo de forma idempotente al arrancar. No usa `synchronize`, no borra tenants ni elimina tablas existentes. Las futuras modificaciones de esquema requieren nuevas migraciones.

- Panel: `http://127.0.0.1:4200`
- API: `http://127.0.0.1:3000/api/health`
- El proxy de Angular dirige `/api` a Nest, sin configurar CORS abierto.

También pueden arrancarse por separado, después de `pnpm --filter @modulo2/contracts build`:

```powershell
pnpm dev:backend
pnpm dev:frontend
```

La API se enlaza a loopback. Esta primera entrega local ofrece consultas de catálogo; la autenticación y los permisos del panel deben definirse antes de alojarlo públicamente o habilitar operaciones de infraestructura.

## Estructura

```text
apps/
  frontend/                 Angular 20: navegación, catálogo y espacios de integración
  backend/                  NestJS: API, entidades y migración PostgreSQL
packages/contracts/         Tipos compartidos entre frontend y backend
config/
  plans.json                Fuente versionada del catálogo
  golden-images.json        Registro inicial vacío, sin AMIs ficticias
infrastructure/
  packer/                   Construcción de las tres imágenes por rol
  cloud-init/               Plantillas de primer arranque, sin secretos
  terraform/                Punto de integración del integrante 2
  pulumi/                   Referencia para integrante 3
  cloudformation/           Alternativa para integrante 3
  ansible/                  Punto de integración del integrante 4
scripts/                    Render de user-data, importación de AMIs y catálogo
docs/                       Contratos, reparto, catálogo y verificación
tests/                      Pruebas de API y contratos de infraestructura
```

## Qué funciona y qué está pendiente

| Parte | Estado de implementación |
| --- | --- |
| Catálogo RF-01 y RF-02 | API desde PostgreSQL, tarjetas, selección y comparación por servidor. |
| Panel compartido | Navegación, formulario validado de tres pasos, resumen reactivo, borrador descargable y guía de los seis roles. |
| Packer / cloud-init | Plantillas y utilidades implementadas; AMIs y arranque real en AWS pendientes de validar. |
| RF-09 | Nuestro aporte son imágenes y user-data. Los integrantes 2 y 3 implementan el aprovisionamiento. |
| RF-13 | Tipos compartidos, versiones de catálogo e imágenes y campo de metadatos preparado. Falta integrar las versiones reales de cada despliegue con los demás módulos. |
| Creación y ciclo de vida | El formulario prepara una solicitud `deployable=false`. La ejecución y persistencia están pendientes de integrantes 2 y 5. No se crean tenants simulados ni se ejecuta IaC desde la API. |
| Escaneo | Espacio preparado; implementación pendiente de integrante 3. |
| Monitoreo | Métricas reales del panel disponibles. Base Compose de Prometheus/Grafana y targets preparada; falta validar su arranque y completar monitoreo/alertas por tenant con integrante 6. |

Crear tenant permite completar y validar datos, elegir plan/motor, revisar las AMIs por región y descargar una solicitud de integración. La solicitud no equivale a un tenant desplegado. Las capacidades del catálogo son propuestas de laboratorio, no precios, cuotas automáticas ni garantías de rendimiento. No se ofrecen respaldos como parte del alcance base.

## Comandos de comprobación

```powershell
pnpm build
pnpm test
pnpm check
python scripts/generate_catalog.py
python scripts/render_cloud_init.py --tenant instituto-demo --role frontend --output output/instituto-demo/frontend.yaml
```

`pnpm test` comprueba contratos y la API contra la base configurada, sin insertar tenants ni borrar la base; el arranque puede aplicar migraciones pendientes y actualizar el catálogo. Las utilidades Python se prueban con la biblioteca estándar; si PyYAML está instalado también se valida el contenido YAML. Ver [estado de verificación](docs/VERIFICACION.md) para distinguir comprobaciones realizadas de pendientes.

## Integración y reutilización

- [Responsabilidades y contratos](docs/INTEGRACION.md).
- [Plan de integración escalable y guías para los agentes](docs/PLAN-INTEGRACION.md).
- [Catálogo de planes — Entregable 4](docs/CATALOGO-PLANES.md).
- [Construir y registrar imágenes](infrastructure/packer/README.md).
- [Base de observabilidad](infrastructure/observability/README.md).

Se revisaron los proyectos existentes como referencia. No se copiaron claves privadas, secretos de Ansible, inventarios con direcciones reales, estados Terraform ni configuraciones privadas de Pulumi. Los motores y la aplicación de asistencia existentes se integrarán de forma deliberada en las carpetas correspondientes; esta entrega no declara esos módulos como terminados.
