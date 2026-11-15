# Pulumi — segundo motor (Integrante 3)

Crea el mismo tenant que CloudFormation y Terraform: una VPC dedicada, una subred pública (frontend y bastión) y una privada (backend y base de datos), tres grupos de seguridad encadenados y tres instancias EC2 desde las Golden AMIs del plan. El puerto 5432 solo es accesible desde el backend.

El programa es [`__main__.py`](__main__.py) (Python). Lo ejecuta [`scripts/pulumi_tenant.py`](../../scripts/pulumi_tenant.py), que valida la solicitud, escanea el paquete, comprueba la cuenta y las AMIs y arma el `ProvisioningResult` y el inventario de Ansible, igual que los otros motores. El panel lo ofrece cuando Pulumi está listo en el equipo.

## Requisitos locales (una sola vez)

1. CLI de Pulumi 3.x (`pulumi version`). El instalador lo deja en `~/.pulumi/bin`.
2. Un intérprete de Python con `pulumi` y `pulumi-aws`. Cualquiera de estas dos formas:
   ```powershell
   python -m venv infrastructure/pulumi/.venv
   infrastructure/pulumi/.venv/Scripts/python -m pip install -r infrastructure/pulumi/requirements.txt
   ```
   o definir `PULUMI_PYTHON` en `apps/backend/.env` con la ruta de un `python.exe` que ya los tenga.
3. El mismo entorno de la demo (cuenta AWS, IP del operador, llave, etc.); ver `apps/backend/.env.example`.

La primera ejecución descarga el plugin del proveedor de AWS (unos 250 MB, una vez por equipo).

## Uso desde la línea de comandos

```powershell
python scripts/prepare_handoff.py --tenant mi-tenant --name "Mi Tenant" --email admin@example.edu --plan basico --engine pulumi --key-name practico7-asistencia --registry config/golden-images.json
python scripts/pulumi_tenant.py validate --tenant mi-tenant --account-id <12 dígitos> --ssh-cidr <IP>/32   # solo vista previa; no crea nada
python scripts/pulumi_tenant.py create   --tenant mi-tenant --account-id ... --ssh-cidr ... --ssh-private-key-path /ruta/wsl/llave.pem --enable-https
python scripts/pulumi_tenant.py destroy  --tenant mi-tenant --account-id ... --confirm mi-tenant
```

`create` y `destroy` generan o eliminan recursos reales y pueden costar dinero. Desde el panel se hace con «Crear tenant» y el menú del tenant.

## Estado y secretos

- Un stack por tenant (`tenant-control-center/<tenant>`) en un backend de archivos local: `output/pulumi-state`, ignorado por Git. No se comparte entre equipos.
- No se guardan credenciales AWS ni claves privadas: el programa solo recibe la solicitud validada y datos no secretos.
- Un registro de propiedad (`output/handoff/<tenant>/pulumi/owner.json`) liga cada stack a su cuenta y solicitud; sin él, `destroy` se niega a operar y nunca actúa por nombre.
- Cada recurso lleva las etiquetas `Project`, `MemberId`, `TenantId` y `RunId`.

## Verificación

- `python -m unittest tests.test_pulumi_tenant` (sin AWS).
- `python scripts/pulumi_tenant.py validate ...`: vista previa real del programa contra la cuenta, sin crear recursos.
