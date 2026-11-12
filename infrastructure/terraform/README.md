# Integrante 2 — Motor principal (Terraform / OpenTofu)

Aprovisiona un tenant completo en AWS a partir del contrato `DeploymentRequest` (`packages/contracts`): una VPC exclusiva, tres security groups encadenados y tres EC2 creadas desde las Golden AMIs del integrante 1. Produce el inventario `hosts.ini` para Ansible (integrante 4) y el `ProvisioningResult` para el orquestador (integrante 5).

## Estructura

```text
infrastructure/terraform/              raíz Terraform (backend, proveedor, lockfile registry.terraform.io)
  modules/tenant/                      módulo compartido con OpenTofu
    variables.tf                       entradas: request.json (tenant, plan, región, 3 AMIs) y validaciones
    main.tf                            lectura de la solicitud, zona y Golden AMIs
    network_security.tf                VPC, subredes, rutas, NAT opcional y 3 security groups
    instances.tf                       3 EC2 con tamaño del plan y cloud-init
    inventory_generator.tf             local_file + templates/inventory.tftpl → inventories/<tenant>/hosts.ini
    outputs.tf                         ProvisioningResult
    tests/                             terraform test / tofu test con proveedores simulados
infrastructure/opentofu/               raíz OpenTofu (mismo módulo, lockfile registry.opentofu.org)
```

Terraform y OpenTofu no pueden compartir un lockfile (cada uno elimina las entradas del otro), por eso cada motor tiene su raíz; el código de infraestructura existe una sola vez.

## Arquitectura por tenant

```text
                 internet
                    │ 80 (público)      22 (solo --ssh-cidr /32)
          ┌─────────▼──────────────────────────┐  VPC 10.20.0.0/16 (una por tenant)
          │ subred pública 10.20.1.0/24        │
          │   frontend  (IP pública, bastión)  │
          └─────────┬──────────────────────────┘
                    │ backend_port (8000) y 22, solo desde el SG del frontend
          ┌─────────▼──────────────────────────┐
          │ subred privada 10.20.2.0/24        │
          │   backend ──5432──► database       │  sin IP pública
          └────────────────────────────────────┘
```

| Control | Implementación |
| --- | --- |
| Capacidad por plan | `instance_type` y `disk_gib` de cada rol salen de `plan_snapshot.roles` (`config/plans.json`); no se repiten aquí. |
| Golden AMIs | `data.aws_ami` exige que cada AMI exista en la cuenta (`owners = self`), esté `available` y sea x86_64. |
| Aislamiento | VPC, subredes, tablas de rutas y SG propios. El SG por defecto queda sin reglas. PostgreSQL solo acepta tráfico del SG del backend. |
| Seguridad de instancias | IMDSv2 obligatorio, discos gp3 cifrados, SSH solo por llave (cloud-init). |
| Cuenta equivocada | `allowed_account_ids` del proveedor: no se ejecuta nada con credenciales de otra cuenta. |
| Solicitudes inválidas | Se rechazan `deployable=false`, motores de otro integrante, slugs inválidos, AMIs de otra región, discos < 12 GiB y SSH `0.0.0.0/0`. |
| Etiquetas | `Project`, `MemberId`, `TenantId`, `RunId` (= `request_id`), `Plan`, `ManagedBy` en todos los recursos. |
| Salida a internet de la subred privada | Desactivada por defecto. `--enable-nat` crea un NAT Gateway (factura por hora); acordarlo con el integrante 4. |
| Exporters | 9100 (los tres roles) y 9187 (base de datos) cerrados hasta indicar `--monitoring-cidr` del recolector (integrante 6). |

## Estado por tenant

Cada combinación motor/tenant tiene su propio estado local y su propio directorio de trabajo:

```text
infrastructure/<terraform|opentofu>/state/<tenant>/terraform.tfstate   # estado (con bloqueo de archivo)
infrastructure/<terraform|opentofu>/.work/<tenant>/                    # TF_DATA_DIR y tenant.tfvars.json
inventories/<tenant>/hosts.ini                                         # inventario para Ansible (permiso 0600)
```

