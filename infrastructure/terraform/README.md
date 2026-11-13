# Integrante 2 — Motor principal (Terraform / OpenTofu)

Aprovisiona un tenant completo en AWS: una VPC exclusiva, tres security groups encadenados y tres EC2 creadas desde las Golden AMIs del integrante 1 con el tamaño del plan elegido. Genera el inventario `hosts.ini` para Ansible (integrante 4) y el `ProvisioningResult` (`packages/contracts`) para el orquestador (integrante 5).

## Flujo

```text
Paso 1 (web) ──POST /api/tenants/validate──► identificador libre y formatos válidos
             ──POST /api/tenants/drafts────► borrador en tenants (status PENDING)
             ──POST /api/tenants/<id>/tfvars► output/tenants/<id>/terraform.tfvars.json
                                               │  tenant_id, tenant_name, plan_type, region,
                                               │  frontend/backend/database_ami_id, plan_capacity
scripts/terraform_tenant.py ◄──────────────────┘  + datos del operador (cuenta, IP SSH, ruta de la clave)
   terraform workspace select -or-create <tenant_id>
   terraform plan / apply / destroy
        └─► inventories/<tenant_id>/hosts.ini  +  provisioning-result.json
```

## Estructura

```text
infrastructure/terraform/              raíz Terraform (backend, proveedor, candado de workspace, lockfile registry.terraform.io)
  modules/tenant/                      módulo compartido con OpenTofu
    variables.tf                       tenant_id, tenant_name, plan_type, region, 3 AMI IDs, plan_capacity (+ validaciones)
    main.tf                            Golden AMIs, zona y cloud-init del integrante 1 por rol
    network_security.tf                VPC, subredes, rutas, NAT opcional y 3 security groups
    instances.tf                       3 EC2: el plan_type fija tipo y disco de cada rol; cloud-init en user_data
    inventory_generator.tf             local_file + templates/inventory.tftpl → inventories/<tenant_id>/hosts.ini
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
| Capacidad por plan | `plan_type` + `plan_capacity` (copiada de `config/plans.json` al generar el tfvars). Un cambio posterior del catálogo no redimensiona tenants existentes. |
| Golden AMIs | `frontend_ami_id`, `backend_ami_id`, `database_ami_id`. `data.aws_ami` exige que existan en la cuenta (`owners = self`), estén `available` y sean x86_64. |
| cloud-init | Plantillas `infrastructure/cloud-init/<rol>.yaml.tmpl` del integrante 1 con el `tenant_id` (hostname, zona horaria, swap, SSH por llave). |
| Aislamiento | VPC, subredes, rutas y SG propios. El SG por defecto queda sin reglas. PostgreSQL solo acepta tráfico del SG del backend. |
| Seguridad de instancias | IMDSv2 obligatorio, discos gp3 cifrados, SSH solo por llave. |
| Cuenta equivocada | `allowed_account_ids` del proveedor: no se ejecuta nada con credenciales de otra cuenta. |
| Entradas inválidas | Se rechazan `plan_type` fuera del catálogo, discos < 12 GiB, AMIs mal formadas, motores de otro integrante, `tenant_id` inválido y SSH `0.0.0.0/0`. |
| Etiquetas | `Project`, `MemberId`, `TenantId`, `RunId` (UUID del borrador), `Plan`, `ManagedBy` en todos los recursos. |
| Subred privada sin internet | Por defecto. `--enable-nat` crea un NAT Gateway (factura por hora). |
| Exporters | 9100 (los tres roles) y 9187 (base de datos) cerrados hasta indicar `--monitoring-cidr` del recolector (integrante 6). |

## Estado por tenant (workspaces)

Cada tenant tiene su **workspace**: `terraform workspace new <tenant_id>` (el script usa `workspace select -or-create`). Con el backend local, el estado de cada workspace queda en:

```text
infrastructure/terraform/terraform.tfstate.d/<tenant_id>/terraform.tfstate   # tenants creados con Terraform
infrastructure/opentofu/terraform.tfstate.d/<tenant_id>/terraform.tfstate    # tenants creados con OpenTofu
infrastructure/<motor>/.work/<tenant_id>/                                   # TF_DATA_DIR y operator.tfvars.json
inventories/<tenant_id>/hosts.ini                                           # inventario para Ansible (permiso 0600)
```

Un candado en la raíz (`terraform_data.workspace_guard`) detiene el plan si el workspace activo no se llama igual que `tenant_id`, así los datos de un tenant nunca se aplican sobre el estado de otro. Para verlos: `terraform workspace list`.

**Protección del `.tfstate`:** las carpetas anteriores están en `.gitignore`; el estado contiene IDs e IPs pero no contraseñas (el módulo no genera secretos y la clave privada solo aparece como ruta en el inventario). No se comparte por chat ni se copia entre equipos, y se conserva mientras el tenant exista: sin él, `destroy` no sabe qué borrar. Un tenant creado con Terraform se gestiona siempre con Terraform (y lo mismo con OpenTofu).

## Uso

Requisitos: Terraform ≥ 1.7 u OpenTofu ≥ 1.7, perfil AWS configurado (`AWS_PROFILE`) y las tres Golden AMIs en la región.

1. En el panel (`pnpm dev` → *Crear tenant*): completar el Paso 1 y pulsar **Guardar borrador**. Con motor Terraform u OpenTofu se genera `output/tenants/<tenant_id>/terraform.tfvars.json`. También: `POST /api/tenants/<tenant_id>/tfvars`.
2. Ejecutar el motor (`--ssh-cidr` = tu IP pública /32):

```powershell
python scripts/terraform_tenant.py plan    --tfvars output/tenants/colegio-demo/terraform.tfvars.json --account-id <CUENTA> --ssh-cidr <TU_IP>/32 --ssh-private-key-path C:/claves/practico7-asistencia.pem
python scripts/terraform_tenant.py apply   --tfvars output/tenants/colegio-demo/terraform.tfvars.json --account-id <CUENTA> --ssh-cidr <TU_IP>/32 --ssh-private-key-path C:/claves/practico7-asistencia.pem --yes
python scripts/terraform_tenant.py destroy --tfvars output/tenants/colegio-demo/terraform.tfvars.json --account-id <CUENTA> --ssh-cidr <TU_IP>/32 --confirm colegio-demo
```

`apply` genera `inventories/<tenant_id>/hosts.ini` y `output/tenants/<tenant_id>/provisioning-result.json`. `--account-id` también puede venir de `AWS_EXPECTED_ACCOUNT_ID` y la ruta de la clave de `SSH_PRIVATE_KEY_PATH`. El script invoca el motor con listas de argumentos (sin shell) y transmite su salida tal cual.

## Pruebas

```powershell
cd infrastructure/terraform/modules/tenant
$env:TF_DATA_DIR = ".work/test"
terraform fmt -check -recursive
terraform init -backend=false
terraform test           # 13 casos con proveedores simulados: no usa credenciales ni crea recursos
# Con OpenTofu: borrar .terraform.lock.hcl de esta carpeta (solo de pruebas) y repetir con tofu init / tofu test
cd ../../../..
python -m unittest tests.test_terraform_tenant -v
pnpm test                # incluye validate, drafts y el generador de tfvars contra PostgreSQL
```

`terraform test` comprueba capacidades por plan, AMI por rol, cloud-init por rol (con y sin llaves públicas), zona elegida, cifrado, IMDSv2, subred privada sin IP pública, PostgreSQL solo desde el backend, SSH restringido, NAT/exporters opcionales, inventario con salto por el bastión, `ProvisioningResult` y el rechazo de entradas inválidas. **Es evidencia local**; la evidencia en AWS (plan/apply reales, segunda planificación sin cambios, `destroy`) se registra aparte.

## Contratos

- Consume: tfvars del tenant generado por `POST /api/tenants/:slug/tfvars` (`TenantTfvars` en `packages/contracts`), catálogo `config/plans.json`, Golden AMIs (`config/golden-images.json`) y plantillas cloud-init del integrante 1.
- Produce: `ProvisioningResult` (schema 1) en `provisioning-result.json` y `terraform output provisioning_result`; `inventories/<tenant_id>/hosts.ini` con grupos `frontend`, `backend`, `database`, `private` y `ProxyCommand` por el frontend.

## Limitaciones

- La IP pública del frontend cambia tras stop/start; actualizar inventario y base al reanudar es del integrante 5.
- Una sola zona de disponibilidad por tenant (suficiente para el laboratorio).
- Sin NAT, backend y base de datos no pueden descargar paquetes; el integrante 4 debe instalar desde artefactos copiados por SSH o activar `--enable-nat`.
- El estado es local a la máquina que ejecuta el panel. Si varios equipos operan el mismo tenant hace falta un backend remoto (S3) y el bloqueo compartido del integrante 5.
- Los tamaños provienen del catálogo del integrante 1 (`config/plans.json`), no de los 10/50/200 GB de la guía: la Golden AMI ocupa 12 GiB.
