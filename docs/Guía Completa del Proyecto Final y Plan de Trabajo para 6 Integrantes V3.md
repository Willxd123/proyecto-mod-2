# Guía Completa del Proyecto Final y Plan de Trabajo para 6 Integrantes V3

## Página 1

SEGUNDO MÓDULO — INFRAESTRUCTURA COMO CÓDIGO Y AUTOMATIZACIÓN CLOUD
Requisitos del Proyecto Final (Anotados con la
Explicación del Docente) y División Secuencial
para 6 Integrantes
Documento base consolidado con las correcciones, alcances, puntos descartados ("tachados") y
recomendaciones explicadas en la clase grabada.
Regla de Oro del Docente para la Calificación Individual (Minuto 2:09:40 – 2:11:20): En el video de
defensa (máximo 15 minutos), cada uno de los 6 integrantes debe demostrar y explicar qué parte de
Infraestructura como Código y DevOps configuró. El docente advirtió expresamente que ningún
integrante puede limitarse a decir "yo hice la pantalla o interfaz de usuario", ya que el formulario
web se genera rápidamente con IA y lo que tiene valor real en la nota es la aplicación de las
herramientas del módulo (Packer, Terraform, OpenTofu, Pulumi, CloudFormation, cloud-init, Ansible,
Escáner de Seguridad y Grafana).
PARTE I: Documento Oficial de Requisitos con Notas del Docente
1. Descripción
Construir una plataforma para crear y administrar tenants de una aplicación de registro de asistencia.
Cada tenant representa una institución educativa con sus propios usuarios, cursos, estudiantes y
asistencia. La plataforma debe permitir elegir un plan, aprovisionar y desplegar los recursos
necesarios, administrar el ciclo de vida del tenant y consultar su estado operativo.
Supuesto recomendado: usar AWS como nube principal para el proyecto, ya que CloudFormation
es específico de AWS. Terraform, OpenTofu y Pulumi también pueden aprovisionar recursos en
AWS.
Nota del Docente — Corrección sobre "Notas" vs. "Asistencia" (Min. 1:46:20 y 2:04:55): En
la imagen del mockup dice "entorno de registro de notas" porque en un módulo anterior se usó un
sistema de notas. Para ustedes es estrictamente el sistema de registro de asistencia que ya
vienen desplegando en los prácticos (el que permite subir el Excel de estudiantes y registrar
asistencia). No deben programar un sistema nuevo de notas.
Nota del Docente — Idea de Negocio Multi-Tenant (Min. 1:46:38 – 1:50:38): Imaginen que el
sistema de asistencia que hicieron para la UAGRM (la Gabriel) gustó tanto que ahora quieren
vendérselo a la Unifranz, Cumbre, UPSA, Utepsa, Univalle o al Instituto Domingo Sabio. En vez
de instalar todo a mano cada vez, ustedes tendrán su plataforma de administración (Tenant
Control Center) donde registran la institución, eligen su plan y el sistema les aprovisiona
automáticamente sus 3 servidores aislados (Frontend, Backend y Base de Datos).
Guía del Proyecto Final y Plan de Trabajo para 6 Integrantes — Segundo Módulo Page 1 of 19

## Página 2

Nota del Docente — ¿Dónde corre la plataforma "Tenant Control Center"? (Min. 1:58:59 –
1:59:36): La plataforma web donde se crean los tenants puede correr localmente en la
máquina de ustedes. Desde ese entorno local disparará los comandos para crear las máquinas
de los tenants en la nube (AWS y/o Azure).
Nota del Docente — ¿Se necesita comprar dominios para las URLs de cada tenant? (Min.
2:14:00 – 2:14:38): No. No necesitan comprar dominios ni configurar DNS de pago. Basta con
que cada tenant aprovisionado tenga su propia dirección IP pública diferente (por ejemplo, el
Tenant 1 sale con la IP 54.152.x.x y el Tenant 2 con la IP 18.198.x.x). Esa IP pública es la
URL del tenant.
Nota del Docente — Pruebas mínimas en la Demo (Min. 1:56:06 – 1:57:45): Para la
demostración final deben realizar al menos 2 pruebas de creación de tenants (por ejemplo,
uno con Plan Básico y otro con Plan Estándar), utilizando al menos 2 motores de
infraestructura distintos (por ejemplo, el primero con Terraform y el segundo con OpenTofu,
Pulumi o CloudFormation) e idealmente probando AWS y Azure (o todo en AWS si usan
CloudFormation).
2. Usuarios
Administrador de la plataforma: administra planes, crea y gestiona tenants, consulta
despliegues y métricas.
Administrador del tenant: administra la información de su institución y consulta el estado de sus
servicios.
Nota del Docente (Min. 1:50:15): Es el usuario administrador propio de cada universidad creada (ej.
admin) que ingresa a la aplicación de asistencia de su institución para subir el archivo Excel de estudiantes
y crear los grupos o cursos.
Docente y estudiante: usan las funciones de la aplicación según sus permisos.
Nota del Docente (Min. 1:50:39): Es lo que ya tienen funcionando: el docente puede crear, modificar o
eliminar asistencias, y el estudiante únicamente puede registrar su asistencia.
3. Requisitos Funcionales (Con Indicaciones de Qué Va y Qué se Tacha)
A. Catálogo de planes
[OBLIGATORIO] RF-01: La plataforma debe ofrecer un catálogo de planes, como Básico,
Estándar y Avanzado.
[OBLIGATORIO] RF-02: Cada plan debe definir los recursos asignados, como capacidad de
cómputo, almacenamiento, tamaño de base de datos y límites de uso.
Nota del Docente (Min. 1:53:05 – 1:55:59): Pueden tener hardcodeadas las capacidades de las máquinas
según el plan. Por ejemplo, el Plan Básico aprovisiona una instancia chiquita (t3.micro o B1s) con 10 GB
de disco para un instituto pequeño; el Estándar una instancia intermedia con 50 GB; y el Avanzado una
más grande con 200 GB. Todo debe crearse dentro de su propio Grupo de Recursos / VPC y aislado con
su propio Grupo de Seguridad (Security Group / NSG).
[OBLIGATORIO] RF-03: Al solicitar un tenant, el usuario debe seleccionar un plan y ver sus
características.
Guía del Proyecto Final y Plan de Trabajo para 6 Integrantes — Segundo Módulo Page 2 of 19

## Página 3

