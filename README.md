# Tenant Control Center — Proyecto Módulo 2

Monorepo académico del panel administrador de tenants de la plataforma multi-tenant de asistencia. Cada institución (tenant) dispone de tres servidores propios en AWS: frontend, backend y base de datos. Este repositorio reúne el panel (Angular + NestJS), el catálogo de planes, las Golden Images (Packer + cloud-init) y los puntos de integración de los seis integrantes. Uso exclusivo de **AWS**.

> **Lee primero** [`AGENTS.md`](AGENTS.md) (reglas de trabajo y seguridad) y la guía de tu rol en [`docs/agentes/`](docs/agentes/).

## Este repositorio es un monorepo

Todo el proyecto vive en **un solo repositorio** (workspace `pnpm`): el panel, el backend, la infraestructura, los scripts, la observabilidad y la documentación. Los entregables 1 y 2 son carpetas de este mismo repositorio, no repositorios distintos.

| Quiero… | Está en |
| --- | --- |
| Ver o cambiar el **panel** (Angular 20) | `apps/frontend` |
| Ver o cambiar la **API** (NestJS 11, TypeORM, migraciones) | `apps/backend` (`src/lifecycle`, `audit`, `auth`, `monitoring`, `logs`, `tenants`, `security`) |
| Tipos compartidos panel ↔ backend | `packages/contracts` |
| **Catálogo de planes** y **AMIs** | `config/plans.json`, `config/golden-images.json`, [`docs/CATALOGO-PLANES.md`](docs/CATALOGO-PLANES.md) |
| **Imágenes** (Packer) y primer arranque (cloud-init) | `infrastructure/packer`, `infrastructure/cloud-init` |
| **Motores IaC** | `infrastructure/cloudformation`, `terraform`, `pulumi` (OpenTofu reutiliza `terraform`) |
| **Ansible** (database, backend, frontend) | `infrastructure/ansible` |
| **Prometheus + Grafana** (tableros y alertas como código) | `infrastructure/observability` |
| **Workers** (crear, suspender, reanudar, eliminar, respaldar, escáneres, log en vivo) | `scripts/` |
| **Pruebas** | `tests/` |
| **Informe final** (entregables 3, 4, 6, 7, 8) | [`docs/PROYECTO FINAL DOCUMENTO FINAL.md`](docs/PROYECTO%20FINAL%20DOCUMENTO%20FINAL.md) |
| Cómo operar un tenant (crear, suspender, reanudar, respaldar, restaurar, eliminar) | [`docs/INSTRUCCIONES-TENANT.md`](docs/INSTRUCCIONES-TENANT.md) |
| **Guiones del video** | [`docs/guion/`](docs/guion/README.md) |
| Reglas de seguridad y de trabajo | [`AGENTS.md`](AGENTS.md) |

La **aplicación de asistencia** que corre dentro de cada tenant **no está aquí**: son dos repositorios aparte, `control-asistencia-backend` y `control-asistencia-frontend` (siempre la rama `main`). Este repositorio los empaqueta y los despliega.

## Estado del proyecto

Estado al 15 de noviembre de 2026. La evidencia de cada capacidad (AWS real, local o simulada) está en la sección 1.3 del [informe final](docs/PROYECTO%20FINAL%20DOCUMENTO%20FINAL.md).

| Hito | Estado |
| --- | --- |
| M0 — Base compartida (monorepo, catálogo, contratos, panel) | Completo |
| M1 — Golden Images y primer arranque | Completo: 3 AMIs en `us-east-1` con smoke test |
| M2 — Motores IaC | **CloudFormation y Terraform verificados en AWS real desde el panel.** OpenTofu y Pulumi están desbloqueados en el selector, probados con simulación y vista previa, sin despliegue real |
| M3 — Aplicación de asistencia por institución | Ansible, HTTPS, reanudación con IP nueva y monitoreo remoto funcionan. Falta ejecutar la prueba de aislamiento entre dos tenants |
| M4 — Orquestación y ciclo de vida | Completo: creación con log en vivo, suspender, reanudar (con **reintento desde `ERROR`**), eliminar, respaldar/restaurar, auditoría, login y visor de logs. Respaldar/restaurar solo se probó en simulación |
| M5 — Observabilidad | Completo: Prometheus + Grafana (Resumen, Salud por tenant, 8 alertas), webhook al panel y logs. Verificado con un tenant real |

