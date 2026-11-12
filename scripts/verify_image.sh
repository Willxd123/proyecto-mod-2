#!/usr/bin/env bash
set -euo pipefail
role="$1"
tenant="$2"
case "$role" in frontend|backend|database) ;; *) exit 2 ;; esac
cloud-init status --wait
test "$(hostname)" = "${tenant}-${role}"
test "$(timedatectl show -p Timezone --value)" = America/La_Paz
test -f /etc/campus-cloud/image.json
test -f /etc/campus-cloud/tenant.env
swapon --show=NAME --noheadings | grep -q /swapfile
test -s /etc/ssh/ssh_host_ed25519_key.pub
curl --fail --silent http://127.0.0.1:9100/metrics -o /tmp/node-metrics-verify.txt
grep -q node_exporter_build_info /tmp/node-metrics-verify.txt
case "$role" in
  frontend) nginx -t; curl --fail --silent http://127.0.0.1/ -o /dev/null; node --version; pnpm --version ;;
  backend) python3 --version; python3 -m venv /tmp/verify-venv; node --version; pnpm --version; pm2 --version; gunicorn --version; psql --version; git --version ;;
  database) sudo -u postgres psql -tAc 'SELECT 1' | grep -q 1; pg_dump --version; openssl version ;;
esac
printf 'role=%s checks=passed\n' "$role"
