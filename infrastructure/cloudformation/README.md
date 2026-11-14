# Integrante 3 — CloudFormation y escaneo

## Alcance y límites

El motor crea un stack CloudFormation independiente por tenant: VPC, subredes,
security groups y tres EC2 con EBS cifrado e IMDSv2. Backend y PostgreSQL son
privados; PostgreSQL acepta conexiones del security group del backend. Consume
`DeploymentRequest` versión 1 y devuelve `ProvisioningResult` versión 1 y un
inventario compatible con Ansible. No modifica ni importa stacks de otros
motores.

El ejecutor es una herramienta local, no un endpoint de creación. No implementa
actualización de stacks, suspensión/reanudación, recuperación automática ni
bloqueo distribuido. Debe operar un único proceso autorizado por tenant. No
cambiar de motor sobre recursos existentes. La comprobación de etiquetas no
reemplaza autorización ni coordinación en la cuenta compartida.

El escaneo de seguridad previo al despliegue integra **tres escáneres** (`trivy`, `checkov` y `cfn-lint` / Trivy Config):
1. **Trivy Secret Scanner (`trivy`)**: detecta secretos expuestos en los cuatro archivos del handoff y en la infraestructura del motor seleccionado.
2. **Checkov IaC & Regla 5432 (`checkov`)**: ejecuta Checkov sobre las plantillas CloudFormation o módulos Terraform/OpenTofu y verifica explícitamente la regla crítica `IAC-PG-5432-PUBLIC` para impedir que el puerto `5432` de PostgreSQL quede abierto a `0.0.0.0/0` o `::/0`.
3. **Trivy Config & cfn-lint (`cfn-lint`)**: analiza configuraciones IaC con Trivy (`--scanners misconfig`) y valida la plantilla CloudFormation con `cfn-lint`.

Con CloudFormation analiza los cuatro archivos del handoff y `infrastructure/cloudformation/tenant.yaml`; con Terraform/OpenTofu analiza los cuatro archivos del handoff, los archivos `.tf`, la plantilla de inventario y las plantillas cloud-init. No admite Pulumi ni analiza paquetes de la aplicación, estados ni archivos adicionales del operador. Cualquier secreto expuesto o hallazgo `CRITICAL` (como abrir el puerto `5432` a Internet) bloquea el aprovisionamiento (`status = "blocked"`). Las observaciones IaC de severidad `HIGH`, `MEDIUM` o `LOW` se reportan como advertencias informativas (`blocking = false`) visibles en la consola y en `/seguridad` sin detener la creación del tenant. Un error de ejecución de cualquiera de los tres escáneres también bloquea. Usa modo offline y desactiva telemetría.

## Requisitos

- Python 3.10+, AWS CLI v2, Trivy, Checkov y cfn-lint disponibles en `PATH`.
- AMIs del proyecto en la misma cuenta y región, y key pair EC2 existente.
- IP pública del operador en `/32` y cuenta AWS esperada explícita.
- Ansible en Linux o WSL, con clave privada local de permisos `0600`.
- Paquetes y variables de asistencia descritos en
  [Ansible](../ansible/README.md); los secretos se gestionan fuera de Git.

Para Windows y WSL, una clave bajo `/mnt/c` puede tener permisos demasiado
amplios para SSH. Preparar una copia protegida en el filesystem de WSL y pasar
su ruta Linux; nunca pasar el contenido de la clave ni versionarla.

## Preparar y validar

Desde la raíz del repositorio, usando datos y cuenta autorizados:

```powershell
python scripts\prepare_handoff.py --tenant i3-demo-unico --name "Instituto Demo" --email admin@example.test --plan basico --engine cloudformation --key-name NOMBRE_KEY_PAIR --registry config\golden-images.json
python scripts\security_scan.py --tenant i3-demo-unico
python scripts\cloudformation_tenant.py validate --tenant i3-demo-unico --account-id CUENTA_DE_12_DIGITOS --ssh-cidr IP_PUBLICA/32
```

`security_scan.py` devuelve JSON con reglas y severidad, sin valores de secretos:
salida 0 limpia, 1 bloqueada y 2 por error. La huella identifica los archivos
del handoff **y de infraestructura** analizados, no los paquetes de aplicación.
`validate` comprueba la cuenta, AMIs, key pair, capacidades por zona y
plantilla; no crea recursos. No lee rutas de archivos desde el navegador.

Para una demostración web local, establecer `SECURITY_SCAN_LOCAL=true` y
`HOST=127.0.0.1` en el entorno del backend, reiniciarlo y abrir `/seguridad`
desde `localhost:4200` o `127.0.0.1:4200`. Está desactivado por defecto.
El endpoint `POST /api/security/scan` acepta únicamente `{tenant_slug}` y
solo analiza el handoff predeterminado del tenant. Esta restricción local
**no es autenticación** y no autoriza exponer la API en red.

