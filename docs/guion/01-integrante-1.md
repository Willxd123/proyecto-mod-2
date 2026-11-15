# Guion — Integrante 1: Imágenes base (Packer + cloud-init) y catálogo de planes

**Tiempo:** 2:30 · **Cubre:** RF-01, RF-02, RF-13 · **Entregable:** 4 (catálogo) y parte del 2 · Guía común: [README](README.md)

## Tu aporte en una frase
«Preparé las tres imágenes base y el catálogo de planes, para que crear un tenant sea cuestión de minutos y no de instalar todo desde cero cada vez.»

## Antes de grabar
- El panel abierto en **Planes y Golden AMIs**.
- La consola de AWS en **EC2 → Imágenes → AMIs** (región `us-east-1`), con las 3 AMIs visibles. Cubrir el ID de cuenta de la barra de direcciones.
- En el editor, listos: `infrastructure/packer/images.pkr.hcl`, `infrastructure/packer/scripts/provision.sh`, `infrastructure/cloud-init/frontend.yaml.tmpl`, `config/plans.json`, `config/golden-images.json`.
- Tener a mano la evidencia del smoke test de `scripts/aws_images.py smoke` (carpeta `output/`; **mostrar solo el resumen, no archivos con claves**).

## Minuto a minuto

| Tiempo | Mostrar | Decir |
| --- | --- | --- |
| 0:00–0:40 | Panel → **Planes y Golden AMIs**: las 3 tarjetas de plan y la tabla de las 3 AMIs por rol | «El catálogo tiene tres planes: Básico hasta 100 estudiantes, Estándar hasta 500 y Avanzado hasta 1,500. Cada uno define el tamaño de las tres máquinas: frontend, backend y base de datos. Debajo están las tres Golden Images, una por rol, ya construidas en `us-east-1`.» |
| 0:40–1:10 | Consola de AWS → AMIs: las 3 AMIs con su fecha; luego, si se puede, **Instancias** de un tenant mostrando que nacieron de ellas | «Estas son las tres AMIs reales en AWS. Cada tenant que se crea lanza sus tres máquinas a partir de ellas; por eso no hay que instalar Nginx ni PostgreSQL en cada despliegue.» |
| 1:10–2:00 | Editor: `images.pkr.hcl` y luego `provision.sh` (la parte que cambia por rol); después `frontend.yaml.tmpl` | «Con Packer, una sola plantilla parametrizada construye las tres imágenes sobre Ubuntu 24.04. Todas llevan el exportador de métricas del sistema, `node-exporter`. Además, el frontend lleva Nginx; el backend, Python y Gunicorn; y la base de datos, PostgreSQL 16 con las herramientas de respaldo. **El código de la aplicación no va en la imagen:** lo instala Ansible, así la misma imagen sirve para cualquier institución. Con cloud-init, en el primer arranque cada máquina recibe su nombre y su identidad de tenant y de rol, y Ansible verifica esa identidad antes de configurar nada.» |
| 2:00–2:30 | Editor: `config/plans.json` (un plan) y `docs/CATALOGO-PLANES.md`; opcional, `generate_catalog.py` | «El catálogo vive en `plans.json`, versionado (hoy la 1.2.0), y el documento de planes se genera a partir de él para que no se desfasen. Al crear un tenant se guarda una copia del plan; si el catálogo cambia después, el backend lo detecta y no despliega con datos distintos. Dejé también el smoke test: lanza cada imagen, comprueba el primer arranque y limpia lo temporal.» |

## Código que puedes abrir (en este orden)
1. `infrastructure/packer/images.pkr.hcl` — plantilla única, tres imágenes.
2. `infrastructure/packer/scripts/provision.sh` — qué se instala por rol (`case` de `frontend`, `backend`, `database`).
3. `infrastructure/cloud-init/*.yaml.tmpl` y `scripts/render_cloud_init.py` — identidad del primer arranque.
4. `scripts/aws_images.py` — `preflight` (solo lectura), `build` y `smoke`.
5. `config/plans.json`, `config/golden-images.json` y `scripts/generate_catalog.py`.

## Preguntas probables del docente y cómo responder
- **¿Por qué Packer y no instalar al arrancar?** Velocidad y repetibilidad: la imagen ya trae todo y el tenant queda listo en minutos; instalar desde cero tardaría más y dependería de Internet en cada despliegue.
- **¿Cómo se sabe que la máquina es la correcta?** El primer arranque escribe una identidad (tenant y rol) y Ansible la lee y la compara antes de configurar; si no coincide, se detiene.
- **¿Qué pasa si se borra una AMI?** Los tenants ya creados siguen funcionando, pero no se pueden crear nuevos con ese rol hasta reconstruirla; por eso el registro de AMIs se verifica en el preflight.
- **¿Cuesta dinero?** Sí: las AMIs generan almacenamiento de snapshots mientras existan.
- **¿Se pueden editar los planes desde el panel?** No; es una función opcional que el docente dejó fuera. El catálogo se edita en `plans.json`.

## No mostrar
`.pem`, `.env`, la carpeta `output/` completa, el ID de cuenta de AWS.

## Evidencia que debes tener lista
- Captura de las 3 AMIs en AWS.
- Resultado del smoke test (resumen).
- Captura del catálogo en el panel.
