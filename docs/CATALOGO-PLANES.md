# Catálogo de planes — Entregable 4

Versión del catálogo: **1.2.0**. Nube: **AWS**.

Propuesta académica del integrante 1. Cada tenant dispone de tres máquinas independientes. Las capacidades son configuraciones de laboratorio, sin precios, respaldos automáticos ni garantía de rendimiento. Los límites de estudiantes son informativos; el control de cuotas RF-05 es opcional.

| Plan | Estudiantes de referencia | Rol | Instancia | vCPU | RAM GiB | EBS GiB |
| --- | --- | --- | --- | --- | --- | --- |
| Básico | 100 | frontend | t3.micro | 2 | 1 | 12 |
| Básico | 100 | backend | t3.micro | 2 | 1 | 12 |
| Básico | 100 | database | t3.micro | 2 | 1 | 20 |
| Estándar | 500 | frontend | t3.micro | 2 | 1 | 16 |
| Estándar | 500 | backend | t3.small | 2 | 2 | 20 |
| Estándar | 500 | database | t3.small | 2 | 2 | 40 |
| Avanzado | 1500 | frontend | t3.small | 2 | 2 | 20 |
| Avanzado | 1500 | backend | t3.medium | 2 | 4 | 30 |
| Avanzado | 1500 | database | t3.medium | 2 | 4 | 80 |

## Política de respaldo y columnas de base de datos

| Plan | Política de respaldo | Instancia de referencia (backend) | Disco de la base de datos |
| --- | --- | --- | --- |
| Básico | Manual desde el panel: respaldo (pg_dump) y restauración bajo demanda; sin respaldo automático | t3.micro | 20 GiB |
| Estándar | Manual desde el panel: respaldo (pg_dump) y restauración bajo demanda; sin respaldo automático | t3.small | 40 GiB |
| Avanzado | Manual desde el panel: respaldo (pg_dump) y restauración bajo demanda; sin respaldo automático | t3.medium | 80 GiB |

La tabla `catalog_plans` guarda además `instance_type`, `vcpu`, `ram_gb` y `db_storage_gb` (servidor backend como referencia y disco de la base de datos); el detalle por rol vive en la columna `roles`.

Los volúmenes usan gp3 cifrado y deben ser iguales o mayores que la raíz de 12 GiB de la imagen Packer. El motor IaC aplica estos valores; su implementación corresponde a los integrantes 2 y 3.

Las AMIs se reutilizan entre planes por rol y región; la capacidad de cómputo y el tamaño EBS los define el plan, no una imagen diferente por cada tamaño.

Los valores nominales de instancias T3 se contrastaron con la [documentación de AWS](https://docs.aws.amazon.com/ec2/latest/instancetypes/gp.html). No se asume gratuidad ni se calculan precios. La capacidad de disco EBS es la asignación del laboratorio, no el tamaño máximo de datos útiles de PostgreSQL.

Fuente única: `config/plans.json`. Regenerar con `python scripts/generate_catalog.py` después de cambiar el catálogo.
