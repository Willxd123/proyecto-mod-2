# Estado de verificación de la primera entrega

## Comprobado en el entorno local

- Conexión PostgreSQL con las variables suministradas por el equipo. La base `proyecto_modulo_2` ya existía y no contenía tablas; se conservó.
- Tres pruebas automatizadas de contratos de infraestructura: render seguro de user-data para los tres roles y rechazo de identificadores inseguros; capacidades de disco compatibles con las imágenes y coherencia del Entregable 4; importación del último run de Packer y rechazo de artefactos inválidos.
- Contenido YAML renderizado analizado con PyYAML disponible en el entorno.
- Sintaxis de ambos scripts Bash comprobada con `bash -n`.
- HCL analizado y formateado con el parser de `terraform fmt` sobre una copia temporal. Esto verifica sintaxis HCL, no semántica ni compatibilidad del plugin de Packer.
- Sintaxis JavaScript del archivo de pruebas API comprobada con `node --check`.
- Repositorio Git local inicializado y `.env` confirmado como ignorado. No se realizó commit ni se configuró un remoto.

## Pendiente por restricciones del entorno

La terminal del agente no puede descargar paquetes desde el registro npm: npm devolvió `EACCES` y pnpm `ERR_PNPM_META_FETCH_FAIL`. Por ello no se completaron la instalación, el lockfile, la compilación TypeScript/Angular, las pruebas de API ni la revisión visual en navegador.

Ejecutar desde una terminal con acceso al registro, en la raíz del monorepo:

```powershell
pnpm install
pnpm check
pnpm dev
```

Conservar el `pnpm-lock.yaml` que genere la instalación. No generar ni mantener `package-lock.json` en este monorepo. Si pnpm muestra que bloqueó scripts de dependencias, revisar cuáles requieren construcción para Angular/Nest y aprobar solo los necesarios con `pnpm approve-builds`; no habilitar indiscriminadamente todos los scripts.

El arranque y las pruebas de API ejecutan la migración inicial y la carga idempotente del catálogo en la base local configurada. Estas operaciones todavía no se han ejecutado con Nest en el entorno del agente. La prueba no borra la base ni crea tenants ficticios.

## Pendiente en AWS

Packer no está instalado. Faltan `packer init`, validación específica con el plugin Amazon, construcción de las tres AMIs, primer arranque real y comprobación de acceso/configuración mediante Ansible. No se crearon instancias, AMIs ni otros recursos AWS durante esta entrega.

También faltan la implementación de los motores parametrizados por tenant, escáner, orquestación, ciclo de vida y observabilidad por los integrantes responsables. Los espacios del panel señalan estas funciones como pendientes.
