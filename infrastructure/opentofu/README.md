# Integrante 2 — Motor principal con OpenTofu

Raíz OpenTofu del motor principal. Usa **el mismo módulo** que Terraform (`../terraform/modules/tenant`): misma red, security groups, instancias por plan, inventario y `ProvisioningResult`. Solo cambian el binario (`tofu`), el lockfile (`registry.opentofu.org`) y la carpeta de estado.

Se usa cuando la solicitud tiene `engine: "opentofu"`:

```powershell
python scripts/prepare_handoff.py --tenant i2-demo-tofu --name "Instituto Demo" --email admin@demo.edu --plan estandar --engine opentofu --key-name practico7-asistencia --registry config/golden-images.json --ssh-public-key-file practico7.pub
python scripts/terraform_tenant.py plan --request output/handoff/i2-demo-tofu/request.json --account-id <CUENTA> --ssh-cidr <TU_IP>/32
```

Estado: `infrastructure/opentofu/state/<tenant>/terraform.tfstate` (ignorado por Git). Un tenant creado con OpenTofu se gestiona siempre con OpenTofu.

Requisito: OpenTofu ≥ 1.7 (`winget install OpenTofu.Tofu`). Documentación completa, arquitectura y pruebas: [`../terraform/README.md`](../terraform/README.md).
