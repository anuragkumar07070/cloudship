#!/bin/bash
# Stops the instance - compute billing stops immediately, only EBS storage keeps billing.
set -euo pipefail

INSTANCE_ID=$(terraform output -raw instance_id)
echo "Stopping instance $INSTANCE_ID ..."
aws ec2 stop-instances --instance-ids "$INSTANCE_ID" >/dev/null
echo "Stop requested. It'll take a few seconds to fully stop."