# Uso de la plantilla del docente como referencia

Fuente: `../../plantilla_web_completa_tenant_control_center.html`. Se conserva una copia de consulta en [referencias/plantilla-docente.html.txt](referencias/plantilla-docente.html.txt), como texto sin ejecuci?n de scripts. Se utiliza como referencia de requisitos, navegación, formulario, resumen, estados y responsabilidades; no se carga como un iframe ni se ejecutan sus scripts de demostración.

| Referencia | Adaptación en Angular / integración |
| --- | --- |
| Inicio / Lista Tenants | Lista real consultada desde Nest, sin instituciones ficticias; filtros y ciclo de vida se completan según responsabilidades. |
| Crear tenant, paso 1 | Formulario de institución, slug, correo, región AWS, Producción, plan y motor; validaciones y resumen reactivo. Selección desde el catálogo PostgreSQL. |
| Paso 2: Packer y escáner | AMIs registradas filtradas por región y referencia a cloud-init. El escáner real es responsabilidad del integrante 3; no se reproduce su simulación. |
| Paso 3: revisión y logs | Resumen y descarga de solicitud `deployable=false`; espacio para logs reales. El integrante 5 conecta la ejecución. |
| Planes y Golden AMIs | Catálogo y registro consultables; valores desde la fuente común, sin AMIs inventadas. |
| Monitoreo | Métricas reales del panel y acceso al stack Grafana base. Métricas y alertas por tenant pendientes de integrante 6. |
| Escáner & Versiones | Referencias reales de imágenes/catálogo; el escáner y versiones de despliegue se integran por los responsables. |
| Guía 6 Roles y RFs | Página de guía por integrante y documentos de trabajo para sus agentes. |

Correcciones deliberadas respecto de los ejemplos HTML:

- Solo AWS, según confirmación posterior del docente; se omiten Azure y regiones expresadas de forma ambigua.
- El identificador no promete un dominio `.escuelas.app`: el acceso será la IP/URL obtenida al desplegar.
- `t3.micro` tiene 2 vCPU nominales, no el 1 vCPU mostrado en la plantilla. Capacidades y límites de estudiantes son los de `config/plans.json`, propuestas de laboratorio acordables, no garantías de rendimiento ni requisitos fijos.
- No se cargan sus tenants/IPs, métricas, versiones de ejemplo ni logs simulados como datos reales.
- Las AMIs se construyen antes de crear tenants; no se ejecuta Packer por cada solicitud.
- Los requisitos tachados siguen fuera del alcance base. La plantilla no sustituye las aclaraciones orales ya consolidadas.

La implementación conserva las funciones útiles de la plantilla y hace explícito qué está operativo y qué falta integrar.
