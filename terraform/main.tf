terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# ---------------------------------------------------------------------------
# SSH key pair — you generate this yourself (ssh-keygen), Terraform only ever
# sees the PUBLIC key. This avoids putting a private key inside terraform.tfstate.
#
#   ssh-keygen -t ed25519 -f ~/.ssh/cloudship-key -C "cloudship"
#
# then point public_key_path (in variables.tf) at ~/.ssh/cloudship-key.pub
# ---------------------------------------------------------------------------
resource "aws_key_pair" "this" {
  key_name   = "${var.project_name}-key"
  public_key = file(pathexpand(var.public_key_path))
}

# ---------------------------------------------------------------------------
# Security group: SSH + dashboard restricted to you, HTTP open for deployed apps
# ---------------------------------------------------------------------------
resource "aws_security_group" "this" {
  name        = "${var.project_name}-sg"
  description = "CloudShip host - SSH/dashboard restricted, HTTP public"

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.allowed_admin_cidr]
  }

  ingress {
    description = "CloudShip dashboard"
    from_port   = 4000
    to_port     = 4000
    protocol    = "tcp"
    cidr_blocks = [var.allowed_admin_cidr]
  }

  ingress {
    description = "HTTP - deployed apps via nginx proxy"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project_name}-sg" }
}

# ---------------------------------------------------------------------------
# EC2 instance
# ---------------------------------------------------------------------------
resource "aws_instance" "cloudship" {
  ami                    = "ami-0cad00db27cb1bcc2"
  instance_type          = var.instance_type
  key_name               = aws_key_pair.this.key_name
  subnet_id              = var.subnet_id
  vpc_security_group_ids = [aws_security_group.this.id]

  root_block_device {
    volume_size = var.root_volume_size_gb
    volume_type = "gp3"
  }

  user_data = templatefile("${path.module}/user_data.sh.tpl", {
    github_repo_url = var.github_repo_url
  })

  tags = { Name = var.project_name }
}