## Crear, configurar y eliminar

Crear recursos solo después de acordar alcance y costo. El comando vuelve a
ejecutar Trivy, valida la huella y entrega a CloudFormation la misma copia de
la plantilla analizada:

```powershell
python scripts\cloudformation_tenant.py create --tenant i3-demo-unico --account-id CUENTA_DE_12_DIGITOS --ssh-cidr IP_PUBLICA/32 --ssh-private-key-path /ruta/linux/clave.pem --enable-https
```

`--enable-https` abre 443 únicamente en el frontend; no configura un
certificado. La ejecución deja `owner.json`, `provisioning-result.json` y
`hosts.yml` en `output/handoff/<tenant>/cloudformation/`, excluidos de Git.
El registro contiene el ARN exacto del stack y la cuenta; conservarlo privado
para consultar o eliminar. El inventario contiene direcciones y una ruta de
clave, nunca su contenido. No sobrescribe resultados o inventarios diferentes.
La salida solo se entrega tras comprobar cuenta, etiquetas, VPC, subredes,
instancias, AMIs y direcciones.

Con el inventario generado, el operador puede ejecutar
`infrastructure/ansible/preflight.yml` y después `configure-tenant.yml` con
variables y Vault según la guía del integrante 4. El playbook no valida por sí
solo la cuenta ni las etiquetas AWS: verificar identidad y propiedad antes de
aplicarlo. El integrante 5 debe hacer esa verificación inmediatamente antes de
invocar Ansible y comprobar servicios antes de marcar `ACTIVE`.

La eliminación borra los recursos y datos del stack; exige confirmación:

```powershell
python scripts\cloudformation_tenant.py destroy --tenant i3-demo-unico --account-id CUENTA_DE_12_DIGITOS --confirm i3-demo-unico
```

Verifica cuenta, ARN guardado, etiquetas y tipos/propiedad de recursos y
volúmenes antes de eliminar. Si falta el registro o hay discrepancias se
detiene; investigar manualmente, sin borrar por coincidencia parcial. Conservar
el handoff original para operaciones posteriores. AWS puede conservar etiquetas
de instancias terminadas temporalmente: no reutilizar el identificador de una
prueba reciente.

## Evidencia

El 14 de noviembre de 2026, una prueba posterior desde la web con CloudFormation
completó el flujo demo hasta `SUCCEEDED`: el tenant quedó `ACTIVE` y el worker
verificó HTTPS y el login inicial. Es una demostración local sin autenticación
del operador, no una validación de producción ni del ciclo de vida completo.

El 14 de noviembre de 2026 se creó en `us-east-1` un tenant temporal con
CloudFormation y plan Básico. Se verificaron tres EC2, tres volúmenes cifrados,
IMDSv2, etiquetas, aislamiento de PostgreSQL y resultado/inventario. Ansible
verificó SSH, cloud-init e identidad de los tres servidores; `configure-core.yml`
configuró PostgreSQL, backend y exporter. La segunda ejecución terminó con
`changed=0` en los tres hosts.

La prueba **no ejecutó `configure-tenant.yml` completo ni validó el frontend,
HTTPS, login o asistencia** con este motor. La prueba anterior del integrante 4
con Terraform no sustituye esa validación. El stack de prueba fue eliminado:
`DELETE_COMPLETE`, tres EC2 terminadas, VPC y volúmenes del run ausentes.

Herramientas observadas: AWS CLI 2.38.3, Trivy 0.76.1, cfn-lint 1.58.0 y
Ansible Core 2.16.3. Después de esa prueba se amplió el escaneo para incluir la
plantilla y se validó la nueva ruta con Trivy, pruebas locales y
`cloudformation validate-template` de solo lectura; no se repitió el despliegue.

Para repetir las pruebas locales:

```powershell
cfn-lint infrastructure\cloudformation\tenant.yaml
python -m unittest discover -s tests -p test_cloudformation_tenant.py -v
python -m unittest discover -s tests -p test_security_scan.py -v
pnpm check
```

## Entrega al integrante 5

El contrato `SecurityScanResult` incluye `status`, hallazgos redactados, alcance
y huella. Rechazar `blocked`, errores, resultados caducados y cambios en la
huella; el resultado visual no autoriza un despliegue. La demo local integra solicitud, escáner, selección del motor, Ansible y
verificación; al completarse registra versiones y snapshot en
`DeploymentMetadata`. Para el flujo definitivo aún faltan autenticación,
bloqueo durable y recuperación tras reinicios.
La demo local ya ejecuta la creación desde la web; el ciclo de vida completo
sigue pendiente del integrante 5.
