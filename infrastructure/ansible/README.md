# Integrante 4 — Configuración y asistencia

## Avance del integrante 4

Estado al 13 de noviembre de 2026: **parcialmente verificado en AWS**. El
tenant `i4-gary-prueba` es infraestructura real creada con Terraform y se usa
únicamente para pruebas; los módulos, estudiantes y asistencias cargados son
datos sintéticos. No se ha demostrado aislamiento entre dos tenants.

### Implementado y comprobado

| Componente | Evidencia y alcance |
| --- | --- |
| Ansible y Vault | `configure-tenant.yml` ejecuta preflight, database, backend, frontend y exporter; separa variables públicas y secretos. Tras el despliegue más reciente se repitió con `changed=0` en los tres hosts. |
| PostgreSQL y backend | Se configuraron una base y usuario de aplicación en la instancia privada, la conexión autenticada desde el backend, migraciones Django y administrador inicial. |
| Frontend y HTTPS | Angular se despliega con Nginx; se verificaron certificado real para la IP, cadena, acceso HTTPS y renovación simulada. La renovación automática real aún no se ha observado. |
| Identidad | La cabecera y `/api/tenant` mostraron la institución y el plan del request. El plan es informativo, no aplica límites de estudiantes. |
| Asistencia | Por API se probaron acceso, importación de Excel, descarga de credenciales, marcación, cambio de contraseña y reporte. Por navegador se probaron acceso, creación de módulo, importación y asistencia; el cambio de contraseña no se probó visualmente. |
| Recuperación y métricas | Tras reiniciar por separado las tres instancias se recuperaron los servicios, `pg_up 1` y los datos sintéticos. El exporter escucha solo en loopback: no se ha probado recolección remota. |

El módulo sintético de la prueba visual quedó activo y el anterior inactivo;
ambos permanecen para revisión. El panel de tenants no crea ni configura el
tenant automáticamente. La aplicación de asistencia es independiente del
panel y usa Django y Angular; no se requiere reescribirla en NestJS.
El 13 de noviembre de 2026 se detuvieron las tres instancias del tenant de
prueba para reducir costos; los volúmenes y otros recursos pueden seguir
generando cargos. No se ha verificado su reanudación ni una IP pública nueva.

### Pendiente y coordinación

| Pendiente | Necesidad o responsable de coordinación |
| --- | --- |
| Ejecutar el verificador de aislamiento del Entregable 7 y probar acceso cruzado | El verificador de conteos está preparado y probado localmente con datos sintéticos, pero no se ha ejecutado contra dos tenants AWS. El último intento de segundo tenant encontró `VpcLimitExceeded`; acordar cuota o alternativa con el administrador AWS. |
| Validar inventarios de ambos motores | El inventario Terraform del integrante 2 ya se usó; falta probar el inventario real del segundo motor con el integrante 3. |
| Integrar la creación desde el panel y comprobar suspensión/reanudación | Integrante 5: invocar Ansible con inventario, variables y secretos autorizados, comprobar servicios, persistencia y posible cambio de IP/certificado. Reiniciar EC2 no equivale a stop/start. |
| Verificar métricas remotas | Integrante 6: acordar ubicación, transporte privado y reglas restringidas del recolector; comprobar targets y `pg_up`. |
| Acordar interpretación de la guía | El correo `admin_email` crea al administrador, pero no existe la variable literal `TENANT_ADMIN_EMAIL`. La guía menciona un límite de estudiantes y el catálogo actual lo declara informativo: acordar el alcance sin afirmar que se aplica una cuota. |
| Compartir y defender la entrega | Entregar comando, inventario esperado, variables y evidencia al equipo. Las revisiones de asistencia están publicadas en ramas separadas; coordinar su revisión y fusión. Preparar la demostración con dos tenants. |

