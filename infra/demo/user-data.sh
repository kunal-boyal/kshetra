#!/bin/bash
# The demo instance's first boot (decision D70): Docker with Compose, 2 GB of swap beside the
# instance's 2 GB of memory, and the folder demo.sh deploys into.
set -euo pipefail

dnf install -y docker
mkdir -p /usr/local/lib/docker/cli-plugins
curl -fsSL "https://github.com/docker/compose/releases/download/v5.6.1/docker-compose-linux-aarch64" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
systemctl enable --now docker

if [[ ! -f /swapfile ]]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

mkdir -p /opt/thelamp