[TACHADO / PUNTOS EXTRA] RF-04: El administrador de la plataforma debe poder consultar y
modificar la configuración de los planes.
Nota del Docente (Min. 2:00:54 – 2:01:33): "No se compliquen mucho con eso... lo voy a mandar tachado.
Lo que vean tachado es nota extra, no necesitan hacerlo." Basta con que los planes puedan consultarse en
pantalla.
[TACHADO / PUNTOS EXTRA] RF-05: La plataforma debe impedir que un tenant exceda los
límites establecidos por su plan.
Nota del Docente (Min. 2:01:13 – 2:01:39): Descartado como requisito obligatorio; queda únicamente
como punto extra opcional.
[TACHADO / PUNTOS EXTRA] RF-06: El administrador debe poder cambiar el plan de un tenant
y consultar qué recursos se modificarán.
Nota del Docente (Min. 1:57:49 – 1:58:35 y 2:01:39): Un compañero preguntó si un tenant puede migrar
entre planes (hacer upgrade de Básico a Estándar). El docente aclaró que hacer ese upgrade es opcional
por puntos extra; no es obligatorio para el proyecto.
B. Creación y despliegue
[OBLIGATORIO] RF-07: Permitir crear un tenant con nombre, identificador único, datos de
contacto, entorno y plan.
Nota del Docente (Min. 1:52:44 – 1:53:00): Tal cual se ve en la imagen del mockup: Nombre de la
institución, Identificador del tenant, Correo del administrador, Región de despliegue y Entorno (el docente
indicó que el entorno siempre puede ser Producción).
[OBLIGATORIO] RF-08: Permitir elegir Terraform, OpenTofu, Pulumi o CloudFormation como
motor de aprovisionamiento.
Nota del Docente (Min. 1:56:43 – 1:57:45): En la interfaz pueden aparecer las 4 opciones, y para la
defensa deben tener implementados y funcionando al menos 2 motores (por ejemplo, el Plan Básico con
Terraform y el Plan Estándar con OpenTofu, Pulumi o CloudFormation).
[OBLIGATORIO] RF-09: Crear y configurar los recursos necesarios para ejecutar frontend,
backend y base de datos.
Nota del Docente (Min. 2:51:12 – 2:54:28): Cada tenant debe levantar sus 3 servidores (Frontend,
Backend y Base de Datos). Muy importante: las máquinas virtuales ya no deben crearse usando la
imagen Ubuntu genérica de AWS/Azure, sino usando las Golden Images (AMIs personalizadas) que
ustedes mismos hayan creado previamente con Packer.
[OBLIGATORIO] RF-10: Desplegar la aplicación y configurar su conexión con la base de datos
del tenant.
Nota del Docente (Min. 2:02:22): Es exactamente lo que ya resolvieron en el Práctico 8 usando sus
Playbooks de Ansible e inventario dinámico.
[OBLIGATORIO] RF-11: Mostrar el progreso y el resultado del aprovisionamiento, incluidos
errores comprensibles.
Nota del Docente (Min. 2:02:30 – 2:02:40 y 2:07:29): Consiste simplemente en mostrar en la pantalla los
logs de consola que va arrojando el motor durante la creación. No necesitan programar un sistema
complejo de persistencia de logs.
Guía del Proyecto Final y Plan de Trabajo para 6 Integrantes — Segundo Módulo Page 3 of 19

## Página 4

[TACHADO / PUNTOS EXTRA] RF-12: Permitir reintentar una operación fallida sin duplicar
recursos.
Nota del Docente (Min. 2:02:41 – 2:02:48): "Este igual lo dejamos para el final, es como un feature
avanzado." (Nota técnica: al usar Terraform/OpenTofu y Ansible, volver a correr el comando ya es
idempotente por naturaleza).
[OBLIGATORIO] RF-13: Registrar las versiones de la aplicación, las plantillas y las herramientas
usadas en cada despliegue.
Nota del Docente (Min. 2:02:51): Mostrar qué versión de Terraform/Ansible/Packer y de la plantilla se
utilizó al crear el tenant.
C. Ciclo de vida del tenant (Explicado en vivo por el docente en Min. 2:03:00 – 2:04:54)
En la versión resumida del PDF se saltó la numeración del RF-13 al RF-21, pero el docente mostró
estos puntos en su pantalla y explicó exactamente qué debe incluir la segunda pantalla obligatoria
("Lista de Tenants"):
[OBLIGATORIO] RF-14 (Consultar tenants): Debe existir una vista de Lista de Tenants donde
se puedan buscar/consultar los tenants creados por nombre, ver su estado, plan, motor utilizado y
su URL/IP asignada.
[OBLIGATORIO] RF-15 (Actualizar tenant): Permitir actualizar datos básicos del tenant.
Nota del Docente (Min. 2:03:15 – 2:03:29): "No me refiero a nivel de infraestructura, al menos debería
poder actualizar el nombre de la institución o alguna cosita por ahí en la lista."
[OBLIGATORIO] RF-16 y RF-17 (Suspender y Reanudar un tenant para reducir costos):
Permitir cambiar el estado del tenant a "Suspendido" y luego volver a "Activo".
Nota del Docente (Min. 2:03:48 – 2:04:28): Suspender un tenant es simplemente apagar/detener las
máquinas virtuales (stop instances) en AWS o Azure para reducir costos conservando el disco, y
reanudar es volverlas a encender (start instances).
[OBLIGATORIO] RF-18 (Eliminar un tenant): Botón para dar de baja definitiva al tenant.
Nota del Docente (Min. 2:04:28 – 2:04:40): "Eso ya es chao máquina: no la dejamos apagada, sino que la
eliminamos completamente" (ejecutando terraform destroy / eliminación del stack).
[TACHADO / PUNTOS EXTRA] RF-19 y RF-20: Permitir respaldar y restaurar un tenant, y
auditar quién inició cada operación.
Nota del Docente (Min. 2:04:41 – 2:04:54 y 2:11:34): Descartados como obligatorios; quedan como
puntos extra.
D. Aplicación de registro de Asistencia
[YA RESUELTO] RF-21: Los mismos requerimientos actuales de la aplicación.
Nota del Docente (Min. 2:05:00 – 2:05:24): "Acá no hay mucho que hacer, es lo que ya tienen: registrar la
asistencia, subir el Excel... esta parte ya la tienen lista."
E. Salud, métricas y alertas
Guía del Proyecto Final y Plan de Trabajo para 6 Integrantes — Segundo Módulo Page 4 of 19

## Página 5

[OBLIGATORIO] RF-25: Integrar Grafana para mostrar la salud y el rendimiento de los servicios
de cada tenant.
[OBLIGATORIO] RF-26: Mostrar, como mínimo, disponibilidad, uso de CPU y memoria, latencia,
errores del backend y estado de la base de datos.
Nota del Docente (Min. 2:05:31 – 2:06:25): Además mencionó verificar que no se esté llenando el disco y
ver cuántos requests o errores ingresan a los servidores.
[OBLIGATORIO] RF-27: Permitir consultar las métricas por tenant y por entorno.
[OBLIGATORIO] RF-28 y RF-29: Generar alertas cuando un servicio deje de responder,
aumenten los errores o se alcancen límites de recursos, y mostrar alertas y eventos recientes en
la plataforma junto con su tenant afectado y hora de detección.
Nota del Docente (Min. 2:54:30 – 2:54:45): Pueden hospedar Grafana en una cuarta máquina virtual
dedicada al monitoreo o junto a la plataforma principal, a criterio del equipo.
4. Uso de Tecnologías y Flujo Completo Exigido en la Clase
El equipo debe explicar qué función cumple cada herramienta en su arquitectura. En los minutos
2:29:05 – 2:29:55 y 2:51:12 – 2:53:40, el docente definió el orden exacto en que deben conectarse
las herramientas aprendidas:
1. Packer (Creación de Golden Images): Antes de aprovisionar cualquier tenant, ustedes usan
Packer (archivos .pkr.hcl con comandos packer init, packer fmt, packer validate y
packer build .) para crear sus propias imágenes en AWS (My AMIs) o Azure Images. Deben
tener imágenes preconfiguradas para Frontend (con Nginx y Node.js preinstalados), Backend
(con Node.js/FastAPI y PM2) y Base de Datos (con PostgreSQL preinstalado), de modo que el
despliegue de cada nuevo tenant sea mucho más rápido.
2. Escáner de Seguridad (DevSecOps): Explicado por el docente en el minuto 2:06:58 – 2:07:20:
antes de ejecutar el aprovisionamiento, la plataforma debe correr un escáner sobre los archivos
de configuración para detectar si hay credenciales o secretos expuestos en el código y mostrar
una alerta en pantalla si encuentra alguno.
3. Terraform u OpenTofu (Motor principal) + Pulumi / CloudFormation (Segundo motor):
Aprovisionan la infraestructura de red (VPC, subredes, Security Groups) y las 3 máquinas
virtuales del tenant según el tamaño del Plan elegido (Básico, Estándar o Avanzado), apuntando
al ID de la AMI creada con Packer (ami = "ami-0xxxx") y generando dinámicamente el
archivo inventory.ini con las IPs.
4. cloud-init: Ejecuta la configuración del primer arranque de la máquina virtual (creación de
memoria Swap, zona horaria, llaves SSH e identidad del nodo).
5. Ansible: Se conecta por SSH usando el inventario generado por Terraform/OpenTofu y termina
de configurar los 3 servidores en orden (Base de Datos → Backend → Frontend), inyectando las
variables de entorno y credenciales cifradas (Ansible Vault / AWS Parameter Store), ejecutando
las migraciones de la institución, levantando la aplicación de asistencia e instalando los agentes
de monitoreo.
6. Grafana: Recolecta las métricas operativas de los servidores de cada tenant y muestra los
tableros de salud y alertas.
Guía del Proyecto Final y Plan de Trabajo para 6 Integrantes — Segundo Módulo Page 5 of 19