Qué funciona hoy en el panel:

| Parte | Estado |
| --- | --- |
| Acceso | Inicio de sesión de administrador único (`ADMIN_USER` / `ADMIN_PASSWORD`). Sin `ADMIN_PASSWORD` el panel queda abierto, solo para desarrollo |
| Catálogo (RF-01, RF-02) | API desde PostgreSQL, pantalla *Planes y Golden AMIs* |
| Crear tenant (RF-07 a RF-11) | Borrador → 3 escáneres (Trivy, Checkov + regla 5432, Trivy Config/cfn-lint) → motor IaC → Ansible → HTTPS y login. **Crea recursos AWS reales y genera cargos.** Requiere `DEMO_PROVISIONING_LOCAL=true` |
| Ciclo de vida (RF-14 a RF-18) | Lista con filtros, renombrar, suspender, reanudar, reintentar reanudación, eliminar con confirmación |
| Respaldo y restauración (RF-19) | `pg_dump` / `pg_restore` por SSH; los respaldos quedan en `output/backups/<tenant>/` (ignorado por Git, datos reales) |
| Auditoría (RF-20) | Página *Auditoría*: quién, cuándo, tenant y resultado de cada operación |
| Monitoreo (RF-25 a RF-29) | Página *Monitoreo* con túneles, alertas y enlace a Grafana |
| Logs | Página *Logs*: Nginx, aplicación, PostgreSQL y sistema de cada tenant `ACTIVE`, por SSH |

`LIFECYCLE_SIMULATE=true` permite probar suspender, reanudar, eliminar, respaldar y restaurar **sin tocar AWS**; todo queda marcado `[SIMULADO]` y no cuenta como evidencia real.

## Levantar el proyecto en local (resumen)

Hay tres piezas que se levantan por separado. Las dos primeras no necesitan AWS.

| # | Pieza | Comando (desde la raíz) | Dirección |
| --- | --- | --- | --- |
| 1 | **PostgreSQL** del panel | `docker run -d --name m2-pg -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=proyecto_modulo_2 -p 5432:5432 postgres:16` (o uno local) | `localhost:5432` |
| 2 | **Panel + API** | `pnpm install --frozen-lockfile` y luego `pnpm dev` | Panel <http://127.0.0.1:4200> · API <http://127.0.0.1:3000/api/health> |
| 3 | **Prometheus + Grafana** | `docker compose --env-file infrastructure/observability/.env -f infrastructure/observability/compose.yaml up -d` | Grafana <http://localhost:3002> · Prometheus <http://localhost:9090> |

Pasos mínimos, en orden:

```powershell
pnpm install --frozen-lockfile
Copy-Item apps/backend/.env.example apps/backend/.env
# Editar apps/backend/.env: DATABASE_PASSWORD, ADMIN_PASSWORD y WEBHOOK_TOKEN
Copy-Item infrastructure/observability/.env.example infrastructure/observability/.env
# Editar infrastructure/observability/.env: GRAFANA_ADMIN_PASSWORD y el MISMO WEBHOOK_TOKEN
docker compose --env-file infrastructure/observability/.env -f infrastructure/observability/compose.yaml up -d
pnpm dev
```

- Entra al panel con `ADMIN_USER` (por defecto `admin`) y tu `ADMIN_PASSWORD`. Grafana: usuario `admin` y `GRAFANA_ADMIN_PASSWORD`. **Ningún `.env` se sube a Git.**
- Grafana abre en **Resumen de la plataforma**. Aparece vacío («No data») hasta que haya un tenant `ACTIVE`.
- **Para ver datos reales** hace falta un tenant creado en AWS y, en `apps/backend/.env`: `DEMO_PROVISIONING_LOCAL=true`, `LIFECYCLE_SIMULATE=false`, la llave SSH (`DEMO_SSH_PRIVATE_KEY_WSL_PATH`) y WSL con Ansible. Con eso el panel abre solo los túneles SSH y Prometheus ve el tenant. Detalles y límites: [`infrastructure/observability/README.md`](infrastructure/observability/README.md).
- **Sin AWS:** pon `LIFECYCLE_SIMULATE=true` para probar el ciclo de vida de forma simulada. El tablero de Grafana seguirá vacío porque no hay servidores reales.
- Si cambias los tableros o las alertas: edita `infrastructure/observability/generar_grafana.py` / `generar_resumen.py` y ejecuta `python infrastructure/observability/generar_grafana.py` (regenera los JSON de los tableros y las reglas de alerta; si Grafana no los recarga solo, reinicia su contenedor).
- Detener Grafana: `docker compose --env-file infrastructure/observability/.env -f infrastructure/observability/compose.yaml down`.
- Verificar todo: `pnpm check` (compila, ejecuta las pruebas con PostgreSQL y construye el panel).

