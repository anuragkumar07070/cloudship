variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "ap-south-1" # Mumbai — lowest latency for India
}

variable "project_name" {
  description = "Name prefix for all resources"
  type        = string
  default     = "cloudship"
}

variable "instance_type" {
  description = "EC2 instance type. t3a.medium (4GB RAM) gives comfortable headroom for Docker builds + Node + the proxy running together. Not free-tier eligible, but still cheap at 30 min/day."
  type        = string
  default     = "t3a.medium"
}

variable "root_volume_size_gb" {
  description = "Root EBS volume size in GB (holds Docker images, deployment workspaces, and the SQLite db)"
  type        = number
  default     = 15
}

variable "allowed_admin_cidr" {
  description = "CIDR allowed to reach SSH (22) and the CloudShip dashboard (4000). Set this to YOUR_IP/32, not 0.0.0.0/0 - find your IP at https://checkip.amazonaws.com"
  type        = string
}

variable "github_repo_url" {
  description = "Git URL of your CloudShip repo (push your code here first, e.g. https://github.com/you/cloudship.git)"
  type        = string
}

variable "public_key_path" {
  description = "Path to your SSH PUBLIC key file. Generate one with: ssh-keygen -t ed25519 -f ~/.ssh/cloudship-key -C cloudship  (then point this at ~/.ssh/cloudship-key.pub). Terraform never sees your private key."
  type        = string
  default     = "~/.ssh/cloudship-key.pub"
}

variable "subnet_id" {
  description = "Subnet where CloudShip EC2 will run"
  type        = string
}