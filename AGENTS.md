# Trabajo de agentes en el monorepo

Leer primero `README.md`, `docs/PLAN-INTEGRACION.md`, `docs/INTEGRACION.md` y la guía del integrante en `docs/agentes/`. Las instrucciones del usuario prevalecen. Este proyecto usa exclusivamente AWS, Angular 20, NestJS 11, PostgreSQL y pnpm workspaces.

- Trabajar en el módulo asignado y conservar los contratos de `packages/contracts`. Proponer cambios incompatibles mediante una nueva versión de contrato y coordinar consumidores.
- Compartir tipos no equivale a compartir secretos. No versionar `.env`, `.pem`, credenciales AWS, estados IaC, inventarios privados ni logs sensibles. La ruta de clave SSH es configuración local; el contenido no se solicita ni se imprime.
- La cuenta y usuario IAM son compartidos. El acceso técnico no autoriza modificar recursos de otros integrantes. Antes de escribir, verificar cuenta/región, alcance del tenant y etiquetas Project, MemberId, TenantId y RunId según el plan.
- Usar estado separado por tenant y motor. No aplicar Terraform/Pulumi/CloudFormation sobre recursos ya gestionados por otro motor. No usar comandos de borrado por nombre parcial, cuenta completa o solo usuario IAM.
- No presentar simulaciones como despliegues reales. Una AMI registrada requiere su construcción y validación posterior en AWS. Una solicitud con `deployable=false` no puede aprovisionarse.
- Usar `pnpm install --frozen-lockfile`, `pnpm check` y las pruebas específicas del módulo. No crear `package-lock.json` ni un segundo backend/frontend independiente.
- Las migraciones son explícitas; `synchronize=false`. Conservar tenants y metadatos de despliegue existentes. Cada integrante agrega migraciones para sus cambios sin editar una migración ya aplicada.
- Antes de entregar: código, pruebas reproducibles, lista de archivos modificados, contratos consumidos/producidos y limitaciones verificadas. Actualizar documentación afectada y distinguir evidencia local de evidencia AWS.
