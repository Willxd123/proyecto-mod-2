#!/usr/bin/env bash
set -euo pipefail
# Solo se ejecuta en la VM temporal de Packer, nunca en el equipo del desarrollador.
apt-get clean
find /var/lib/apt/lists -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
find /tmp /var/tmp -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
find /root /home/ubuntu -type f \( -name '.bash_history' -o -name 'authorized_keys' \) -delete
find /etc/ssh -maxdepth 1 -type f -name 'ssh_host_*' -delete
cloud-init clean --logs --machine-id
