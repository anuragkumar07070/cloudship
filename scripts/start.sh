#!/bin/bash
# Starts the instance, waits for it to get a public IP, prints the dashboard URL.
set -euo pipefail

INSTANCE_ID=$(terraform output -raw instance_id)
echo "Starting instance $INSTANCE_ID ..."
aws ec2 start-instances --instance-ids "$INSTANCE_ID" >/dev/null
aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"

IP=$(aws ec2 describe-instances \
  --instance-ids "$INSTANCE_ID" \
  --query "Reservations[0].Instances[0].PublicIpAddress" \
  --output text)

NIP_URL="http://$(echo "$IP" | tr '.' '-').nip.io:4000"
echo "Instance is running at $IP"
echo "Dashboard (give it ~30-60s to finish booting CloudShip): $NIP_URL"