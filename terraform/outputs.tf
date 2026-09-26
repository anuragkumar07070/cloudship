output "instance_id" {
  description = "EC2 instance ID - used by the start/stop/url helper scripts"
  value       = aws_instance.cloudship.id
}

output "public_ip" {
  description = "Public IP at apply time. This CHANGES every stop/start since there's no Elastic IP. Use scripts/get_url.sh to fetch the current one."
  value       = aws_instance.cloudship.public_ip
}

output "nip_io_url_at_apply" {
  description = "CloudShip dashboard URL right now. Will go stale after a stop/start - re-run scripts/get_url.sh then."
  value       = "http://${replace(aws_instance.cloudship.public_ip, ".", "-")}.nip.io:4000"
}

output "ssh_command" {
  description = "SSH command — uses the private key matching the public key you pointed public_key_path at"
  value       = "ssh -i <path-to-your-private-key> ec2-user@${aws_instance.cloudship.public_ip}"
}