## Página 6

5. Requisitos No Funcionales y de Arquitectura (Con Aclaraciones del Docente)
[OBLIGATORIO] Mantener aislados los datos de cada tenant: Se cumple creando bases de
datos, redes y grupos de seguridad separados por cada institución (Min. 2:06:46).
[OBLIGATORIO] Proteger secretos y credenciales; no guardarlos en el código ni en los
repositorios: El docente especificó (Min. 2:06:53 – 2:07:20 y 2:07:45) que deben usar variables
de entorno/Ansible Vault y ejecutar un escáner previo al despliegue que alerte en pantalla si
alguien dejó una credencial escrita en el código.
[OBLIGATORIO] Ejecutar los aprovisionamientos como trabajos en segundo plano y
mostrar los logs: No hace falta guardar todo un historial complejo en base de datos; basta con
mostrar el log de ejecución en la interfaz sin exponer contraseñas (Min. 2:07:22 – 2:07:55).
[OBLIGATORIO] Documentar la arquitectura y manual de uso: El docente aclaró (Min. 2:12:50
– 2:13:58) que la documentación debe redactarse como un manual de usuario sencillo y claro
pensado para un cliente no técnico (como un administrador o contador de una universidad),
acompañado del diagrama técnico de arquitectura.
[TACHADO / OPCIONAL] Políticas avanzadas de control automático de costos: El docente indicó
(Min. 2:07:56 – 2:08:02) que este último punto lo iba a tachar porque ya queda cubierto con los
botones de Suspender (apagar VM) y Eliminar tenant.
6. Resumen de Entregables y Formato de Entrega
Entregable del PDF Estado según
Docente
Cómo entregarlo exactamente (Min. 2:08:02 –
2:16:15 y 2:57:36)
1. Código fuente Frontend
y Backend
Obligatorio Enlace al repositorio de GitHub con la plataforma
Tenant Control Center y la aplicación de asistencia.
2. Código de
infraestructura y
configuración
Obligatorio (Peso
principal de la nota)
Carpetas en el repositorio con los scripts de Packer,
Terraform/OpenTofu, Pulumi/CloudFormation,
cloud-init, Ansible y el Escáner de Seguridad.
3. Diagrama de
arquitectura y flujo
Obligatorio Incluido en el documento de entrega mostrando el
flujo: UI Local → Escáner → Packer AMI → Motor IaC
→ cloud-init → Ansible → Grafana.
4. Catálogo de planes y
límites
Obligatorio Tabla documentada en el informe especificando qué
CPU, RAM, disco y límite de estudiantes asigna cada
plan (Básico, Estándar y Avanzado).
5. Tablero de Grafana Obligatorio URL del tablero de Grafana y capturas/demostración
en el video viendo CPU, RAM, disco, latencia y alertas
por tenant.
6. Instrucciones de ciclo
de vida
En el video + Manual
simple
El docente indicó (Min. 2:09:19) que las pruebas de
crear, actualizar, suspender y eliminar pueden
mostrarse directamente en el video, acompañadas de
una guía sencilla para usuario no técnico.
Guía del Proyecto Final y Plan de Trabajo para 6 Integrantes — Segundo Módulo Page 6 of 19

## Página 7