Operar sobre AWS (crear tenants, motores IaC, Ansible) exige además lo de [Después de clonar](#después-de-clonar) y [Acceso a la cuenta AWS](#acceso-a-la-cuenta-aws-compartida).

## Después de clonar

Git trae el código, las plantillas, el catálogo y el registro de las 3 AMIs. **No trae** lo que es privado o local; eso lo pones tú siguiendo estos pasos, en orden:

| # | Qué | Quién lo da | Cómo |
| --- | --- | --- | --- |
| 1 | Herramientas: Node 22 (≥ 22.12), pnpm 10, Python 3.10+ (`checkov`, `cfn-lint`), Trivy, AWS CLI v2, Git | Tú | Ver [Requisitos](#requisitos) |
| 2 | Dependencias | Git + pnpm | `pnpm install --frozen-lockfile` |
| 3 | PostgreSQL con la base `proyecto_modulo_2` | Tú | Instalado local o con Docker (ver [Primeros pasos](#primeros-pasos)) |
| 4 | `apps/backend/.env` | Tú | `Copy-Item apps/backend/.env.example apps/backend/.env` y completa `DATABASE_PASSWORD`, `ADMIN_PASSWORD` y `WEBHOOK_TOKEN` |
| 4b | `infrastructure/observability/.env` (Grafana) | Tú | `Copy-Item infrastructure/observability/.env.example infrastructure/observability/.env`; mismo `WEBHOOK_TOKEN`; ver [Levantar el proyecto en local](#levantar-el-proyecto-en-local-resumen) |
| 5 | Clave `.pem` (`practico7-asistencia`) | **Integrante 1**, canal privado | Guárdala **fuera del repo** y restringe permisos |
| 6 | Credenciales IAM (Access Key ID + Secret) y el ID de la cuenta | **Integrante 1**, canal privado | `aws configure --profile modulo2` y `$env:AWS_PROFILE = "modulo2"` |
| 7 | Comprobar la cuenta | Tú | `aws sts get-caller-identity` → el `Account` debe ser el que te dieron |
| 8 | Comprobar acceso a las AMIs | Tú | `aws ec2 describe-images --region us-east-1 --owners self --query "Images[].[ImageId,Name,State]" --output text` → deben salir 3 AMIs `available` |
| 9 | Preflight (solo lectura) | Tú | Ver [Acceso a la cuenta AWS](#acceso-a-la-cuenta-aws-compartida), con tu IP pública real |
| 10 | Verificar todo el proyecto | Tú | `pnpm check` |

Con los pasos 1 a 4 ya funciona el panel (`pnpm dev`); el 4b añade Grafana. Los pasos 5 a 9 solo hacen falta para operar sobre AWS (motores IaC, Ansible, monitoreo).

**Qué no necesitas replicar:**
- `config/golden-images.json` ya viene en Git con las AMIs reales; no hay que construir nada.
- No instales Packer ni ejecutes `aws_images.py build`: construir imágenes es del integrante 1 y genera costos.
- `output/`, `.tools/` y `config/golden-images.local.json` son locales de quien construye y están ignorados por Git.

**Si algo no coincide**, revisa en este orden: versión de Node (`node --version`), cuenta AWS (paso 7), región `us-east-1` y que la base de datos exista y tenga la contraseña del `.env`.

## Requisitos

- Node.js **22.12 o superior de la rama 22** y pnpm 10 (`corepack enable` o `npm i -g pnpm@10`).
- PostgreSQL 15+ con una base llamada `proyecto_modulo_2` (o Docker, ver más abajo).
- Python 3.10+ (utilidades de infraestructura y escáneres Python: `pip install checkov cfn-lint`).
- Trivy (`trivy --version`, usado tanto para detección de secretos como para configuraciones IaC `misconfig`).
- AWS CLI v2 (para trabajar con la cuenta compartida).
- Git. En Windows, PowerShell.

## Primeros pasos

```powershell
git clone https://github.com/Willxd123/proyecto-mod-2.git
cd proyecto-mod-2
# Cambia a la rama de integración vigente (la que el equipo acuerde fusionar a main)
pnpm install --frozen-lockfile
Copy-Item apps/backend/.env.example apps/backend/.env
# Editar apps/backend/.env y completar DATABASE_PASSWORD (y ADMIN_PASSWORD)
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

## Preparar una demostración web AWS

Estos pasos son adicionales al arranque del panel. La demo está desactivada por
defecto, solo protege el panel con el usuario administrador local, crea infraestructura real y puede generar
cargos incluso si falla. Úsala solo en un equipo local confiable, con autorización
del equipo y un identificador nuevo. No es un despliegue de producción.

1. Instala AWS CLI v2, Trivy y los escáneres Python (`pip install checkov cfn-lint`) en Windows. Para Terraform instala también
   Terraform en Windows; CloudFormation usa AWS CLI. En Windows, instala WSL
   con Ubuntu 24.04 y, dentro de WSL, Git, Python 3 con `venv`, Ansible,
   Ansible Vault, SSH y la colección `community.postgresql`. La preparación de
   paquetes requiere Node y npm disponibles en WSL o desde Windows. Comprueba
   `aws --version`, `trivy --version`, `checkov --version`, `cfn-lint --version`, `terraform version`, `wsl --status`,
   `wsl --exec ansible-playbook --version` y
   `wsl --exec ansible-galaxy collection list community.postgresql`.
   Terraform solo es necesario si se selecciona ese motor.
   Por ejemplo, en una terminal de Ubuntu 24.04 en WSL:

   ```bash
   sudo apt update
   sudo apt install -y git python3 python3-venv openssh-client ansible
   ansible-galaxy collection install community.postgresql
   mkdir -p "$HOME/tenant-control-center/packages"
   cd "$HOME/tenant-control-center/packages"
   apt download python3-psycopg2
   ```

   Confirma la arquitectura y versión del paquete frente a la AMI antes de
   usarlo. La instalación de herramientas requiere acceso a Internet; no
   instala dependencias dentro de las instancias AWS.
2. Configura un perfil AWS local y confirma cuenta y región siguiendo
   [Acceso a la cuenta AWS](#acceso-a-la-cuenta-aws-compartida). Las tres AMIs
   registradas deben existir y estar disponibles en esa cuenta y región. Antes
   de escribir, verifica además las etiquetas y la propiedad de cada tenant.
3. En WSL guarda una copia protegida de la clave SSH autorizada **fuera del
   repositorio**, con permisos `0400` o `0600`; el key pair en AWS debe
   corresponder a esa clave. Necesitas también un paquete local
   `python3-psycopg2` compatible con Ubuntu 24.04 y la arquitectura de la AMI,
   accesible desde WSL. No se incluye ni se descarga automáticamente.
4. Copia `config/assistance-artifacts.example.json` a
   `infrastructure/ansible/vars/private/artifact-sources.json` y configura allí
   las URL HTTPS de los repositorios autorizados de asistencia, sin credenciales
   en las URL. La utilidad prepara las revisiones de **`main`** de ambos
   repositorios; confirma con el equipo que esas revisiones incluyen la versión
   deseada. No utiliza automáticamente ramas de trabajo ni PR pendientes.
5. En `apps/backend/.env`, configura `DATABASE_*` y mantén `HOST=127.0.0.1`.
   Activa temporalmente `ARTIFACT_PREPARATION_LOCAL=true`, arranca `pnpm dev`
   y en el paso 3 de Crear tenant usa **Comprobar paquetes**. Acepta la
   preparación cuando corresponda y copia el identificador de 32 caracteres
   mostrado. Se requiere acceso a GitHub y a los registros de dependencias.
6. Completa localmente estas variables, sin compartir el `.env`:

   | Variable | Valor que debe proporcionar el operador |
   | --- | --- |
   | `AWS_EXPECTED_ACCOUNT_ID` | ID de 12 dígitos de la cuenta autorizada. |
   | `DEMO_SSH_CIDR` | IP pública actual del operador con `/32`. |
   | `DEMO_SSH_PRIVATE_KEY_WSL_PATH` | Ruta absoluta Linux/WSL de la clave protegida. |
   | `SSH_KEY_PAIR_NAME` | Nombre del key pair correspondiente en la región. |
   | `DEMO_CERTBOT_EMAIL` | Correo válido para emisión de certificado. |
   | `DEMO_POSTGRESQL_PSYCOPG_DEB` | Ruta absoluta WSL al paquete `.deb` compatible. |
   | `DEMO_ARTIFACT_RELEASE` | Identificador verificado en «Comprobar paquetes». |
   | `DEMO_ADMIN_NAME` | Nombre inicial del administrador de asistencia. |

7. Configura `DEMO_PROVISIONING_LOCAL=true` y, si vas a usar la pantalla
   independiente de Seguridad, `SECURITY_SCAN_LOCAL=true`. Reinicia el backend
   solo si no hay trabajos activos. Con la misma terminal y perfil AWS, abre
   el panel, consulta **Actualizar requisitos** y resuelve cualquier faltante.
8. En Crear tenant registra institución, correo, plan, región y motor, guarda
   el borrador y revisa el resumen. En el Paso 2 puedes probar directamente los
   **3 escáneres de seguridad** (`Trivy Secret Scanner`, `Checkov IaC & Regla 5432` y
   `Trivy Config & cfn-lint`) sobre el borrador o consultarlos en `/seguridad`.
   Confirma el aprovisionamiento en el Paso 3 solo si aceptas los cargos. El worker
   ejecuta los 3 escáneres (deteniendo el despliegue únicamente ante secretos o
   hallazgos `CRITICAL` como el puerto `5432` expuesto a `0.0.0.0/0`, y mostrando
   en consola las advertencias informativas `HIGH`/`MEDIUM`/`LOW`) → motor IaC →
   Ansible → verificación HTTPS/login; `ACTIVE` se registra solo tras la
   verificación. La contraseña inicial verificada puede consultarse desde la lista
   de tenants durante la demo. Conserva el Vault local y su clave con acceso
   restringido.
9. Al terminar, vuelve los flags a `false` y reinicia únicamente cuando no
   haya trabajos activos. Los recursos **no se eliminan automáticamente**.
   Coordina su eliminación por tenant y motor, con plan y confirmación; conserva
   el estado y los metadatos locales mientras los recursos existan.

Si un trabajo permanece en `configure`, no lo reinicies ni repitas: puede estar
ejecutando Ansible, cuya salida detallada no se muestra en el panel. El límite
actual para ese paso es de 90 minutos, no una estimación de duración normal.
Si se reinicia la API o se pierde el seguimiento, revisa procesos, cuenta,
región y recursos del tenant antes de cualquier reintento o eliminación.
El historial en memoria no sobrevive al reinicio ni constituye una cola durable.
Los detalles de paquetes, Vault y diagnóstico están en
[la guía de Ansible](infrastructure/ansible/README.md#orquestación-demo-local).

## Archivos que se comparten y que no

- Git incluye el código, `pnpm-lock.yaml`, ejemplos sin secretos, catálogo,
  registro de AMIs, plantillas, pruebas y documentación. Las AMIs registradas
  deben seguir disponibles en la cuenta compartida; Git no contiene las imágenes.
- Se incluye [la plantilla Excel de prueba](plantilla_carga_asistencia_prueba_actualizada.xlsx)
  con estudiantes sintéticos y una clase el 14 de noviembre de 2026. Para otra
  fecha, actualiza la hoja `fechas_clase` y asegúrate de que el período del
  módulo incluya esa fecha. No subas planillas con datos reales de estudiantes.
- Cada integrante crea su propio `apps/backend/.env` a partir de `.env.example`.
  El equipo entrega por canal privado autorizado el acceso IAM, ID de cuenta y
  clave SSH; nunca se publica su contenido en Git, logs o capturas.
- La configuración de fuentes de asistencia es local; comparte las URL sin
  credenciales y las revisiones acordadas. Se pueden regenerar los paquetes
  localmente; si se transfieren por canal autorizado, verifica origen, versión
  y checksums. No subas `output/`, inventarios, estados IaC, planes, Vault ni
  su contraseña. No borres el estado de un tenant activo para liberar espacio.

## Avance y pendientes por integrante

Las guías de [docs/agentes](docs/agentes/) y los requisitos de [docs](docs/) son la referencia del equipo. Las pruebas locales no sustituyen evidencia AWS. Resumen al 15 de noviembre de 2026; el detalle está en el [informe final](docs/PROYECTO%20FINAL%20DOCUMENTO%20FINAL.md).

| Integrante | Realizado / pendiente |
| --- | --- |
| [1 — imágenes y catálogo](docs/agentes/01-imagenes-catalogo.md) | Catálogo 1.2.0, cloud-init y tres AMIs verificadas. Mantener el registro y comprobar que las AMIs sigan disponibles. |
| [2 — motor principal](docs/agentes/02-motor-principal.md) | Terraform verificado en AWS desde el panel. OpenTofu desbloqueado en el panel, probado solo con simulación. |
| [3 — segundo motor y seguridad](docs/agentes/03-motor-seguridad.md) | CloudFormation verificado en AWS (crear, suspender, reanudar, eliminar) y 3 escáneres pre-deploy. Pulumi añadido y probado sin desplegar. |
| [4 — Ansible y asistencia](docs/agentes/04-configuracion-asistencia.md) | Configuración, HTTPS y reanudación con IP nueva verificadas; el rol reemite el certificado si la IP cambia. **Pendiente: prueba de aislamiento entre dos tenants.** |
| [5 — orquestación](docs/agentes/05-orquestacion.md) | *Baja del equipo; trabajo completado.* Ciclo de vida, auditoría, login, respaldo/restauración y visor de logs. Falta probar respaldo/restauración en AWS real. Guion: [`docs/guion/05-integrante-5.md`](docs/guion/05-integrante-5.md). |
| [6 — observabilidad y entrega](docs/agentes/06-observabilidad.md) | *Baja del equipo; trabajo completado.* Grafana, alertas, logs, arquitectura y documentación. Falta una alerta real (apagar un servicio) como evidencia. Guion: [`docs/guion/06-integrante-6.md`](docs/guion/06-integrante-6.md). |

Pruebas pendientes de ejecutar en AWS (las hacen otros integrantes): respaldo y restauración, aislamiento entre dos tenants y una alerta real.

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
  frontend/                 Angular 20: panel (planes, crear tenant, tenants, monitoreo, logs, auditoría)
  backend/                  NestJS 11: API, entidades TypeORM, migraciones, ciclo de vida, auditoría, logs
packages/contracts/         Tipos compartidos entre frontend y backend (versionados)
config/
  plans.json                Fuente versionada del catálogo (3 planes)
  golden-images.json        Registro de las AMIs reales verificadas
infrastructure/
  packer/ cloud-init/       Imágenes por rol y primer arranque, sin secretos
  cloudformation/           Motor CloudFormation
  terraform/                Motor Terraform (OpenTofu lo reutiliza)
  pulumi/                   Motor Pulumi
  ansible/                  Roles database, backend y frontend
  observability/            Prometheus, Grafana, Blackbox, tableros y alertas como código
scripts/                    Workers: crear, ciclo de vida, escáneres, log en vivo, Packer/AWS, catálogo
docs/                       Informe final, catálogo, instrucciones del tenant, guías por agente y guiones del video
tests/                      Pruebas de API, de infraestructura y de los workers
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
- El panel tiene un administrador único y está pensado para ejecutarse **en el equipo local** (la API escucha solo en loopback). No exponerlo a Internet.
- Grafana y Prometheus corren en el equipo del operador y llegan a los tenants por túneles SSH; no hay monitoreo si ese equipo está apagado.
- Los logs de texto se leen en la página *Logs* del panel; Grafana muestra métricas (no se integró Loki).

## Documentación

- [Responsabilidades y contratos](docs/INTEGRACION.md) · [Plan de integración](docs/PLAN-INTEGRACION.md)
- [Catálogo de planes — Entregable 4](docs/CATALOGO-PLANES.md)
- [Construir y registrar imágenes](infrastructure/packer/README.md)
- [Observabilidad: Prometheus, Grafana, alertas y logs](infrastructure/observability/README.md)
- [Informe final](docs/PROYECTO%20FINAL%20DOCUMENTO%20FINAL.md) · [Cómo operar un tenant](docs/INSTRUCCIONES-TENANT.md) · [Guiones del video](docs/guion/README.md)
- [Adaptación de la plantilla del docente](docs/REFERENCIA-PLANTILLA.md)