Las tres rutas están en `.gitignore`. El estado puede contener IPs e IDs de recursos, pero no contraseñas: el módulo no genera secretos y la clave privada solo aparece como **ruta** en el inventario. Proteger el estado = no versionarlo, no compartirlo por chat y conservarlo mientras el tenant exista (sin él, `destroy` no sabe qué borrar). Dos tenants nunca comparten estado y un tenant creado con Terraform no se gestiona con OpenTofu (estados distintos).

## Uso

Requisitos: Terraform ≥ 1.7 u OpenTofu ≥ 1.7, perfil AWS configurado (`AWS_PROFILE`) y las tres Golden AMIs en la región.

```powershell
# 1. Solicitud con user-data (integrante 1). deployable=true solo si existen las 3 AMIs.
python scripts/prepare_handoff.py --tenant i2-demo-01 --name "Instituto Demo" --email admin@demo.edu --plan basico --engine terraform --key-name practico7-asistencia --registry config/golden-images.json --ssh-public-key-file practico7.pub

# 2. Plan (no crea nada). --ssh-cidr = tu IP pública /32.
python scripts/terraform_tenant.py plan --request output/handoff/i2-demo-01/request.json --account-id <CUENTA> --ssh-cidr <TU_IP>/32 --ssh-private-key-path C:/claves/practico7-asistencia.pem

# 3. Crear (genera inventories/i2-demo-01/hosts.ini y output/handoff/i2-demo-01/provisioning-result.json)
python scripts/terraform_tenant.py apply  --request output/handoff/i2-demo-01/request.json --account-id <CUENTA> --ssh-cidr <TU_IP>/32 --ssh-private-key-path C:/claves/practico7-asistencia.pem --yes

# 4. Eliminar solo ese tenant (pide repetir el slug)
python scripts/terraform_tenant.py destroy --request output/handoff/i2-demo-01/request.json --account-id <CUENTA> --ssh-cidr <TU_IP>/32 --confirm i2-demo-01
```

`--account-id` también puede venir de `AWS_EXPECTED_ACCOUNT_ID`, y la ruta de la clave de `SSH_PRIVATE_KEY_PATH`. El script invoca el motor con listas de argumentos (sin shell) y transmite su salida tal cual, para que el orquestador la muestre en vivo.

## Pruebas

```powershell
cd infrastructure/terraform/modules/tenant
$env:TF_DATA_DIR = ".work/test"
terraform fmt -check -recursive
terraform init -backend=false
terraform test           # 9 casos con proveedores simulados: no usa credenciales ni crea recursos
# Con OpenTofu: borrar .terraform.lock.hcl de esta carpeta (solo de pruebas) y repetir con tofu init / tofu test
cd ../../../..
python -m unittest tests.test_terraform_tenant -v
```

`terraform test` comprueba capacidades por plan, AMI por rol, zona elegida, cifrado, IMDSv2, subred privada sin IP pública, PostgreSQL solo desde el backend, SSH restringido, NAT/exporters opcionales, inventario con salto por el bastión, el `ProvisioningResult` y el rechazo de borradores, motores ajenos, AMIs de otra región y SSH abierto. **Es evidencia local**; la evidencia en AWS (plan/apply reales, segunda planificación sin cambios, `destroy`) se registra aparte.

## Contratos

- Consume: `DeploymentRequest` (schema 1) + YAML de user-data de `prepare_handoff.py`; `Plan.roles`; Golden AMIs.
- Produce: `ProvisioningResult` (schema 1) en `provisioning-result.json` y `terraform output provisioning_result`; `inventories/<tenant>/hosts.ini` con grupos `frontend`, `backend`, `database`, `private` y `ProxyCommand` por el frontend.

## Limitaciones

- La IP pública del frontend cambia tras stop/start; la actualización del inventario al reanudar es del integrante 5.
- Una sola zona de disponibilidad por tenant (suficiente para el laboratorio).
- Sin NAT, backend y base de datos no pueden descargar paquetes; el integrante 4 debe instalar desde artefactos copiados por SSH o activar `--enable-nat`.
- El estado es local a la máquina que ejecuta el panel. Si varios equipos operan el mismo tenant hace falta un backend remoto (S3) y el bloqueo compartido del integrante 5.
