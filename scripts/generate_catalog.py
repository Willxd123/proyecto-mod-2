"""Genera el Entregable 4 desde la misma fuente que consume NestJS."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def generate():
    catalog = json.loads((ROOT / 'config/plans.json').read_text(encoding='utf-8'))
    lines = ['# Catálogo de planes — Entregable 4', '', f"Versión del catálogo: **{catalog['catalog_version']}**. Nube: **AWS**.", '',
             'Propuesta académica del integrante 1. Cada tenant dispone de tres máquinas independientes. Las capacidades son configuraciones de laboratorio, sin precios, respaldos automáticos ni garantía de rendimiento. Los límites de estudiantes son informativos; el control de cuotas RF-05 es opcional.', '',
             '| Plan | Estudiantes de referencia | Rol | Instancia | vCPU | RAM GiB | EBS GiB |',
             '| --- | --- | --- | --- | --- | --- | --- |']
    for plan in catalog['plans']:
        for role, capacity in plan['roles'].items():
            lines.append(f"| {plan['name']} | {plan['max_students']} | {role} | {capacity['instance_type']} | {capacity['vcpu']} | {capacity['ram_gib']} | {capacity['disk_gib']} |")
    lines += ['', '## Política de respaldo y columnas de base de datos', '', '| Plan | Política de respaldo | Instancia de referencia (backend) | Disco de la base de datos |', '| --- | --- | --- | --- |']
    for plan in catalog['plans']:
        lines.append(f"| {plan['name']} | {plan['backup_policy']} | {plan['roles']['backend']['instance_type']} | {plan['roles']['database']['disk_gib']} GiB |")
    lines += ['', 'La tabla `catalog_plans` guarda además `instance_type`, `vcpu`, `ram_gb` y `db_storage_gb` (servidor backend como referencia y disco de la base de datos); el detalle por rol vive en la columna `roles`.', '', 'Los volúmenes usan gp3 cifrado y deben ser iguales o mayores que la raíz de 12 GiB de la imagen Packer. El motor IaC aplica estos valores; su implementación corresponde a los integrantes 2 y 3.', '',
              'Las AMIs se reutilizan entre planes por rol y región; la capacidad de cómputo y el tamaño EBS los define el plan, no una imagen diferente por cada tamaño.', '',
              'Los valores nominales de instancias T3 se contrastaron con la [documentación de AWS](https://docs.aws.amazon.com/ec2/latest/instancetypes/gp.html). No se asume gratuidad ni se calculan precios. La capacidad de disco EBS es la asignación del laboratorio, no el tamaño máximo de datos útiles de PostgreSQL.', '',
              'Fuente única: `config/plans.json`. Regenerar con `python scripts/generate_catalog.py` después de cambiar el catálogo.', '']
    return '\n'.join(lines)


if __name__ == '__main__':
    target = ROOT / 'docs/CATALOGO-PLANES.md'
    target.write_text(generate(), encoding='utf-8', newline='\n')
    print(f'Catálogo generado: {target}')