`preflight.yml` es una comprobación preliminar de **solo lectura**: valida el
inventario, espera SSH y cloud-init, compara el tenant y rol con los archivos
producidos por la imagen y comprueba PostgreSQL localmente. No configura los
servicios ni sustituye la verificación de cuenta, región, autorización y
etiquetas en AWS. No compartir inventarios privados, estados, claves ni secretos
al entregar la evidencia.

El `.gitignore` excluye nombres habituales como `vault.yml` y `vault-prod.yaml`
dentro de Ansible, pero no protege archivos ya rastreados ni nombres arbitrarios.
Mantener los secretos fuera del repositorio y revisar el contenido antes de
preparar o publicar cambios.

## Entrega al integrante 5

El punto de entrada es `configure-tenant.yml` y el comando completo aparece
en la sección [Despliegue completo preparado](#despliegue-completo-preparado).
El orquestador todavía no lo ejecuta. Para integrarlo:

1. Consumir una solicitud autorizada `DeploymentRequest` con `deployable=true`
   y un `ProvisioningResult` del mismo tenant, request, región y motor. Verificar
   cuenta AWS, etiquetas, propiedad y direcciones antes de cualquier cambio;
   el playbook no realiza por sí solo esa verificación AWS.
2. Recibir del motor un inventario privado con un host por grupo `frontend`,
   `backend` y `database`, `tenant_slug` idéntico, acceso SSH al frontend y
   acceso privado al backend y la base mediante el bastión. El inventario debe
   aportar las IPs y `backend_port`; el ejemplo generado por Terraform está en
   `../terraform/modules/tenant/templates/inventory.tftpl`. Aún no se ha
   probado un inventario del motor del integrante 3.
3. Preparar fuera de Git las variables públicas con
   [`tenant-vars.example.yml`](tenant-vars.example.yml): `institution_name`
   proviene de la solicitud, `tenant_plan_name` de `plan_snapshot.name` y
   `admin_email` identifica la cuenta inicial. El rol usa ese correo en
   `seed_admin`; no expone una variable `TENANT_ADMIN_EMAIL` ni publica el
   correo en `/api/tenant`. Coordinar con el equipo si hace falta ese nombre
   literal. `max_students` es informativo según el catálogo, no una cuota
   aplicada por este despliegue.
4. Proporcionar revisiones y artefactos de backend y frontend compatibles,
   junto con el checksum del frontend. La ejecución compara el checksum
   suministrado, pero esto no demuestra por sí solo la procedencia de ninguno
   de los artefactos: verificar y registrar su origen y revisión por separado.
   Las revisiones usadas en la prueba están publicadas en la rama
   `credenciales-iniciales-seguras` de ambos repositorios: backend
   [`0a474740`](https://github.com/GBAC22/control-asistencia-backend/pull/1)
   y frontend
   [`940a98b8`](https://github.com/GBAC22/control-asistencia-frontend/pull/1).
   Revisar el estado de los pull requests antes de integrar sus cambios.
   Para cada versión aprobada, generar los paquetes desde revisiones concretas
   de los repositorios y entregar sus identificadores, las rutas de los
   paquetes y el checksum del frontend al orquestador. No se descarga
   automáticamente la última versión de `main`. El registro durable por
   despliegue de las versiones de aplicación, plantillas y herramientas
   requerido por RF-13 sigue pendiente de integración; declarar un commit
   no demuestra por sí solo la procedencia del paquete.
5. Custodiar fuera del repo el archivo Vault y su contraseña, la clave SSH y
   los secretos específicos de cada tenant. No pasar contraseñas en argumentos,
   eventos, user-data o logs. Proteger los archivos de variables e inventarios.
6. Invocar Ansible con argumentos separados, sin construir comandos con datos
   del navegador, y conservar su código de salida. Cero indica que terminaron
   las comprobaciones del playbook, pero el orquestador debe comprobar HTTPS,
   identidad y estado de los servicios antes de marcar `ACTIVE`. Debe gestionar
   fallos, recuperación y un bloqueo compartido por tenant; no registrar targets
   como activos antes de completar la verificación.

## Comparación de aislamiento entre bases

[`verify-isolation.yml`](verify-isolation.yml) es una comprobación de **solo
lectura**, preparada para dos tenants ya existentes. No crea estudiantes,
infraestructura ni conexiones de red; consulta por socket local dos números de
registro sintéticos parametrizados y exige que cada base contenga exactamente
su propio marcador y ninguno del otro. Verifica además que las identidades
locales indiquen tenants distintos y rol `database`. No imprime los registros,
contraseñas ni el resultado detallado de la consulta.

**Limitación:** este resultado demuestra únicamente presencia y ausencia de
esos marcadores en las bases consultadas. No prueba por sí solo que un usuario
o backend de A no pueda autenticarse o acceder a B, ni sustituye la revisión de
red, rutas, permisos y seguridad de AWS. Esas pruebas de acceso cruzado deben
hacerse por separado con cuentas y recursos de prueba autorizados.

Antes de ejecutar:

- Verificar cuenta, región, propiedad y etiquetas AWS de ambos tenants, y
  preparar un inventario privado con exactamente dos hosts en los grupos
  `isolation_a` e `isolation_b`. Deben ser las instancias de base de datos,
  cada una con su `tenant_slug` y acceso SSH privado por su bastión. No mezclar
  los inventarios completos: contienen otros hosts y el playbook los rechaza.
- Por el flujo de la aplicación, crear previamente un estudiante sintético
  con un número único para cada tenant, con el prefijo `I4-ISO-` seguido de
  8 a 40 letras, números o guiones; no usar datos personales. No borrar ni
  modificar estudiantes existentes. Los marcadores deben ser distintos.
- Conservar el inventario, las claves y los resultados sensibles fuera de Git.
  La conexión SSH y privilegios `become` del operador deben estar autorizados.
  No usar `--limit`, porque el veredicto necesita consultar ambos hosts.

Ejemplo de estructura del inventario privado, con direcciones, bastiones y rutas
reemplazados por el operador y protegidos como los inventarios originales:

```ini
[isolation_a]
db_a ansible_host=<ip_privada_a> tenant_slug=<tenant_a>
[isolation_b]
db_b ansible_host=<ip_privada_b> tenant_slug=<tenant_b>
```

Configurar además `ansible_user`, la ruta local de clave y el
`ansible_ssh_common_args` de cada host para usar su propio bastión, siguiendo el
inventario de su motor. Mantener la comprobación de claves SSH; no imprimir la
clave privada.

```bash
ansible-playbook -i /ruta/privada/inventario-aislamiento.ini \
  infrastructure/ansible/verify-isolation.yml \
  -e isolation_marker_a=I4-ISO-marcadora1 \
  -e isolation_marker_b=I4-ISO-marcadorb2
python3 -B -m unittest discover -s tests -p test_ansible_isolation.py -v
```

La prueba local usa fixtures y SQLite para verificar la lógica de consulta y
el veredicto de Ansible; no es evidencia de ejecución PostgreSQL ni AWS. La
ejecución real con dos tenants y las pruebas de acceso cruzado siguen pendientes.

## Ejecución conjunta de componentes implementados

`configure-core.yml` ejecuta el preflight una vez y después los roles de base
de datos, backend y exporter en ese orden. Consume el inventario generado por
el motor del integrante 2 y los mismos archivos de variables y Vault descritos
en las secciones siguientes. No crea infraestructura ni configura el frontend:
es un paso parcial, no el comando final de despliegue completo.

```bash
ansible-playbook -i /ruta/privada/hosts.ini infrastructure/ansible/configure-core.yml \
  --vault-password-file /ruta/privada/vault-password \
  -e @/ruta/privada/secretos.yml \
  -e @/ruta/privada/backend-vars.json
python3 -B -m unittest discover -s tests -p test_ansible_configure_core.py -v
```

Si falta psycopg2 en la imagen de base de datos, proporcionar también
`postgresql_psycopg_deb` como se indica en la sección PostgreSQL. Antes de
ejecutar, verificar cuenta, región, etiquetas, inventario, artefactos y secretos;
el preflight no verifica por sí solo la propiedad de los recursos AWS. No usar
`--limit`, porque el preflight necesita examinar los tres hosts.

## Despliegue completo preparado

`configure-tenant.yml` añade el frontend al orden database → backend →
frontend y configura el exporter. Antes del frontend comprueba en PostgreSQL
que no haya estudiantes con `password_hash` vacío o nulo; esas cuentas
heredadas permiten usar el número de registro y deben migrarse antes de abrir
la aplicación. Esa comprobación no detecta contraseñas débiles que ya tengan
hash. `frontend.yml` aplica el mismo control cuando se ejecuta por separado.

El frontend requiere Nginx preinstalado y Certbot 5.4 o superior en
`/snap/bin/certbot`. Si Certbot no existe, el rol comprueba Snap e instala
Certbot desde Snap Store; esto requiere salida a Internet y acceso a la tienda.
Si falta Snap o la instalación falla, el despliegue falla explícitamente. Si
Certbot ya existe, no se reinstala; una versión anterior a 5.4 se rechaza y
debe actualizarse mediante un procedimiento autorizado. En el tenant de prueba
ya se instaló Certbot 5.10.0. Necesita además
`frontend_revision` (commit hexadecimal de 40 caracteres), un archivo
`frontend_build_archive` con el contenido compilado de Angular y
`index.html` en la raíz, `frontend_build_sha256`, la IP pública verificada
como `frontend_server_name` y un `certbot_email` válido para avisos de
certificados. El checksum verifica el archivo suministrado, no demuestra por
sí mismo que se compiló desde el commit declarado.

Con el puerto 80 público para HTTP-01 y 443 autorizado para HTTPS, el rol
solicita un certificado de IP de Let's Encrypt de corta duración, prepara un
timer que intenta renovarlo dos veces por día y recarga Nginx tras renovar.
Comprueba localmente la cadena, la IP, la página y el proxy de salud. La
renovación requiere Internet, que el puerto 80 siga accesible y que la IP no
cambie; si la instancia se detiene y recibe otra IP hay que emitir un nuevo
certificado y actualizar la configuración. La IP aparece en registros públicos
de transparencia de certificados. La emisión y un `certbot renew --dry-run`
pasaron en AWS para el tenant de prueba; el timer estaba habilitado y activo.
La renovación automática real todavía no se ha observado y el timer no
sustituye la monitorización de expiración.

```bash
ansible-playbook -i /ruta/privada/hosts.ini infrastructure/ansible/configure-tenant.yml \
  --vault-password-file /ruta/privada/vault-password \
  -e @/ruta/privada/secretos.yml \
  -e @/ruta/privada/tenant-vars.json
python3 -B -m unittest discover -s tests -p test_ansible_frontend.py -v
```

El archivo de variables reúne los valores del backend y frontend indicados en
esta guía. Los secretos siguen solo en Vault. Los artefactos se deben generar
desde revisiones confiables. Antes de ejecutar, revisar el plan de red para el
tenant exacto y verificar la cuenta, región, identidad y etiquetas; el playbook
no abre puertos ni comprueba pertenencia en AWS. No ejecutar con `--limit`.
La emisión puede fallar por conectividad, cuota o validación ACME; revisar los
logs privados de Certbot. Mientras no existe un certificado, la configuración
inicial sirve únicamente el desafío ACME y responde 503 al resto.

La personalización de institución y plan se desplegó y verificó en el tenant
de prueba `i4-gary-prueba`: el endpoint y la cabecera mostraron la institución
y el plan del request, y los registros sintéticos anteriores permanecieron.
Una segunda ejecución del playbook completo terminó con `changed=0` en los
tres hosts.
Se utilizaron las revisiones de asistencia del backend
`0a474740486e2978e09e2c582edff34e3d9876e8` y del frontend
`940a98b8ba8fea570bffd1bfd501e9659e135765`; ambas están publicadas en sus
repositorios remotos. Se requieren versiones
compatibles de backend y frontend de asistencia con el endpoint `/api/tenant`.
Ansible recibe `institution_name` y `tenant_plan_name` desde la solicitud
autorizada (`institution_name` y `plan_snapshot.name` del contrato), además de
`tenant_slug` del inventario. El endpoint público devuelve solo identificador,
nombre y plan; no expone el correo administrativo ni secretos. Tras arrancar el
backend, Ansible comprueba que la respuesta coincide con esos valores; una
versión antigua o una identidad incorrecta hace fallar el despliegue. El plan
mostrado es informativo: no implementa ni promete el cumplimiento de cuotas.

Para preparar la integración, usar `tenant-vars.example.yml` como referencia
de variables no secretas: copiarlo fuera del repositorio y reemplazar todos los
valores de ejemplo. El inventario del integrante 2 aporta las direcciones;
la aplicación recibe el correo y nombre del administrador desde el proceso
autorizado, nunca la contraseña desde el navegador. El administrador del
sistema genera y custodia los secretos en Vault antes de invocar el playbook.
El proceso que lo invoque debe conservar el código de salida: solo un valor cero
indica que Ansible completó sus comprobaciones, y no sustituye la verificación
externa HTTPS ni autoriza al panel a mostrar el tenant como `ACTIVE` antes de
las comprobaciones propias del orquestador. No pasar secretos en argumentos,
contratos, eventos ni logs.

## Rol Django

`backend.yml` ejecuta el preflight y configura Django y Gunicorn en el host
`backend`. Necesita el rol PostgreSQL ya aplicado, un archivo de código
preparado desde la revisión indicada y un archivo de dependencias offline.
El segundo debe contener `requirements.lock` y los paquetes compatibles con
Python y la arquitectura del servidor, incluido Gunicorn. No resuelve
dependencias en Internet. El administrador se crea solo si el correo aún no
existe; volver a ejecutar el rol no cambia su contraseña.

El correo `admin_email` identifica al administrador de la institución. Su
contraseña inicial se suministra en `vault_admin_password` y no se devuelve
en el inventario ni en los eventos. Cada tenant necesita un secreto distinto.
Actualmente Ansible crea la cuenta, pero no entrega sus credenciales en el
panel de tenants: ese panel todavía no tiene autenticación. La opción acordada
para el futuro es una entrega desde el panel únicamente a un operador
autenticado y autorizado; requiere coordinación con el integrante 5 para
almacenamiento, acceso, auditoría y entrega, sin incluir secretos en logs,
eventos, contratos de aprovisionamiento ni metadatos. No habilitar esa entrega
antes de implementar y probar dichos controles.

El inventario debe aportar las IP y puerto verificados del tenant. También se
requieren `backend_revision` (commit hexadecimal de 40 caracteres),
`backend_source_archive`, `backend_wheels_archive`, `frontend_server_name`
(dominio o IPv4),
`admin_name`, `admin_email`, `institution_name` y `tenant_plan_name`. Los
archivos indicados son rutas del controlador.
El Vault debe proporcionar `vault_postgres_password`, `vault_django_secret_key`
y `vault_admin_password`; los dos primeros admiten caracteres alfanuméricos,
guion y guion bajo, y el tercero no debe contener saltos de línea.
Para la nueva versión de asistencia que genera contraseñas de estudiantes,
el Vault también debe proporcionar `vault_student_initial_passwords_key`, una
clave Fernet independiente y estable por tenant. Generarla en privado con
`python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
y conservarla en Vault, sin registrarla ni incluirla en Git. Perderla impide
descifrar credenciales iniciales pendientes. Esta variable prepara el rol
para esa versión; ya se configuró en el tenant de prueba existente.
La contraseña PostgreSQL debe coincidir con la aplicada por `database.yml`.
Por ejemplo, con las variables no secretas en un JSON privado:

```bash
ansible-playbook -i /ruta/privada/hosts.ini infrastructure/ansible/backend.yml \
  --vault-password-file /ruta/privada/vault-password \
  -e @/ruta/privada/secretos.yml \
  -e @/ruta/privada/backend-vars.json
python3 -B -m unittest discover -s tests -p test_ansible_backend.py -v
```

Los artefactos deben proceder de fuentes y dependencias verificadas; el rol no
comprueba que el contenido del archivo coincida con el commit declarado.
El directorio de paquetes es compartido entre revisiones, por lo
que el operador debe evitar reutilizarlo con artefactos incompatibles. La
configuración de secretos queda en un archivo propiedad de root, modo `0600`.
El endpoint de salud se prueba localmente mediante el encabezado HTTPS del
proxy; no valida el certificado ni conectividad pública. No exponer Gunicorn
directamente: Django confía en ese encabezado de protocolo.

## Rol PostgreSQL

`database.yml` ejecuta primero el preflight y después prepara una base
`control_asistencia`, un usuario `asistencia`, la extensión `uuid-ossp` y
una regla PostgreSQL para la IP privada del backend. La contraseña se recibe
como `vault_postgres_password` desde un archivo Ansible Vault. El rol utiliza
`community.postgresql` en el controlador y requiere `psycopg2` para
`/usr/bin/python3` en el servidor de base de datos: las imágenes actuales no
lo incluyen. Si falta, puede instalar un paquete Ubuntu compatible suministrado
por el controlador mediante `postgresql_psycopg_deb`, sin usar NAT. No abre
security groups ni descarga dependencias adicionales.

Antes de ejecutar se debe proporcionar la dependencia por un mecanismo
autorizado, validar el inventario real y la conectividad, y asegurar una
contraseña independiente para el tenant. La dirección del backend solo se
valida por formato y debe comprobarse contra el inventario y los recursos AWS.
La configuración escucha en loopback y en la IP privada declarada para la base
de datos. Requiere que la máquina carezca de IP pública y que el security
group y `pg_hba.conf` mantengan el acceso limitado al backend autorizado.
El uso de `database.yml` no implica que frontend o backend estén desplegados.
Para una instalación autorizada, el inventario debe aportar
`backend_private_ip` y `database_private_ip` y el Vault debe aportar
`vault_postgres_password`. Ejemplo sin contraseñas en argumentos:

```bash
ansible-playbook -i /ruta/privada/hosts.ini infrastructure/ansible/database.yml \
  --vault-password-file /ruta/privada/vault-password \
  -e @/ruta/privada/secretos.yml \
  -e postgresql_psycopg_deb=/ruta/local/python3-psycopg2.deb
```

La ruta del paquete solo se necesita cuando falta psycopg2. Puede obtenerse
un `.deb` compatible con la versión y arquitectura del servidor en el
controlador, sin asumir salida a Internet del servidor. Proteger los
inventarios y verificar rutas SSH de WSL antes de ejecutar. Pruebas de entrada
locales: `python3 -B -m unittest discover -s tests -p test_ansible_database.py -v`.

## Exporter PostgreSQL

`postgres-exporter.yml` usa el exporter instalado en la AMI y crea el rol
PostgreSQL `prometheus` con `pg_monitor`, sin superusuario ni contraseña.
La autenticación usa el usuario de sistema `prometheus` por socket local
mediante peer. El exporter escucha exclusivamente en `127.0.0.1:9187` y no
se modifican reglas de red. Comprueba que `/metrics` contiene `pg_up 1`.

```bash
ansible-playbook -i /ruta/privada/hosts.ini infrastructure/ansible/postgres-exporter.yml
```

En `i4-gary-prueba` se aplicó en AWS; la segunda ejecución terminó con
`changed=0` y la comprobación de métricas pasó. El recolector remoto todavía
no puede acceder al loopback: acordar con el integrante 6 un transporte o
escucha privada y reglas restringidas antes de anunciar integración completa.

## Preparación local del frontend

`stage-frontend.yml` genera una propuesta de configuración Nginx bajo
`output/ansible-stage/<tenant>/nginx.conf`, que está ignorado por Git. No
instala archivos en Nginx, no crea certificados y no conecta con AWS. Las
entradas son ejemplos sin datos reales; el dominio o IP pública y la IP real del backend deben
confirmarse antes de desplegar:

```bash
ansible-playbook infrastructure/ansible/stage-frontend.yml \
  -e tenant_slug=i4-demo \
  -e 'institution_name=Institucion de ejemplo' \
  -e tenant_plan_name=Basico \
  -e frontend_server_name=asistencia.example.test \
  -e backend_private_ip=192.0.2.10 \
  -e backend_port=8000
```

La plantilla conserva `/api/` al pasar solicitudes al backend, sirve la SPA y
requiere HTTPS. Espera el frontend compilado en
`/var/www/campus-cloud/<tenant>/current` y un certificado y clave ya instalados
en `/etc/campus-cloud/tls/<tenant>/fullchain.pem` y `privkey.pem`. Esas rutas
son una propuesta de integración, todavía no un contrato acordado. La emisión,
renovación y protección del certificado, la configuración Django de hosts y
CSRF y las reglas de red siguen pendientes. No habilitar la plantilla en AWS
sin validar Nginx, certificado, conectividad y autorización. Este archivo no
configura redirección HTTP ni expone por sí mismo ningún puerto.
El módulo Terraform abre el puerto 80 del frontend a Internet y permite activar
el puerto 443 explícitamente con `enable_frontend_https`; por defecto permanece
cerrado. Este ajuste no instala certificados ni configura Nginx y debe
coordinarse con el responsable de infraestructura. No sustituir HTTPS por HTTP de producción: Django configura
cookies seguras y redirección HTTPS con `DJANGO_DEBUG=false`.
Una IPv4 pública no requiere comprar un dominio, pero HTTPS requiere un
certificado válido para esa IP y renovación automática. Los certificados de IP
de Let's Encrypt tienen una vigencia aproximada de seis días; no se ha
implementado ni verificado su emisión o renovación.
La validación solo comprueba el formato de la IPv4, no que sea privada ni que
pertenezca al tenant; verificarla contra el inventario real antes de usarla.

Para probar la generación y sus validaciones con Ansible instalado:

```bash
python3 -B -m unittest discover -s tests -p test_ansible_stage_frontend.py -v
```

## Preparación local del backend

`stage-backend.yml` genera, sin conectarse a servidores, `backend.env` con
variables no secretas de Django y `backend.service` para systemd/Gunicorn.
Ambos se guardan bajo `output/ansible-stage/<tenant>/`, ignorado por Git.

```bash
ansible-playbook infrastructure/ansible/stage-backend.yml \
  -e tenant_slug=i4-demo \
  -e frontend_server_name=asistencia.example.test \
  -e database_private_ip=192.0.2.11 \
  -e backend_port=8000
python3 -B -m unittest discover -s tests -p test_ansible_stage_backend.py -v
```

El generador local por sí solo es una propuesta: requiere crear el usuario de servicio, instalar
el código de Django y sus dependencias y Gunicorn en el entorno virtual,
provisionar la base y ejecutar migraciones. Los nombres de base `control_asistencia`
y usuario `asistencia`, las rutas y el mecanismo de secretos deben acordarse
antes de desplegar; no son contratos existentes. La unidad requiere el archivo
externo `backend-secrets.env` con `POSTGRES_PASSWORD` y `DJANGO_SECRET_KEY`;
el generador no lo crea, no recibe ni guarda sus valores. Asegurar acceso
restringido al archivo y al proceso antes de instalarlo.

Gunicorn escucha en la interfaz del backend; la regla de red existente lo
limita al frontend. No exponer ese puerto públicamente: Django confía en el
encabezado de protocolo que fija el proxy. La IPv4 solo se valida por formato,
no por pertenencia al tenant. El rol Django de arriba realiza esos pasos para
un backend; el generador local no lo despliega por sí mismo.

## Preparación

- Utilizar un controlador Linux o WSL con Ansible y SSH; Ansible no se ha
  validado en el Windows de este proyecto.
- Recibir del integrante 2 un inventario real generado por el motor para un
  único tenant autorizado. No versionarlo ni compartirlo públicamente.
- Confirmar previamente cuenta AWS, región, propiedad y etiquetas `Project`,
  `MemberId`, `TenantId` y `RunId`. Tener acceso técnico no autoriza modificar
  recursos de terceros.
- Mantener la clave SSH fuera del repositorio. El inventario contiene la ruta
  local, no el contenido de la clave. Comprobar que las rutas y el salto por
  el frontend funcionan desde el controlador utilizado.

El inventario actual del integrante 2 define exactamente un host en cada
grupo `frontend`, `backend` y `database`, `tenant_slug` común y `ansible_host`
por host. Los hosts privados se alcanzan a través del frontend. La misma
interfaz deberá acordarse y probarse con el segundo motor; todavía no se ha
verificado compatibilidad con él.

Desde la raíz del repositorio, con el entorno de Ansible ya instalado:

```bash
ansible-playbook -i inventories/<tenant>/hosts.ini infrastructure/ansible/preflight.yml
```

No usar `--limit` con esta comprobación: debe examinarse el inventario
completo. SSH puede registrar las claves de host en el controlador según su
configuración; esta comprobación no aplica cambios de configuración en los
servidores. El resultado depende del inventario y de los metadatos de las
imágenes; no constituye prueba independiente de la propiedad de AWS.

Pruebas estáticas locales del contrato (requieren PyYAML y no ejecutan Ansible):

```powershell
python -B -m unittest discover -s tests -p test_ansible_preflight.py -v
```

## Secretos y siguientes pasos

`.gitignore` excluye `inventories/`, claves `.pem` y `.key`, estados, archivos
`.env`, contraseñas locales habituales de Vault, `*.retry` y
`infrastructure/ansible/vars/private/`, además de archivos `secrets.yml` y
`secrets.yaml` dentro de Ansible. No garantiza proteger archivos con otros
nombres: guardar secretos fuera del repositorio, revisar `git status`
antes de agregar archivos y no copiar `secrets.yml`, inventarios o claves.
Un archivo cifrado con Vault no sustituye la protección de su contraseña.
Las variables Terraform `*.tfvars` y `*.tfvars.json` y los planes locales
`tfplan` y `*.tfplan` también están ignorados; los archivos de ejemplo sin
secretos pueden usar el sufijo `.example.tfvars` o `.example.tfvars.json`.
No borrar el estado local mientras exista el tenant: se necesita para su
administración y limpieza.

Queda por acordar el contrato de variables y entrega segura de secretos con
los integrantes 2 y 5, y el acceso del recolector con el integrante 6. Los
roles y el comando completo están preparados. El administrador inicial
se crea sin mostrar su contraseña mediante el rol de backend, pero la entrega
segura desde el panel sigue pendiente. Falta observar una renovación automática
real y coordinar su monitorización.

Las referencias históricas `../../../practio7/ansible/`,
`../../../control-asistencia-backend/` y `../../../control-asistencia-frontend/`
no se encontraron en esas rutas relativas en este equipo. Su ausencia no
demuestra que los proyectos no existan en otras ubicaciones.

La entrega final requiere probar Ansible con infraestructura autorizada,
repetir el playbook, verificar login, importación de Excel, asistencia y
servicios tras reinicio, y demostrar que los datos de un tenant no son
accesibles desde otro. Las comprobaciones locales no son evidencia AWS.
