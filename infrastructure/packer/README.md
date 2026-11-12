# Packer y cloud-init — Integrante 1

Una plantilla parametrizada construye **tres AMIs distintas**, una por rol. Se utiliza Ubuntu 24.04 amd64 de Canonical; la AMI origen se fija explícitamente por región y se verifica contra el filtro de propietario. Los discos de imagen son de 12 GiB y quedan cifrados; el catálogo asigna discos de ese tamaño o mayores.

Packer no está instalado en el entorno de preparación. Estas plantillas no se han construido aún contra AWS. No se publican AMIs ficticias ni se afirma que el despliegue está validado.

## Ruta automatizada de cierre

Con acceso de red desde su terminal, instalar Packer portable desde la raíz:

```powershell
powershell -NoProfile -File scripts/install-packer.ps1
```

La descarga oficial de Packer 1.14.3 se verifica por SHA256 y queda en `.tools/packer`, sin modificar el PATH del sistema. Su descarga no fue posible desde el entorno del agente.

Realizar el preflight de solo lectura; reemplazar `TU_IP_PUBLICA/32` por la IP pública de salida actual:

```powershell
python scripts/aws_images.py preflight --region us-east-1 --ssh-cidr TU_IP_PUBLICA/32 --key-name practico7-asistencia --pem C:/P_Dtic/diplomado/lab3/practico7-asistencia.pem
```

Comprueba identidad, key pair/clave pública, VPC/subred con ruta a Internet y AMI Canonical de origen. Puede especificarse `--vpc-id` y `--subnet-id` si no se quiere usar una subred de la VPC por defecto. Si falla no modifica AWS. El resultado queda en `output/aws-preflight.json` y fija la cuenta esperada.

Después de revisar y guardar en Git la versión de las plantillas, usar su commit real:

```powershell
python scripts/aws_images.py build --source-revision COMMIT_REAL --image-version 0.1.0
python scripts/aws_images.py smoke --pem C:/P_Dtic/diplomado/lab3/practico7-asistencia.pem
```

`build` verifica la cuenta, valida y construye los tres roles de forma secuencial, y registra las AMIs reales. `smoke` crea instancias de verificación con el key pair compartido, prueba el primer arranque y solicita su terminación; solo limpia IDs creados por su ejecución y verifica sus etiquetas antes de terminar instancias. Las instancias usan volúmenes raíz gp3 cifrados con borrado al terminar. Revisar `output/verify-*/evidence.json` y la limpieza en AWS, especialmente si hubo interrupción o falta de conexión. El script no elimina las AMIs ni sus snapshots.

Los recursos usan Project, MemberId, Purpose y RunId. El lock local impide dos builds simultáneos en la misma copia del monorepo; no es un bloqueo distribuido para la cuenta compartida.

Tras la validación real, se puede publicar el registro sanitizado de `config/golden-images.local.json` como `config/golden-images.json` para que los compañeros reciban las referencias en el repo. El registro contiene identificadores y versiones, no credenciales. Nunca publicar `.pem`, `.env` ni evidencia con datos privados de la cuenta sin revisar.

## Preparación

Necesitarán Packer 1.14+, credenciales AWS mediante su perfil habitual, y una VPC/subred pública de construcción con salida HTTPS. La IP pública de salida del equipo constructor se autoriza exclusivamente con máscara `/32` para SSH. No copiar credenciales en `.pkrvars.hcl`.

Desde `infrastructure/packer`:

```powershell
Copy-Item build.example.pkrvars.hcl build.pkrvars.hcl
# Completar región, AMI origen real, VPC, subred, IP /32 y commit real del monorepo.
packer init .
packer fmt -check .
packer validate -var-file=build.pkrvars.hcl -var="role=frontend" .
packer validate -var-file=build.pkrvars.hcl -var="role=backend" .
packer validate -var-file=build.pkrvars.hcl -var="role=database" .
```

La validación estática puede ejecutarse con `packer validate -syntax-only .` antes de completar los valores. `validate` completo puede consultar AWS. `build` crea recursos facturables y las AMIs/snapshots finales permanecen después de eliminar las instancias temporales:

