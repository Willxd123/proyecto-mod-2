#!/usr/bin/env bash
set -euo pipefail
cloud-init status --wait
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git openssl python3 acl xz-utils prometheus-node-exporter \n  net-tools iproute2 dnsutils iputils-ping netcat-openbsd rsync
install -d /etc/systemd/system/prometheus-node-exporter.service.d
cat >/etc/systemd/system/prometheus-node-exporter.service.d/listen.conf <<'EOF'
[Service]
ExecStart=
ExecStart=/usr/bin/prometheus-node-exporter --web.listen-address=:9100
EOF
systemctl daemon-reload
systemctl enable --now prometheus-node-exporter
curl --fail --silent http://127.0.0.1:9100/metrics -o /tmp/node-exporter.metrics
grep -q node_exporter_build_info /tmp/node-exporter.metrics
case "$IMAGE_ROLE" in
  frontend) apt-get install -y nginx; nginx -t ;;
  backend) apt-get install -y python3-venv python3-pip libpq-dev postgresql-client gunicorn ;;
  database)
    # Herramientas de respaldo: pg_dump/pg_restore/pg_basebackup (postgresql-client-16), gzip y rsync; OpenSSL ya está instalado.
    apt-get install -y postgresql-16 postgresql-client-16 prometheus-postgres-exporter gzip
    # Integrantes 4 y 6 suministran después el usuario y conexión de monitoreo.
    systemctl disable --now prometheus-postgres-exporter
    # No capturar un cluster inicializado: cada tenant lo crea con identidad propia.
    pg_dropcluster --stop 16 main
    ;;
  *) echo 'Rol no permitido' >&2; exit 1 ;;
esac
if [ "$IMAGE_ROLE" != database ]; then
  node_directory="node-v${NODE_VERSION}-linux-x64"
  install_directory="/opt/${node_directory}"
  temporary_directory=$(mktemp -d)
  cd "$temporary_directory"
  curl --fail --location --proto '=https' --tlsv1.2 -O "https://nodejs.org/dist/v${NODE_VERSION}/${node_directory}.tar.xz"
  curl --fail --location --proto '=https' --tlsv1.2 -O "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"
  grep " ${node_directory}.tar.xz$" SHASUMS256.txt | sha256sum --check --strict -
  tar -xJf "${node_directory}.tar.xz" -C /opt
  ln -sfn "${install_directory}/bin/node" /usr/local/bin/node
  ln -sfn "${install_directory}/bin/npm" /usr/local/bin/npm
  ln -sfn "${install_directory}/bin/npx" /usr/local/bin/npx
  node --version
  # Gestor de paquetes pnpm (misma versión que el monorepo) y, en el backend, PM2 como gestor de procesos.
  "${install_directory}/bin/npm" install -g pnpm@10.32.1
  ln -sfn "${install_directory}/bin/pnpm" /usr/local/bin/pnpm
  pnpm --version
  if [ "$IMAGE_ROLE" = backend ]; then
    "${install_directory}/bin/npm" install -g pm2@6
    ln -sfn "${install_directory}/bin/pm2" /usr/local/bin/pm2
    pm2 --version
  fi
  # La imagen contiene runtime, no código ni dependencias particulares de la app.
fi
install -d -m 0755 /etc/campus-cloud
python3 - <<'PY'
import json, os, subprocess
from pathlib import Path
data = {key.lower(): os.environ[key] for key in ('IMAGE_ROLE', 'IMAGE_VERSION', 'SOURCE_REVISION')}
data['packages'] = subprocess.check_output(['dpkg-query', '-W', '-f=${Package}=${Version}\n'], text=True).splitlines()
Path('/etc/campus-cloud/image.json').write_text(json.dumps(data, indent=2))
PY
