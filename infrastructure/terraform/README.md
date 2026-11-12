# Integrante 2 — Motor principal

Punto de integración pendiente. Referencia existente: `../../../control-asistencia-infra/`.

Adaptar módulos a un tenant parametrizado y consumir `Plan.roles`, las AMIs por rol/región y el user-data del integrante 1. No copiar estados, llaves ni archivos de variables privados. Mantener estado separado por tenant, EBS gp3 cifrado e IMDSv2. Exportar identificadores, direcciones e inventario para Ansible. El frontend y la API de creación se integran en las aplicaciones del monorepo.

No ejecutar los ejemplos previos sin revisar sus recursos y estado: no están adaptados automáticamente a este proyecto.