```powershell
packer build -var-file=build.pkrvars.hcl -var="role=frontend" .
packer build -var-file=build.pkrvars.hcl -var="role=backend" .
packer build -var-file=build.pkrvars.hcl -var="role=database" .
```

Las instancias temporales son `t3.small`; Packer genera su key pair y security group temporal, requiere IMDSv2 y cifra el volumen. La etiqueta `Purpose=packer-build` permite identificar los recursos temporales. Ante un fallo, revisar los recursos y el log antes de reintentar. No hay borrado automático de AMIs publicadas.

## Software instalado

| Rol | Dependencias |
| --- | --- |
| Frontend | Nginx, Node 22.18.0 (SHA256 del tarball oficial), npm y pnpm 10.32.1. |
| Backend | Python 3, venv/pip, Gunicorn, Git, cliente PostgreSQL, libpq, xz-utils, Node 22.18.0, pnpm 10.32.1 y PM2 6. Permite reutilizar la aplicación Django de asistencia existente; NestJS corresponde al panel nuevo. |
| Database | PostgreSQL 16 con herramientas de respaldo (`pg_dump`, `pg_restore`, `pg_basebackup`), gzip, OpenSSL y rsync. El cluster inicial se elimina en la VM de construcción y se crea uno nuevo durante el primer arranque del tenant. Postgres exporter instalado y deshabilitado hasta su configuración. |

Todos los roles incluyen utilidades de red (net-tools, iproute2, dnsutils, ping, netcat) y node exporter habilitado en 9100, con comprobación local de su endpoint. Ansible debe instalar las dependencias particulares de la aplicación, configurar secretos, usuarios, migraciones y servicios. No se incorporan datos de instituciones, `.env`, credenciales AWS ni claves privadas a las imágenes. La configuración de Postgres exporter y el acceso privado al recolector se coordinan con los integrantes 4 y 6.

Los scripts eliminan el historial, claves SSH de host y de construcción y estado de cloud-init antes de capturar la VM. `/etc/campus-cloud/image.json` conserva versiones de paquetes y procedencia. Debe probarse el primer arranque de cada imagen antes de dar RF-09 por validado.

## Publicar el manifiesto en el panel

Packer produce un manifiesto por rol. Desde la raíz del monorepo, reemplazar la versión por la salida real de `packer version`:

```powershell
python scripts/import_packer_manifest.py infrastructure/packer/manifest-frontend.json --packer-version VERSION_REAL
python scripts/import_packer_manifest.py infrastructure/packer/manifest-backend.json --packer-version VERSION_REAL
python scripts/import_packer_manifest.py infrastructure/packer/manifest-database.json --packer-version VERSION_REAL
```

El importador toma el último run, fusiona por región y rol y escribe `config/golden-images.local.json` de forma atómica. Nest lo lee en cada consulta; no necesita reiniciarse. El importador valida formato y procedencia del manifiesto, pero no comprueba la existencia ni el estado de la AMI vía AWS.

## User-data para los motores

```powershell
python scripts/render_cloud_init.py --tenant instituto-demo --role database --ssh-public-key-file C:/ruta/practico7-asistencia.pub --output output/instituto-demo/database.yaml
```

Renderizar los tres roles y pasar el resultado como user-data a los motores. El renderer restringe el slug y el rol antes de sustituir contenido, sin interpolación de comandos ni credenciales. Inyecta las llaves SSH públicas (`ssh_authorized_keys`; solo acepta formato de llave pública, nunca la privada), SSH sin contraseña, hostname por tenant, zona `America/La_Paz` y swap de 2 GiB. Ansible espera a cloud-init antes de conectarse a PostgreSQL o desplegar.

Referencias: [builder Amazon EBS](https://developer.hashicorp.com/packer/integrations/hashicorp/amazon/latest/components/builder/ebs), [manifest](https://developer.hashicorp.com/packer/docs/post-processors/manifest), [limpieza cloud-init](https://docs.cloud-init.io/en/latest/reference/cli.html).
