# Instrucción para el agente del integrante 1

Completa RF-01, RF-02, aportes RF-09/RF-13, Packer/cloud-init y Entregable 4. Lee `AGENTS.md`, `docs/PLAN-INTEGRACION.md`, `docs/REFERENCIA-PLANTILLA.md` y `infrastructure/packer/README.md`.

Conserva Angular 20, NestJS 11, PostgreSQL y pnpm. El catálogo se mantiene en `config/plans.json`, se carga idempotentemente y se documenta con `python scripts/generate_catalog.py`. No implementes edición de planes ni cuotas automáticas como obligación.

Ejecuta `pnpm check`. Después, con acceso AWS:

1. Instala Packer portable con `powershell -File scripts/install-packer.ps1`.
2. Ejecuta preflight y confirma en su resultado cuenta, región, key pair y subred. El comando no modifica AWS.
3. Revisa/commitea la versión de plantillas que se construirá. Ejecuta `aws_images.py build` con ese commit real; crea recursos temporales y AMIs facturables ya autorizados en el alcance de imágenes.
4. Ejecuta `aws_images.py smoke` con la ruta local del `.pem`, verifica los tres primeros arranques y revisa la evidencia de limpieza.
5. Publica el registro de AMIs para el equipo por el mecanismo acordado; no adjuntes credenciales ni claves.

No marques M1 como concluido sin AMIs reales y smoke tests. La disponibilidad de una AMI registrada se verifica mediante AWS. El programa guarda evidencia en `output/`; no confundir datos de pruebas unitarias con resultados cloud.

Entrega catálogo, commits/versiones, AMIs por rol/región, user-data, evidencia y lista de limitaciones. La configuración de usuarios de aplicación y base pertenece al integrante 4; la configuración final de dashboards y alertas al integrante 6.