Entregable del PDF Estado según
Docente
Cómo entregarlo exactamente (Min. 2:08:02 –
2:16:15 y 2:57:36)
7. Evidencia de aislamiento Obligatorio Mostrar que las bases de datos e IPs del Tenant 1 y
Tenant 2 están separadas y que los estudiantes
cargados en el Tenant 1 no aparecen en el Tenant 2.
8. Video demostrativo
(Máx. 15 min)
Obligatorio (Subido a
Google Drive)
Solo el líder del equipo (Team Lead) sube el
documento final con los nombres de los 6 integrantes
y el link de Google Drive del video. Pausar la
grabación durante las esperas largas de
aprovisionamiento para no exceder los 15 minutos.
PARTE II: Arquitectura Real del Proyecto y División Equilibrada para 6
Integrantes
1. Aclaración Técnica: Aplicación Web Full-Stack + Orquestación Cloud Multi-Tenant
La plantilla HTML entregada sirve únicamente como maqueta visual de referencia. El proyecto real
que construirá el equipo consta de dos capas conectadas entre sí (utilizando el lenguaje y
framework que el grupo decida, por ejemplo: React/Vue/Next.js/Angular en el Frontend;
Node.js/NestJS/Express, Python/FastAPI/Django o Go en el Backend; y PostgreSQL/MySQL/SQLite
como Base de Datos Central):
Capa 1 — La Aplicación Web Administradora ("Tenant Control Center" corriendo en Local):
Posee un Frontend interactivo (basado en la plantilla), un Backend API + Ejecutor de Trabajos
en Segundo Plano (que dispara comandos CLI/SDK de infraestructura y transmite logs en vivo
por WebSockets/SSE) y una Base de Datos Central del Control Center donde se guardan el
catálogo de planes, el registro de Golden Images de Packer, los tenants creados, sus IPs, el
historial de escaneos/despliegues y las alertas operativas.
Capa 2 — La Infraestructura Cloud Aprovisionada por Tenant (en AWS y/o Azure): Cada vez
que se crea un tenant desde la aplicación web, el Backend ejecuta la cadena de herramientas del
módulo (Escáner DevSecOps → Packer Golden AMIs → Terraform / OpenTofu / Pulumi /
CloudFormation → cloud-init → Ansible + Vault → Prometheus/Grafana) para levantar en la
nube 3 máquinas virtuales aisladas (Servidor Frontend, Servidor Backend y Servidor Base de
Datos) con la Aplicación de Registro de Asistencia lista para esa institución.
2. Matriz de Equilibrio de Carga, Dificultad y Tiempo (6 Integrantes)
Para garantizar que los 6 integrantes tengan exactamente la misma carga de trabajo, dificultad
técnica y tiempo estimado (~18 a 20 horas por integrante) y que todos cumplan la regla del
docente (Min. 2:09:40: "nadie puede decir que solo hizo la pantalla web, todos deben defender
herramientas del módulo"), quienes tienen una carga más pesada compilando imágenes o
aprovisionando infraestructura multi-nube hacen una parte puntual del Backend/BD, mientras que
quienes desarrollan más vistas y lógica en la Aplicación Web lo equilibran con la automatización del
ciclo de vida, seguridad u observabilidad:
Guía del Proyecto Final y Plan de Trabajo para 6 Integrantes — Segundo Módulo Page 7 of 19

## Página 8

Integrante
y Orden
Herramientas Cloud /
DevOps que Defiende
(Peso en Nota)
Responsabilidad en la
Aplicación Web (Front +
Back + BD Central)
Dependencia
Secuencial
Carga y
Dificultad
Integrante
1
(Eslabón
1)
Packer (3 Golden AMIs
en AWS / Azure) +
cloud-init (Swap, SSH,
init)
BD Central + Backend:
Tablas plans y
golden_images, seed inicial
y endpoints GET
/api/plans y GET
/api/images.
Inicia la
cadena.
Entrega AMIs y
cloud-init a
los Int. 2 y 3.
80% Cloud/IaC
20% Web
Back/BD
Alta (~19 h)
Integrante
2
(Eslabón
2)
Terraform / OpenTofu
(VPC, Security Groups,
3 EC2 por Plan, estado
y hosts.ini)
Front + Back + BD: Tabla
tenants, vista Paso 1
(Crear Tenant y Planes),
resumen reactivo y POST
/api/tenants/prepare.
Recibe: AMIs
del Int. 1.
Entrega:
Módulo
Terraform y
hosts.ini al
Int. 4 y 5.
65% Cloud/IaC
35% Web Full-
Stack
Alta (~19 h)
Integrante
3
(Eslabón
3)
Pulumi /
CloudFormation (2do
Motor IaC) + Escáner
DevSecOps (tfsec /
secretos)
Front + Back + BD: Tabla
security_scans, endpoint
POST
/api/security/scan, vista
Paso 2 y vista Escáner &
Auditoría.
Recibe: AMIs
(Int. 1) y red
(Int. 2).
Entrega: 2do
motor y escáner
al Int. 4 y 5.
65%
Cloud/DevSecOps
35% Web Full-
Stack
Alta (~19 h)
Integrante
4
(Eslabón
4)
Ansible + Ansible
Vault (Roles BD, Back,
Front, túnel SSH
privado e inventario)
App Asistencia Multi-
Tenant: Parametrización
dinámica de marca/BD por
institución, creación del admin
y pruebas de aislamiento.
Recibe:
hosts.ini
(Int. 2 y 3).
Entrega:
Playbook
maestro
site.yml al
Int. 5.
65%
Ansible/Cloud
35% App Multi-
Tenant
Alta (~19 h)
Integrante
5
(Eslabón
5)
Automatización Cloud
CLI/SDK (Stop VMs,
Start VMs + cambio de
IP, Destroy stack)
Front + Back + BD: Worker
asíncrono, streaming de logs
en vivo (Paso 3) y vista
completa Lista de Tenants
(CRUD + Ciclo de Vida).
Recibe:
Comandos de
Int. 1 al 4.
Entrega:
Tenants
desplegados y
activos al Int. 6.
50% Cloud
CLI/SDK
50% Web Full-
Stack
Alta (~20 h)
Integrante
6
(Eslabón 6
/ Team
Lead)
Grafana +
Prometheus
(Node/Postgres
Exporter, Dashboard y
Alertas por Tenant)
Front + Back + BD + Doc:
Tabla alerts, receptor
Webhook de Grafana, vista
Monitoreo, Manual de
Usuario y Video final.
Recibe:
Tenants activos
(Int. 5).
Cierra:
Monitoreo,
alertas y
entrega final.
60%
Observabilidad
40% Web +
Manual
Alta (~20 h)
Guía del Proyecto Final y Plan de Trabajo para 6 Integrantes — Segundo Módulo Page 8 of 19

## Página 9

INTEGRANTE 1: Especialista en Golden Images (Packer), Arranque Inicial (cloud-
init) y Catálogo Base en el Backend
Justificación de equilibrio: Este integrante tiene menos carga en pantallas del Frontend porque
asume el trabajo pesado de construir, depurar y compilar las 3 Golden Images en AWS (y/o Azure)
con Packer —proceso que requiere levantar máquinas modelo, aprovisionar dependencias pesadas
y generar snapshots—, complementándolo con el diseño inicial de la Base de Datos Central y los
endpoints del catálogo.
1. Trabajo en Plataformas Cloud y Herramientas del Módulo (Packer + AWS/Azure + cloud-
init):
1. Crear en el repositorio la carpeta infrastructure/packer/ con 3 plantillas en lenguaje
HCL:
frontend.pkr.hcl: Usa el plugin amazon-ebs (y/o azure-arm) sobre Ubuntu Server
22.04 LTS e instala mediante provisioner shell: Nginx, Node.js LTS, gestor de paquetes
(npm/pnpm), utilidades de red y el agente node_exporter preconfigurado como servicio
systemd.
backend.pkr.hcl: Instala el entorno de ejecución del backend del sistema de asistencia
(Node.js o Python/FastAPI según lo que el grupo usó en los prácticos), PM2/Gunicorn, Git,
cliente de PostgreSQL, xz-utils y node_exporter.
database.pkr.hcl: Instala PostgreSQL Server 15+, herramientas de respaldo, cliente
OpenSSL y el exportador de métricas postgres_exporter.
2. Ejecutar y documentar los 4 comandos enseñados por el docente en clase (Min. 2:42:30 –
2:44:00): packer init ., packer fmt ., packer validate . y packer build .
hasta verificar que las 3 imágenes aparezcan en la consola de AWS EC2 → AMIs (My AMIs).
3. Programar en infrastructure/cloud-init/ los scripts de primer arranque (user-data-
frontend.yaml, user-data-backend.yaml, user-data-db.yaml) encargados de:
crear el archivo de memoria Swap de 2 GB (para evitar que las instancias pequeñas colapsen
por falta de RAM), configurar la zona horaria (America/La_Paz), asignar el hostname con el
identificador del tenant e inyectar las llaves públicas SSH.
2. Trabajo en la Aplicación Web "Tenant Control Center" (Base de Datos y Backend API):
1. Inicializar el proyecto Backend y la conexión a la Base de Datos Central del Control Center,
creando las migraciones de dos tablas fundamentales:
Tabla catalog_plans: almacena los 3 planes obligatorios (Básico, Estándar y
Avanzado) con sus columnas instance_type, vcpu, ram_gb, db_storage_gb,
max_students y backup_policy (cumpliendo RF-01 y RF-02).
Tabla golden_images: almacena el rol (frontend, backend, database), proveedor
cloud (AWS / Azure), región, el ami_id real generado por Packer, la versión de Packer
utilizada y la fecha de creación (insumo para RF-13).
Guía del Proyecto Final y Plan de Trabajo para 6 Integrantes — Segundo Módulo Page 9 of 19

## Página 10

2. Programar el script de seed (poblado inicial de datos) y construir los endpoints REST GET
/api/plans y GET /api/golden-images, además de integrar la vista "Planes y Golden
AMIs" en el Frontend para que consulte directamente estos endpoints en lugar de mostrar
texto estático.
3. Secuencia de Trabajo (Qué adelanta, qué recibe y qué entrega):
Desde el Día 1: Es quien arranca la cadena. El mismo primer día define la estructura de la
Base de Datos Central junto al equipo y lanza los packer build en AWS.
Qué entrega a los Integrantes 2 y 3: Los IDs reales de las 3 AMIs (ami-0xxxx), los archivos
cloud-init probados y los endpoints de planes/imágenes funcionando en el Backend.
4. Qué defiende en el Video Final (~2.5 min): Muestra las plantillas .pkr.hcl, la ejecución de
packer validate y packer build, enseña las 3 Golden Images creadas dentro de AWS
EC2 → My AMIs, explica el rol de cloud-init en el primer arranque y muestra la vista de
Planes y Golden AMIs cargando desde la base de datos de la aplicación web.
INTEGRANTE 2: Arquitecto del Motor Principal IaC (Terraform / OpenTofu) +
Desarrollo Web del Paso 1 (Creación de Tenant)
Justificación de equilibrio: Combina el desarrollo completo del motor principal de infraestructura
en Terraform y OpenTofu (redes aisladas, grupos de seguridad, dimensionamiento dinámico por
plan e inventario automático) con la programación Full-Stack del Paso 1 de la aplicación web
(formulario de creación, validaciones y resumen reactivo).
1. Trabajo en Plataformas Cloud y Herramientas del Módulo (Terraform + OpenTofu + AWS
EC2/VPC):
1. Crear en infrastructure/terraform/ y infrastructure/opentofu/ los módulos
parametrizados de aprovisionamiento por tenant:
variables.tf: Recibe como variables de entrada tenant_id, tenant_name,
plan_type (basico, estandar, avanzado), region y los 3 AMI IDs creados con
Packer por el Integrante 1.
network_security.tf: Crea una VPC o subredes aisladas para el tenant y 3 Security
Groups estrictos: el SG del Frontend abre HTTP (80) y SSH (22); el SG del Backend solo
permite tráfico en el puerto de la API desde el SG del Frontend y SSH desde el Frontend
(bastión); y el SG de la Base de Datos solo permite el puerto 5432 desde el SG del
Backend, sin acceso directo desde internet (tal como destacaron los grupos en clase, Min.
51:50 y 1:30:55).
instances.tf: Mapea automáticamente el plan elegido al tamaño de máquina y disco
EBS (Plan Básico → t3.micro y 10 GB; Plan Estándar → t3.small y 50 GB; Plan
Avanzado → t3.medium y 200 GB), inyecta el script cloud-init del Integrante 1 en el
atributo user_data y levanta las 3 instancias usando las Golden Images de Packer.
Guía del Proyecto Final y Plan de Trabajo para 6 Integrantes — Segundo Módulo Page 10 of 19

## Página 11

2. inventory_generator.tf: Utiliza el recurso local_file y una plantilla
inventory.tftpl para generar automáticamente al terminar el apply el archivo
inventories/<tenant_id>/hosts.ini con las IPs públicas y privadas, las rutas de
las llaves SSH y el parámetro ansible_ssh_common_args='-o ProxyCommand="ssh
-W %h:%p -q ubuntu@<IP_FRONTEND>"' para que Ansible pueda entrar a la subred
privada.
3. Configurar el aislamiento del estado (terraform workspace new <tenant_id> o clave
por tenant en un bucket S3) y documentar cómo se almacena y protege el archivo .tfstate
(requisito no funcional obligatorio).
2. Trabajo en la Aplicación Web "Tenant Control Center" (Frontend Paso 1 + Backend +
BD):
1. Crear en la Base de Datos Central la tabla principal tenants con los campos: id (UUID),
institution_name, tenant_slug (único), admin_email, region, environment (por
defecto Producción), plan_id (FK a catalog_plans), iac_engine (Terraform,
OpenTofu, Pulumi, CloudFormation), status (PROVISIONING, ACTIVE, SUSPENDED,
ERROR), frontend_public_ip, backend_private_ip, db_private_ip y created_at.
2. Migrar de la plantilla HTML al framework Frontend elegido toda la pantalla de "Crear tenant —
Paso 1: Datos de la institución, Selección de Plan, Motor de Infraestructura y Resumen
del Tenant" (cumpliendo RF-03, RF-07 y RF-08), conectándola con GET /api/plans para
pintar las tarjetas de Básico, Estándar y Avanzado y actualizando en tiempo real la columna
derecha de resumen.
3. Programar en el Backend los endpoints POST /api/tenants/validate (que comprueba
que el identificador del tenant no esté repetido y valida el formato de correo/slug) y el
generador del archivo tfvars específico para ese tenant.
3. Secuencia de Trabajo (Qué adelanta, qué recibe y qué entrega):
Desde el Día 1 (Sin esperar al Integrante 1): Programa la pantalla web del Paso 1, la tabla
tenants y todo el código de red/instancias de Terraform/OpenTofu usando una AMI de
Ubuntu estándar en una variable temporal. Cuando el Integrante 1 termina sus Golden
Images, solo actualiza los 3 AMI IDs en las variables.
Qué entrega a los Integrantes 3, 4 y 5: El diseño de red y Security Groups, el formato
estándar del archivo inventories/<tenant_id>/hosts.ini y el formulario del Paso 1
guardando el borrador del tenant en la base de datos.
4. Qué defiende en el Video Final (~2.5 min): Muestra en la aplicación web la selección de
planes y motores (Paso 1), enseña el código de Terraform y OpenTofu destacando cómo
consume las Golden Images de Packer del Integrante 1, cómo cambia la capacidad según el plan
y cómo genera dinámicamente el archivo hosts.ini con el puente SSH hacia la subred privada.
INTEGRANTE 3: Especialista en Segundo Motor IaC (Pulumi / CloudFormation) y
Escáner DevSecOps + Desarrollo Web del Paso 2
Guía del Proyecto Final y Plan de Trabajo para 6 Integrantes — Segundo Módulo Page 11 of 19

## Página 12

Justificación de equilibrio: El docente pidió demostrar en la defensa al menos 2 motores de
infraestructura distintos (Min. 1:56:43 – 1:57:45) y ejecutar un escáner de seguridad antes de
aprovisionar que alerte en pantalla si existen credenciales expuestas (Min. 2:06:58 – 2:07:20). Este
integrante construye el segundo motor IaC, el módulo DevSecOps y toda la interfaz y API de
validación de seguridad (Paso 2 y vista de Auditoría).
1. Trabajo en Plataformas Cloud y Herramientas del Módulo (Pulumi / CloudFormation +
Escáner de Seguridad):
1. Implementar en infrastructure/pulumi/ (usando TypeScript o Python) o en
infrastructure/cloudformation/template.yaml el segundo motor de
aprovisionamiento (RF-08):
Debe aceptar exactamente los mismos parámetros que el motor del Integrante 2
(tenant_id, plan_type, y los 3 AMI IDs de Packer del Integrante 1).
Debe crear los 3 servidores (Frontend, Backend y Base de Datos) con sus grupos de
seguridad aislados y un script post-ejecución que escriba el archivo
inventories/<tenant_id>/hosts.ini con idéntica estructura que Terraform,
garantizando que el Playbook de Ansible del Integrante 4 funcione de manera transparente
con cualquiera de los motores.
2. Construir en infrastructure/security-scanner/ el Escáner de Seguridad Pre-
Despliegue (DevSecOps):
Integrar una herramienta de análisis estático de IaC (como tfsec, checkov o trivy
config) junto con un analizador de expresiones regulares / gitleaks que inspeccione los
archivos .tf, .yaml, .pkr.hcl y variables antes de ejecutar cualquier despliegue en la
nube.
Verificar dos reglas críticas: (a) que no existan llaves AKIA...,
aws_secret_access_key, tokens ni contraseñas en texto plano en el código, y (b) que el
puerto 5432 de la base de datos no esté abierto a 0.0.0.0/0.
2. Trabajo en la Aplicación Web "Tenant Control Center" (Frontend Paso 2 y Vista Escáner
+ Backend + BD):
1. Crear en la Base de Datos Central la tabla security_audits (con columnas id,
tenant_id, iac_engine, scan_status [PASSED / BLOCKED], findings_json,
tool_versions_json y scanned_at) para cumplir con el requisito de proteger secretos y
con RF-13 (registro de versiones de plantillas y herramientas).
2. Programar en el Backend los endpoints:
POST /api/security/scan: Ejecuta el escáner sobre la carpeta de infraestructura
seleccionada, enmascara cualquier cadena sensible con asteriscos (cumpliendo el requisito
no funcional "Mostrar los errores sin exponer secretos") y devuelve el diagnóstico en JSON.
POST /api/security/simulate-leak: Crea temporalmente un archivo de prueba con
una credencial falsa para poder demostrar en vivo durante el video cómo el escáner
bloquea el despliegue y lanza la alerta en la interfaz, eliminándolo luego de la prueba.
Guía del Proyecto Final y Plan de Trabajo para 6 Integrantes — Segundo Módulo Page 12 of 19

## Página 13

3. Desarrollar en el Frontend elegido el Paso 2 del asistente de creación ("Configuración de
Golden Images y Escáner Pre-Deploy") y la pantalla completa de "Escáner & Logs IaC" del
menú lateral.
3. Secuencia de Trabajo (Qué adelanta, qué recibe y qué entrega):
Desde el Día 1: Desarrolla el script del Escáner de Seguridad, el endpoint
/api/security/scan, la vista del Paso 2 en el Frontend y la estructura base de
Pulumi/CloudFormation.
Qué recibe del Integrante 1 y 2: Los AMI IDs de Packer y las reglas de Security Groups para
dejar el segundo motor 100% alineado.
Qué entrega al Integrante 4 y 5: El comando del segundo motor generando el hosts.ini y
el validador de seguridad que el Orquestador (Integrante 5) llamará como primer paso
obligatorio antes de aprovisionar.
4. Qué defiende en el Video Final (~2.5 min): Muestra en la interfaz web cómo funciona el
Escáner de Seguridad en el Paso 2 (haciendo primero una prueba donde detecta una credencial
expuesta y bloquea el avance en pantalla, y luego el escaneo limpio), y demuestra el
aprovisionamiento del segundo tenant utilizando el segundo motor (Pulumi o CloudFormation).
INTEGRANTE 4: Especialista en Configuración con Ansible + Vault y Adaptación
Multi-Tenant de la App de Asistencia
Justificación de equilibrio: Mientras los demás miembros construyen el Tenant Control Center,
este integrante es dueño de toda la capa de configuración automatizada con Ansible y Ansible
Vault sobre los 3 servidores en la nube y, a nivel de desarrollo web, se encarga de adaptar el
Frontend y Backend de la Aplicación de Registro de Asistencia para que sea verdaderamente
multi-tenant (personalizada por institución y con aislamiento verificable de base de datos).
1. Trabajo en Plataformas Cloud y Herramientas del Módulo (Ansible + Roles + Ansible
Vault + Túnel SSH):
1. Estructurar en infrastructure/ansible/ la configuración profesional por roles e
idempotente (como se vio en las defensas del Práctico 8, Min. 50:36 y 1:03:20):
ansible.cfg y Playbook maestro site.yml: Configura host_key_checking =
False, control de reintentos SSH y la ejecución ordenada en 3 fases: primero el grupo
[database], segundo el grupo [backend] y tercero el grupo [frontend].
Rol 1 (roles/database): Se conecta a la máquina privada de Base de Datos a través del
túnel SSH del Frontend, levanta el servicio PostgreSQL (que ya viene instalado en la
Golden Image del Integrante 1, ahorrando varios minutos), crea la base de datos exclusiva
del tenant (db_<tenant_slug>), el usuario con contraseña cifrada y ajusta
pg_hba.conf y postgresql.conf para escuchar únicamente desde la subred privada
del tenant.
Guía del Proyecto Final y Plan de Trabajo para 6 Integrantes — Segundo Módulo Page 13 of 19

## Página 14

2. Rol 2 (roles/backend): Empaqueta y transfiere el código del Backend de asistencia
(comprimiendo sin node_modules ni .venv como recomendó el primer grupo en el minuto
34:16 para acelerar el envío por SSH), renderiza la plantilla Jinja2 .env.j2 inyectando la
IP privada de la base de datos, el nombre de la institución y el límite de estudiantes según
el plan, ejecuta las migraciones SQL, crea el usuario Administrador del Tenant y levanta el
servicio con PM2 o systemd.
Rol 3 (roles/frontend): Renderiza la configuración del Frontend de asistencia
apuntando a la IP del Backend, despliega los archivos compilados en
/var/www/attendance, configura el bloque de servidor en Nginx (incluyendo proxy
reverso si aplica) y reinicia Nginx.
3. Implementar Ansible Vault (archivo cifrado group_vars/all/vault.yml o integración con
AWS Systems Manager Parameter Store) para almacenar las contraseñas maestras de
PostgreSQL y la clave de firma JWT, garantizando que ningún playbook contenga contraseñas
en texto plano.
2. Trabajo en la Aplicación Web (Personalización Multi-Tenant de la App de Asistencia +
Pruebas de Aislamiento):
1. Modificar el Frontend y Backend de la Aplicación de Registro de Asistencia para que lea
desde su archivo .env (inyectado por Ansible) las variables TENANT_NAME, TENANT_SLUG,
TENANT_PLAN y TENANT_ADMIN_EMAIL:
Mostrar dinámicamente en la barra superior de la aplicación de asistencia el nombre de la
institución aprovisionada (por ejemplo: "Portal de Control de Asistencia — Universidad
Unifranz [Plan Estándar]" en el Tenant 1 y "Portal de Control de Asistencia — Instituto San
Marcos [Plan Básico]" en el Tenant 2).
Asegurar que el módulo de importación de Excel de estudiantes, creación de cursos y
registro de asistencia por parte de docentes y estudiantes (RF-21) funcione de inmediato
apenas termina Ansible.
2. Programar un endpoint de diagnóstico o script verificador de aislamiento (verify-
isolation.sh) para el Entregable 7 que consulte las dos instancias desplegadas y
demuestre que los registros creados en la base de datos del Tenant 1 no existen ni son
accesibles desde el Tenant 2.
3. Secuencia de Trabajo (Qué adelanta, qué recibe y qué entrega):
Desde el Día 1: Refactoriza los Playbooks del Práctico 8 en los 3 roles parametrizados, cifra
las variables con Ansible Vault y personaliza la aplicación de asistencia para que muestre el
nombre del tenant dinámico.
Qué recibe de los Integrantes 2 y 3: El archivo autogenerado
inventories/<tenant_id>/hosts.ini con las IPs de las 3 máquinas creadas desde las
Golden Images.
Qué entrega al Integrante 5: El comando único ansible-playbook -i
inventories/<tenant_id>/hosts.ini site.yml --extra-vars ... --vault-
password-file .vault_pass probado de punta a punta.
Guía del Proyecto Final y Plan de Trabajo para 6 Integrantes — Segundo Módulo Page 14 of 19

## Página 15

4. Qué defiende en el Video Final (~2.5 min): Explica la arquitectura de roles en Ansible, el
túnel SSH hacia la subred privada y el cifrado con Ansible Vault; muestra cómo la ejecución es
mucho más rápida gracias a las Golden Images de Packer; y abre en el navegador las IPs
públicas de los 2 tenants creados, iniciando sesión como administrador, subiendo un Excel de
estudiantes en el primero y demostrando que el segundo tenant está completamente aislado.
INTEGRANTE 5: Arquitecto del Orquestador Backend (Jobs en 2do Plano y Logs
en Vivo) + Ciclo de Vida Cloud (Stop/Start/Destroy) y Vista "Lista de Tenants"
Justificación de equilibrio: Es el integrador central del proyecto. Une en un pipeline en segundo
plano el trabajo de los Integrantes 1, 2, 3 y 4, programa la transmisión de logs en vivo hacia el
navegador (RF-11) y desarrolla tanto los scripts Cloud como la pantalla completa para el Ciclo de
Vida del Tenant (Consultar, Actualizar, Suspender/Apagar VMs, Reanudar/Encender VMs y
Eliminar/Destroy) que el docente pidió en los minutos 2:03:00 – 2:04:40.
1. Trabajo en Plataformas Cloud y Herramientas del Módulo (Orquestación CLI/SDK +
Stop/Start/Destroy de VMs):
1. Construir en backend/orchestrator/ los scripts y adaptadores de infraestructura para
administrar el ciclo de vida real de cada tenant en AWS/Azure:
Pipeline de Creación Completa: Ejecuta de forma secuencial y asíncrona: (1) el Escáner
de Seguridad del Integrante 3 → (2) el Motor de IaC seleccionado (Terraform/OpenTofu del
Integrante 2 o Pulumi/CloudFormation del Integrante 3) apuntando a las AMIs de Packer del
Integrante 1 → (3) espera la disponibilidad del puerto SSH y ejecuta el Playbook de Ansible
del Integrante 4 → (4) extrae las IPs finales y actualiza el estado del tenant a ACTIVE.
Suspensión del Tenant para Reducir Costos (RF-16 y RF-17): Obtiene los Instance IDs
de las 3 máquinas virtuales del tenant y ejecuta mediante AWS CLI / SDK (aws ec2
stop-instances --instance-ids ... o az vm deallocate en Azure) el apagado
limpio de los 3 servidores, conservando intactos los volúmenes EBS de la base de datos y
marcando el tenant como SUSPENDED.
Reanudación Inteligente del Tenant (RF-16): Ejecuta aws ec2 start-instances,
espera a que las 3 máquinas estén en estado running, consulta la nueva dirección IP
pública asignada por AWS (resolviendo el problema de cambio de IP dinámica al apagar y
encender instancias que varios grupos mencionaron en la clase, Min. 33:09 y 38:05),
actualiza el archivo hosts.ini y la Base de Datos Central, y ejecuta una tarea rápida de
Ansible para actualizar la IP en Nginx.
Eliminación Definitiva del Tenant (RF-18): Ejecuta terraform destroy -auto-
approve (o eliminación del stack en Pulumi/CloudFormation) destruyendo las 3 máquinas
virtuales, discos y grupos de seguridad para no dejar recursos huérfanos consumiendo
créditos de AWS.
Guía del Proyecto Final y Plan de Trabajo para 6 Integrantes — Segundo Módulo Page 15 of 19

## Página 16

2. Trabajo en la Aplicación Web "Tenant Control Center" (Worker Asíncrono + Paso 3 +
Vista Lista de Tenants):
1. Crear en la Base de Datos Central la tabla deployment_jobs (con campos id, tenant_id,
operation_type [CREATE, UPDATE, SUSPEND, RESUME, DESTROY], status,
logs_output, started_at, finished_at).
2. Programar en el Backend el sistema de ejecución en segundo plano (usando procesos hijos
asíncronos child_process.spawn en Node.js o asyncio.create_subprocess_exec /
BackgroundTasks en Python) y el canal de streaming en tiempo real (WebSockets, Server-
Sent Events o polling cada segundo en GET /api/jobs/:jobId/logs) para mostrar en
pantalla cada línea que arrojan Terraform y Ansible sin bloquear el navegador (cumpliendo RF-
11 y los requisitos no funcionales).
3. Programar los endpoints del Ciclo de Vida: GET /api/tenants (con filtro de búsqueda por
nombre, estado, plan y entorno para RF-14), PATCH /api/tenants/:id (para actualizar el
nombre de la institución o correo de contacto según explicó el docente en el minuto 2:03:20
para RF-15), POST /api/tenants/:id/suspend, POST /api/tenants/:id/resume y
DELETE /api/tenants/:id.
4. Desarrollar en el Frontend elegido el Paso 3 ("Consola de Aprovisionamiento en Segundo
Plano") y toda la vista de "Inicio / Lista de Tenants", incluyendo el cuadro de confirmación
previo a eliminar un tenant que detalla qué máquinas y base de datos se borrarán (RF-18).
3. Secuencia de Trabajo (Qué adelanta, qué recibe y qué entrega):
Desde el Día 1: Construye la vista de Lista de Tenants, el Paso 3 de la consola en vivo, la
tabla deployment_jobs y el motor de ejecución en segundo plano probándolo inicialmente
con un script simulado (sleep + echo) mientras los Integrantes 1 al 4 terminan sus scripts
reales.
Qué recibe de los Integrantes 1 al 4: Los comandos listos de Escáner, Terraform/OpenTofu,
Pulumi/CloudFormation y Ansible para conectarlos en el orquestador.
Qué entrega al Integrante 6: Los tenants creados y activos en la nube junto con un hook que
avisa cuando nace o se elimina un tenant para actualizar el monitoreo.
4. Qué defiende en el Video Final (~2.5 min): Muestra la consola del Paso 3 transmitiendo en
vivo los logs del trabajo en segundo plano mientras se crea un tenant (RF-11 y RF-13), y luego
pasa a la pantalla de Lista de Tenants para demostrar en vivo cómo busca un tenant, le actualiza
el nombre (RF-15), lo suspende (mostrando en la consola de AWS EC2 que las 3 instancias
pasan a Stopped para ahorrar costos), lo reanuda y elimina un tenant de prueba (RF-18).
INTEGRANTE 6: Especialista en Observabilidad y Alertas (Prometheus + Grafana)
+ Vista Web de Monitoreo y Consolidación Final (Team Lead)
Justificación de equilibrio: Diseña e implementa toda la arquitectura de monitoreo y alertas
operativas con Grafana y Prometheus exigida en los requisitos RF-25 al RF-29, programa en la
aplicación web la vista de Monitoreo y el receptor de alertas en tiempo real, y asume la
responsabilidad de Team Lead para consolidar la documentación para usuario no técnico y el video
final del grupo.
Guía del Proyecto Final y Plan de Trabajo para 6 Integrantes — Segundo Módulo Page 16 of 19

## Página 17

1. Trabajo en Plataformas Cloud y Herramientas del Módulo (Grafana + Prometheus +
Exporters + Alertas):
1. Desplegar y configurar el stack de observabilidad con Prometheus y Grafana (en una
máquina virtual dedicada en la nube o mediante contenedores junto a la plataforma, tal como
dio a elegir el docente en el minuto 2:54:30).
2. Configurar en Prometheus el archivo de descubrimiento dinámico de objetivos
(file_sd_configs apuntando a targets/tenants/*.json). Cada vez que el
Orquestador del Integrante 5 termina de aprovisionar un tenant, se registra automáticamente
un archivo JSON con las IPs de los 3 servidores del tenant y las etiquetas tenant="
<tenant_slug>", institution="<nombre>" y env="produccion" (cumpliendo RF-
27).
3. Construir y exportar en formato JSON el Tablero Oficial de Grafana (RF-25 y RF-26,
Entregable 5) con variables desplegables en la parte superior para filtrar por tenant y por
entorno, e incluyendo paneles para:
Disponibilidad en tiempo real (estado UP / DOWN de los servidores Frontend, Backend y
Base de Datos).
Porcentaje de uso de CPU y uso de Memoria RAM + Swap.
Espacio utilizado y disponible en el disco EBS (mencionado por el docente en el minuto
2:05:55: "ver si no se está llenando el disco").
Latencia de respuesta HTTP, cantidad de peticiones por minuto y tasa de errores (4xx/5xx)
del Backend.
Estado de disponibilidad y conexiones activas de la Base de Datos PostgreSQL.
4. Configurar las Reglas de Alerta en Grafana (RF-28) para que se disparen cuando: (a)
cualquiera de los 3 servicios de un tenant deje de responder por más de 30 segundos, (b)
aumenten los errores del backend, o (c) el uso de CPU/Disco supere el 85%. Configurar un
Contact Point de tipo Webhook en Grafana que envíe el payload JSON de cada alerta
disparada hacia el Backend del Tenant Control Center.
2. Trabajo en la Aplicación Web "Tenant Control Center" (Vista de Monitoreo y Alertas +
Documentación Final):
1. Crear en la Base de Datos Central la tabla tenant_alerts (con columnas id,
tenant_slug, severity, alert_title, description, status [FIRING / RESOLVED] y
detected_at).
2. Programar en el Backend los endpoints:
POST /api/monitoring/grafana-webhook: Recibe las alertas en vivo desde Grafana,
las guarda en la tabla tenant_alerts y las publica en la interfaz web junto con el tenant
afectado y la hora exacta de detección (cumpliendo RF-29).
GET /api/monitoring/summary/:tenantSlug: Consulta la API HTTP de
Prometheus/Grafana para devolver los indicadores rápidos de CPU, RAM, disco, latencia y
disponibilidad del tenant seleccionado.
Guía del Proyecto Final y Plan de Trabajo para 6 Integrantes — Segundo Módulo Page 17 of 19

## Página 18

3. Desarrollar en el Frontend elegido toda la vista "Monitoreo (Grafana)" de la barra lateral,
incluyendo el selector de tenant, las 6 tarjetas de estado en vivo, el botón directo para abrir el
Tablero de Grafana completo y el listado de alertas y eventos recientes (RF-29).
4. Consolidación como Team Lead (Min. 2:12:50 – 2:13:58 y 2:57:36):
Elaborar el Diagrama de Arquitectura y Flujo de Creación de un Tenant (Entregable 3)
y la tabla del Catálogo de Planes (Entregable 4).
Redactar el documento de entrega como un Manual de Usuario claro y sin jerga
excesiva pensado para un cliente no técnico (como un contador o administrador de
universidad, según pidió el docente en el minuto 2:13:30).
Unir los segmentos del video demostrativo (cuidando que no supere los 15 minutos,
pausando en los tiempos muertos de compilación como recomendó el docente en el minuto
2:15:28), subirlo a Google Drive con permisos públicos de lectura y enviar el documento
único en la plataforma con los nombres de los 6 integrantes.
3. Secuencia de Trabajo (Qué adelanta, qué recibe y qué entrega):
Desde el Día 1: Levanta el servidor de Prometheus + Grafana, diseña el Dashboard con las
métricas de RF-26, configura las reglas de alerta y programa en la aplicación web la tabla
tenant_alerts, el endpoint Webhook y la vista de Monitoreo.
Qué recibe del Integrante 5: Las IPs de los tenants desplegados para registrarlos
automáticamente en Prometheus y monitorearlos en vivo.
4. Qué defiende en el Video Final (~2.5 min): Muestra la vista de Monitoreo dentro del Tenant
Control Center y abre el Tablero de Grafana en vivo (Entregable 5); cambia en el filtro entre el
Tenant 1 y el Tenant 2 para mostrar su consumo real de CPU, RAM, disco, latencia y estado de
PostgreSQL; y provoca o muestra una alerta en tiempo real (por ejemplo, al apagarse un servicio)
comprobando que aparece registrada con el tenant afectado y la hora de detección tanto en
Grafana como en la plataforma web.
3. Cronograma Secuencial de Trabajo de 5 Días para no Bloquearse entre Integrantes
Fase / Día Trabajo en Infraestructura Cloud y
DevOps
Trabajo en la Aplicación Web (Front +
Back + BD Central)
Día 1
(Base y
Contratos)
Int. 1 compila las 3 Golden AMIs con Packer
en AWS y crea los cloud-init. Int. 2 y 3
escriben las redes de Terraform/OpenTofu y
Pulumi/CloudFormation con variables AMI.
Int. 4 estructura los 3 roles de Ansible y
Ansible Vault.
El equipo acuerda el lenguaje/framework de
la web. Int. 1, 2, 3, 5 y 6 crean las
migraciones de sus respectivas tablas en la
BD Central (plans, golden_images,
tenants, security_audits, jobs,
alerts).
Día 2
(Eslabones 1,
2 y 3)
Int. 1 entrega los 3 AMI IDs reales a los Int. 2
y 3. Ambos prueban el aprovisionamiento de
las 3 VMs por plan y verifican que sus
motores autogeneren el archivo
inventories/<tenant_id>/hosts.ini.
Int. 3 termina el Escáner DevSecOps.
Int. 1 conecta la vista de Planes/AMIs. Int. 2
termina el Paso 1 (Crear Tenant y resumen
reactivo). Int. 3 termina el Paso 2 y la vista
del Escáner de Seguridad.
Guía del Proyecto Final y Plan de Trabajo para 6 Integrantes — Segundo Módulo Page 18 of 19

## Página 19

Fase / Día Trabajo en Infraestructura Cloud y
DevOps
Trabajo en la Aplicación Web (Front +
Back + BD Central)
Día 3
(Eslabones 4 y
5)
Int. 4 toma el hosts.ini generado por los
Int. 2 y 3, ejecuta site.yml a través del
túnel SSH y deja funcionando la App de
Asistencia aislada por tenant. Int. 5 prueba
los scripts de stop-instances, start-
instances y destroy.
Int. 5 conecta en el Worker del Backend el
pipeline completo (Escáner → Motor IaC →
Ansible), habilita el streaming de logs en el
Paso 3 y termina la vista de Lista de Tenants
(Actualizar, Suspender, Reanudar, Eliminar).
Día 4
(Eslabón 6 y
Pruebas)
Int. 6 conecta el servidor Prometheus +
Grafana a los tenants desplegados, verifica
los paneles de CPU, RAM, disco, latencia y
PostgreSQL, y prueba el disparo de alertas
por Webhook.
Int. 6 termina la vista de Monitoreo y Alertas
en la plataforma web. El equipo realiza las 2
pruebas completas de punta a punta (Plan
Básico con Motor 1 y Plan Estándar con
Motor 2) y verifica el aislamiento de datos.
Día 5
(Video y
Entrega)
Revisión final de que no queden secretos en
Git y limpieza de instancias innecesarias tras
grabar para cuidar los créditos de
AWS/Azure.
Int. 6 (Team Lead) compila el Manual de
Usuario para cliente no técnico y el diagrama
de arquitectura; los 6 integrantes graban su
defensa de ~2.5 min cada uno (máx. 15 min
total) y el líder sube el entregable.
Guía del Proyecto Final y Plan de Trabajo para 6 Integrantes — Segundo Módulo Page 19 of 19
