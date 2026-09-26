#!/bin/bash
set -euxo pipefail

# --- System packages -------------------------------------------------------
dnf update -y
dnf install -y docker git

systemctl enable docker
systemctl start docker
usermod -aG docker ec2-user

# Docker Compose v2 plugin (needed for repos that ship docker-compose.yml)
mkdir -p /usr/local/lib/docker/cli-plugins
curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64" \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# Node.js 20.x
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
dnf install -y nodejs

# --- Fetch and build CloudShip ---------------------------------------------
mkdir -p /opt/cloudship
cd /opt/cloudship
git clone "${github_repo_url}" app
cd app
npm ci
npm --prefix dashboard ci
npm run build:dashboard
mkdir -p data workspace
chown -R ec2-user:ec2-user /opt/cloudship

# --- Startup wrapper: figures out the current public IP on every boot ------
# This is what makes the nip.io URL "just work" again after every stop/start,
# without you having to edit any config by hand.
cat > /opt/cloudship/app/start.sh <<'SCRIPT'
#!/bin/bash
set -e
cd /opt/cloudship/app

# IMDSv2: get a session token first, then use it to read metadata.
# (IMDSv1 - a plain curl with no token - still works but is the deprecated,
# less secure pattern; this is the current AWS-recommended approach.)
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
PUBLIC_IP=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" \
  http://169.254.169.254/latest/meta-data/public-ipv4)
NIP_DOMAIN=$(echo "$PUBLIC_IP" | tr '.' '-').nip.io

export PORT=4000
export CLOUDSHIP_BASE_DOMAIN="$NIP_DOMAIN"
export CLOUDSHIP_WORKSPACE=/opt/cloudship/app/workspace
export CLOUDSHIP_DB=/opt/cloudship/app/data/cloudship.db
export CLOUDSHIP_PROXY_DIR=/opt/cloudship/app/data/proxy
export CLOUDSHIP_LOG_DIR=/opt/cloudship/app/data/logs

echo "CloudShip starting - dashboard at http://$NIP_DOMAIN:4000"
exec node src/server.js
SCRIPT
chmod +x /opt/cloudship/app/start.sh
chown ec2-user:ec2-user /opt/cloudship/app/start.sh

# --- systemd service ---------------------------------------------------------
cat > /etc/systemd/system/cloudship.service <<'EOF'
[Unit]
Description=CloudShip
After=docker.service network-online.target
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
User=ec2-user
Group=docker
WorkingDirectory=/opt/cloudship/app
ExecStart=/opt/cloudship/app/start.sh
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable cloudship
systemctl start cloudship
