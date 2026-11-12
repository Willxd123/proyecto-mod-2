# Tenant Control Center — Proyecto Módulo 2

Monorepo académico del panel administrador de tenants de la plataforma multi-tenant de asistencia. Cada institución (tenant) dispone de tres servidores propios en AWS: frontend, backend y base de datos. Este repositorio reúne el panel (Angular + NestJS), el catálogo de planes, las Golden Images (Packer + cloud-init) y los puntos de integración de los seis integrantes. Uso exclusivo de **AWS**.

> **Lee primero** [`AGENTS.md`](AGENTS.md) (reglas de trabajo y seguridad) y la guía de tu rol en [`docs/agentes/`](docs/agentes/).

## Estado del proyecto

| Hito | Responsable | Estado |
| --- | --- | --- |
| M0 — Base compartida (monorepo, catálogo, contratos, panel) | Integrante 1 | Completo |
| M1 — Golden Images y primer arranque | Integrante 1 | **Completo**: 3 AMIs construidas en `us-east-1` y verificadas con smoke test (evidencia en `docs/image.png`) |
| M2 — Dos motores IaC compatibles | Integrantes 2 y 3 | Pendiente |
| M3 — Aplicación de asistencia por institución | Integrante 4 | Pendiente |
| M4 — Orquestación y ciclo de vida | Integrante 5 | Pendiente |
| M5 — Observabilidad por tenant | Integrante 6 | Pendiente |

Qué funciona hoy en el panel y qué no:

| Parte | Estado |
| --- | --- |
| Catálogo de planes (RF-01, RF-02) | API desde PostgreSQL (`catalog_plans`), con columnas de capacidad y `backup_policy`. Pantalla *Planes y Golden AMIs*. |
| Golden Images (RF-09, RF-13) | Registro validado en `config/golden-images.json`, reflejado en la tabla `golden_images` y expuesto en `/api/golden-images`. |
| Crear tenant | Asistente de tres pasos con validación; usa planes y AMIs reales. **No aprovisiona**: la creación está deshabilitada en el backend hasta que existan el orquestador y los motores. |
| Lista de tenants | Consulta real (vacía por ahora), con filtros. Las acciones de ciclo de vida son del integrante 5. |
| Escáner y monitoreo | Espacios reservados; no muestran datos simulados. Integrantes 3 y 6. |

No se presentan simulaciones como despliegues reales: lo que aún no existe aparece marcado como pendiente.

## Después de clonar: deja tu equipo igual que el del integrante 1

Git trae el código, las plantillas, el catálogo y el registro de las 3 AMIs. **No trae** lo que es privado o local; eso lo pones tú siguiendo estos pasos, en orden:

| # | Qué | Quién lo da | Cómo |
| --- | --- | --- | --- |
| 1 | Herramientas: Node 22 (≥ 22.12), pnpm 10, Python 3.10+, AWS CLI v2, Git | Tú | Ver [Requisitos](#requisitos) |
| 2 | Dependencias | Git + pnpm | `pnpm install --frozen-lockfile` |
| 3 | PostgreSQL con la base `proyecto_modulo_2` | Tú | Instalado local o con Docker (ver [Primeros pasos](#primeros-pasos)) |
| 4 | `apps/backend/.env` | Tú | `Copy-Item apps/backend/.env.example apps/backend/.env` y completa `DATABASE_PASSWORD` |
| 5 | Clave `.pem` (`practico7-asistencia`) | **Integrante 1**, canal privado | Guárdala **fuera del repo** y restringe permisos |
| 6 | Credenciales IAM (Access Key ID + Secret) y el ID de la cuenta | **Integrante 1**, canal privado | `aws configure --profile modulo2` y `$env:AWS_PROFILE = "modulo2"` |
| 7 | Comprobar la cuenta | Tú | `aws sts get-caller-identity` → el `Account` debe ser el que te dieron |
| 8 | Comprobar acceso a las AMIs | Tú | `aws ec2 describe-images --region us-east-1 --owners self --query "Images[].[ImageId,Name,State]" --output text` → deben salir 3 AMIs `available` |
| 9 | Preflight (solo lectura) | Tú | Ver [Acceso a la cuenta AWS](#acceso-a-la-cuenta-aws-compartida), con tu IP pública real |
| 10 | Verificar todo el proyecto | Tú | `pnpm check` |

Con los pasos 1 a 4 ya funciona el panel (`pnpm dev`). Los pasos 5 a 9 solo hacen falta para operar sobre AWS (motores IaC, Ansible, monitoreo).

**Qué no necesitas replicar:**
- `config/golden-images.json` ya viene en Git con las AMIs reales; no hay que construir nada.
- No instales Packer ni ejecutes `aws_images.py build`: construir imágenes es del integrante 1 y genera costos.
- `output/`, `.tools/` y `config/golden-images.local.json` son locales de quien construye y están ignorados por Git.

**Si algo no coincide**, revisa en este orden: versión de Node (`node --version`), cuenta AWS (paso 7), región `us-east-1` y que la base de datos exista y tenga la contraseña del `.env`.

## Requisitos

- Node.js **22.12 o superior de la rama 22** y pnpm 10 (`corepack enable` o `npm i -g pnpm@10`).
- PostgreSQL 15+ con una base llamada `proyecto_modulo_2` (o Docker, ver más abajo).
- Python 3.10+ (utilidades de infraestructura).
- AWS CLI v2 (para trabajar con la cuenta compartida).
- Git. En Windows, PowerShell.

## Primeros pasos

```powershell
git clone https://github.com/Willxd123/proyecto-mod-2.git
cd proyecto-mod-2
pnpm install --frozen-lockfile
Copy-Item apps/backend/.env.example apps/backend/.env
# Editar apps/backend/.env y completar DATABASE_PASSWORD
pnpm dev
```

- Panel: <http://127.0.0.1:4200> · API: <http://127.0.0.1:3000/api/health>
- El proxy de Angular envía `/api` a NestJS. La API escucha solo en loopback.
- No crear `package-lock.json` ni otro backend/frontend independiente: es un solo workspace pnpm con un único `pnpm-lock.yaml`.

Configuración de la base (`apps/backend/.env`, ignorado por Git):

```dotenv
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=postgres
DATABASE_PASSWORD=<tu contraseña local>
DATABASE_NAME=proyecto_modulo_2
DATABASE_SSL=false
```

¿Sin PostgreSQL instalado? Un contenedor descartable sirve para desarrollar:

```powershell
docker run -d --name m2-pg -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=proyecto_modulo_2 -p 5432:5432 postgres:16
# y en apps/backend/.env: DATABASE_PASSWORD=dev
```

Al arrancar, Nest aplica las migraciones pendientes y carga el catálogo de forma idempotente. No usa `synchronize`: cada integrante agrega **migraciones nuevas** para sus cambios y nunca edita una ya aplicada. Arranque por separado: `pnpm dev:backend` y `pnpm dev:frontend` (antes, `pnpm --filter @modulo2/contracts build`).

## Acceso a la cuenta AWS compartida

El integrante 1 entrega por un canal privado (nunca por Git, capturas ni chat público) tres cosas: la clave **`.pem`**, la **clave de acceso del usuario IAM** (Access Key ID y Secret) y el **ID de la cuenta esperada**.

**1. Clave SSH (`.pem`).** Guárdala **fuera del repositorio**, por ejemplo en `C:\claves\practico7-asistencia.pem`. El key pair se llama `practico7-asistencia`. En Windows, restringe sus permisos a tu usuario:

```powershell
icacls C:\claves\practico7-asistencia.pem /inheritance:r /grant:r "$($env:USERNAME):(R)"
```

**2. Credenciales IAM.** Configúralas en tu equipo con un perfil (se guardan en `~/.aws`, fuera del repo):

```powershell
aws configure --profile modulo2      # región por defecto: us-east-1
$env:AWS_PROFILE = "modulo2"
aws sts get-caller-identity          # el Account debe coincidir con el ID que te entregaron
```

**3. Comprobación sin modificar nada (solo lectura):**

```powershell
python scripts/aws_images.py preflight --region us-east-1 --ssh-cidr TU_IP_PUBLICA/32 --key-name practico7-asistencia --pem C:/claves/practico7-asistencia.pem
```

Sustituye `TU_IP_PUBLICA` por tu IP pública real (por ejemplo, la que muestra `curl https://checkip.amazonaws.com`); el comando rechaza valores de ejemplo. Genera `output/aws-preflight.json`, ignorado por Git.

**Reglas de la cuenta compartida** (resumen de `AGENTS.md`):

- Tener acceso técnico **no autoriza** modificar recursos de otros integrantes.
- Etiqueta todo lo que crees con `Project=proyecto-modulo-2`, `MemberId=integrante-N`, `TenantId` y `RunId`. Verifica cuenta y región antes de escribir.
- Estado de IaC **separado por tenant y por motor**. No apliques un motor sobre recursos de otro.
- Prohibido borrar por nombre parcial, por cuenta completa o "todo lo del usuario IAM". Borra por ID exacto, verificando etiquetas.
- Las AMIs y sus snapshots facturan mientras existan. No las elimines sin acordarlo con el integrante 1.
- **Nunca** subas a Git: `.env`, `.pem`, claves AWS, estados `.tfstate`, inventarios privados ni logs sensibles (el `.gitignore` ya excluye los habituales; revisa `git status` antes de cada commit).

## Golden Images (Integrante 1)

Tres AMIs privadas de Ubuntu 24.04, una por rol, construidas con Packer 1.14.3. Contienen **solo el entorno de ejecución**, no el código de la aplicación de asistencia (lo instala Ansible, integrante 4). Sus IDs reales están en [`config/golden-images.json`](config/golden-images.json), con versión, commit de origen y fecha.

| Rol | Contenido principal |
| --- | --- |
| frontend | Nginx, Node 22, pnpm, utilidades de red, node_exporter (puerto 9100) |
| backend | Node 22, pnpm, PM2, Python 3 + Gunicorn, Git, cliente PostgreSQL, xz-utils, node_exporter |
| database | PostgreSQL 16 (sin cluster inicial), herramientas de respaldo, OpenSSL, postgres_exporter (deshabilitado hasta configurarse) |

**Cómo las consumen los demás**

- Por API: `GET /api/golden-images?region=us-east-1`. Cada rol de un tenant se lanza con su AMI y el tipo de instancia/disco del plan elegido (`GET /api/plans`). Los discos deben ser ≥ 12 GiB.
- Las instancias nuevas requieren IMDSv2 y volúmenes cifrados.
- **user-data** (cloud-init): hostname `<tenant>-<rol>`, zona `America/La_Paz`, swap de 2 GiB, SSH solo por llave. Se genera con:

```powershell
ssh-keygen -y -f C:\claves\practico7-asistencia.pem > practico7.pub     # llave pública
python scripts/render_cloud_init.py --tenant instituto-demo --role backend --ssh-public-key-file practico7.pub --output output/instituto-demo/backend.yaml
```

- Solicitud de despliegue de ejemplo (no crea recursos; `deployable=true` solo si existen las tres AMIs de la región):

```powershell
python scripts/prepare_handoff.py --tenant instituto-demo --name "Instituto Demo" --email admin@demo.edu --plan estandar --engine terraform --key-name practico7-asistencia --registry config/golden-images.json --ssh-public-key-file practico7.pub
```

Reconstruir las imágenes (solo el integrante 1; genera costos): ver [`infrastructure/packer/README.md`](infrastructure/packer/README.md).

## Estructura

```text
apps/
  frontend/                 Angular 20: panel (planes, crear tenant, tenants, espacios de integración)
  backend/                  NestJS 11: API, entidades TypeORM y migraciones PostgreSQL
packages/contracts/         Tipos compartidos entre frontend y backend (versionados)
config/
  plans.json                Fuente versionada del catálogo (3 planes)
  golden-images.json        Registro de las AMIs reales verificadas
infrastructure/
  packer/                   Plantilla y scripts de las tres imágenes por rol
  cloud-init/               Plantillas de primer arranque, sin secretos
  terraform/                Punto de integración del integrante 2
  pulumi/ cloudformation/   Integrante 3
  ansible/                  Integrante 4
  observability/            Base Prometheus/Grafana (integrante 6)
scripts/                    Packer en AWS, user-data, handoff, catálogo
docs/                       Contratos, plan de integración, catálogo y guías por agente
tests/                      Pruebas de API y de contratos de infraestructura
```

## Tecnologías acordadas

Angular **20.3** (componentes standalone), NestJS **11**, TypeORM con migraciones explícitas, PostgreSQL, **pnpm workspaces**, AWS. Los contratos compartidos viven en `packages/contracts`; si necesitas un cambio incompatible, propón una versión nueva y coordina con los consumidores.

## Comandos de comprobación

```powershell
pnpm check          # compila contratos/backend, ejecuta pruebas y construye frontend
pnpm test           # pruebas de API (requiere PostgreSQL) y de infraestructura (Python)
python scripts/generate_catalog.py    # regenera docs/CATALOGO-PLANES.md desde config/plans.json
```

`pnpm test` usa la base configurada en `apps/backend/.env`: aplica migraciones y recarga el catálogo y la tabla `golden_images`, pero no inserta tenants ni borra tablas. Ver [`docs/VERIFICACION.md`](docs/VERIFICACION.md) para distinguir evidencia local de evidencia en AWS.

## Antes de entregar tu parte

Código, pruebas reproducibles, lista de archivos modificados, contratos consumidos y producidos, y limitaciones verificadas. Actualiza la documentación afectada y distingue evidencia local de evidencia AWS.

## Limitaciones conocidas

- Las imágenes usan Ubuntu **24.04** y una única plantilla Packer parametrizada por rol.
- No hay respaldos automáticos ni control de cuotas por plan (política `backup_policy`: manual con `pg_dump`); los límites de estudiantes son informativos.
- Las capacidades del catálogo son propuestas de laboratorio, no precios ni garantías de rendimiento.
- La API no tiene autenticación: no exponerla públicamente antes de definirla.

## Documentación

- [Responsabilidades y contratos](docs/INTEGRACION.md) · [Plan de integración](docs/PLAN-INTEGRACION.md)
- [Catálogo de planes — Entregable 4](docs/CATALOGO-PLANES.md)
- [Construir y registrar imágenes](infrastructure/packer/README.md)
- [Base de observabilidad](infrastructure/observability/README.md)
- [Adaptación de la plantilla del docente](docs/REFERENCIA-PLANTILLA.md)
