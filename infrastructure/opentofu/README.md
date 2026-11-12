# Integrante 2 — Motor principal con OpenTofu

Raíz OpenTofu del motor principal. Usa **el mismo módulo** que Terraform (`../terraform/modules/tenant`): mismas variables (`tenant_id`, `tenant_name`, `plan_type`, `region`, los 3 AMI IDs), red, security groups, instancias por plan, inventario y `ProvisioningResult`. Solo cambian el binario (`tofu`), el lockfile (`registry.opentofu.org`) y la carpeta de estado.

Se usa cuando el borrador del tenant tiene motor **OpenTofu**:

```powershell
# El tfvars lo genera el panel al guardar el borrador (o POST /api/tenants/<tenant_id>/tfvars)
python scripts/terraform_tenant.py plan --tfvars output/tenants/<tenant_id>/terraform.tfvars.json --account-id <CUENTA> --ssh-cidr <TU_IP>/32
```

Estado: un workspace por tenant (`tofu workspace new <tenant_id>`), guardado en `infrastructure/opentofu/terraform.tfstate.d/<tenant_id>/` (ignorado por Git). Un tenant creado con OpenTofu se gestiona siempre con OpenTofu.

Requisito: OpenTofu ≥ 1.7 (`winget install OpenTofu.Tofu`). Documentación completa, arquitectura y pruebas: [`../terraform/README.md`](../terraform/README.md).
