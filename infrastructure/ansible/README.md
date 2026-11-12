# Integrante 4 — Configuración y asistencia

Referencia existente: `../../../practio7/ansible/`. Integración pendiente. Los playbooks actuales instalan varias dependencias que las imágenes Packer ya incluirán: separar instalación base de configuración por tenant.

No copiar `secrets.yml`, inventarios reales ni claves. Usar inventario generado por cualquiera de los motores, esperar `cloud-init status --wait`, configurar database → backend → frontend y probar aislamiento. La aplicación de asistencia existente está en `../../../control-asistencia-backend/` y `../../../control-asistencia-frontend/`; todavía no se ha migrado a este monorepo. El panel nuevo usa NestJS y Angular 20 y es una aplicación distinta.
