"""Importa resultados reales de Packer al registro local que consulta NestJS."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent


def import_builds(manifest, packer_version):
    if not manifest.get('last_run_uuid') or not re.fullmatch(r'\d+\.\d+\.\d+', packer_version):
        raise ValueError('Se requiere un último run y una versión real de Packer.')
    images = []
    for build in manifest['builds']:
        if build.get('packer_run_uuid') != manifest.get('last_run_uuid'):
            continue
        metadata = build['custom_data']
        if not re.fullmatch(r'\d+\.\d+\.\d+', metadata['image_version']) or not re.fullmatch(r'[a-f0-9]{7,40}', metadata['source_revision']):
            raise ValueError('Metadatos de versión o revisión inválidos.')
        role = metadata['role']
        if role not in ('frontend', 'backend', 'database'):
            raise ValueError('Rol de imagen desconocido.')
        region, ami_id = build['artifact_id'].split(':', 1)
        if not re.fullmatch(r'ami-[a-f0-9]{17}', ami_id) or not re.fullmatch(r'[a-z]{2}(?:-[a-z]+)+-\d', region):
            raise ValueError('Artefacto AMI o región inválidos.')
        images.append(dict(role=role, provider='aws', region=region, ami_id=ami_id,
                           image_version=metadata['image_version'], source_revision=metadata['source_revision'],
                           packer_version=packer_version,
                           built_at=datetime.fromtimestamp(build['build_time'], timezone.utc).isoformat()))
    if not images:
        raise ValueError('El manifiesto no contiene imágenes del último build.')
    return images


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('--packer-version', required=True)
    parser.add_argument('--output', type=Path, default=ROOT / 'config/golden-images.local.json')
    args = parser.parse_args()
    try:
        new_images = import_builds(json.loads(args.manifest.read_text(encoding='utf-8')), args.packer_version)
        registry = json.loads(args.output.read_text(encoding='utf-8')) if args.output.exists() else {'schema_version': 1, 'images': []}
        keys = {(image['role'], image['region']) for image in new_images}
        registry['images'] = [image for image in registry['images'] if (image['role'], image['region']) not in keys] + new_images
        args.output.parent.mkdir(parents=True, exist_ok=True)
        temporary = args.output.with_suffix('.tmp')
        temporary.write_text(json.dumps(registry, indent=2) + '\n', encoding='utf-8')
        temporary.replace(args.output)
        print(f'Registradas {len(new_images)} imágenes; no se verificó su existencia vía AWS.')
    except (KeyError, ValueError, OSError) as error:
        parser.error(str(error))
