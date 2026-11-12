# Instrucción para el agente del integrante 2

Implementa RF-03, RF-07, RF-08 y RF-09, aislamiento de red y estado IaC. Lee `AGENTS.md`, `docs/PLAN-INTEGRACION.md`, `docs/INTEGRACION.md`, `packages/contracts` y la referencia de la plantilla.

Usa el frontend/API existentes; el formulario de tres pasos y su borrador ya están preparados. Completa la validación en servidor y coordina con el integrante 5 el endpoint de creación. No ejecutes comandos suministrados por el navegador.

En `infrastructure/terraform`, adapta los ejemplos previos al contrato `DeploymentRequest`. Consume `plan_snapshot.roles`, las tres imágenes y los YAML por rol. Rechaza `deployable=false`, slugs inválidos, cuenta equivocada o imágenes de otra región. Crea tres instancias, red y grupos de seguridad aislados, EBS cifrado, IMDSv2 y etiquetas por tenant/integrante/run.

Estado por tenant/motor y bloqueo adecuado al backend elegido; no reutilices estados de los prácticos. Exporta `ProvisioningResult` y un inventario compatible con Ansible. Utiliza el key pair existente validado en la región; la clave privada solo es una referencia local para SSH.

Pruebas: validación local del motor; plan del tenant mostrando capacidades de su snapshot; creación controlada en AWS; salidas/inventario; segunda planificación sin cambios innecesarios; ausencia de acceso público a PostgreSQL. Limpia exclusivamente recursos propios de prueba.

Entrega módulo, contrato, ejemplos sin secretos, comandos y evidencia. No dupliques tamaños de planes en frontend o scripts. La UI no debe anunciar un tenant ACTIVE hasta que Ansible y las comprobaciones hayan finalizado.
