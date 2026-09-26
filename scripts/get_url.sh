#!/bin/bash
# Prints the current dashboard URL for an already-running instance.
set -euo pipefail

INSTANCE_ID=$(terraform output -raw instance_id)
IP=$(aws ec2 describe-instances \
  --instance-ids "$INSTANCE_ID" \
  --query "Reservations[0].Instances[0].PublicIpAddress" \
  --output text)

if [ "$IP" == "None" ]; then
  echo "Instance is stopped. Run scripts/start.sh first."
  exit 1
fi

echo "http://$(echo "$IP" | tr '.' '-').nip.io:4000"