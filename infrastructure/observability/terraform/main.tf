terraform {
  required_version = ">= 1.9.0, < 2.0.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}

# ── AMI generada por Packer ───────────────────────────────────────────────────

data "aws_ami" "observabilidad" {
  most_recent = true
  owners      = ["self"]

  filter {
    name   = "name"
    values = ["modulo2-observabilidad-*"]
  }

  filter {
    name   = "tag:Project"
    values = ["proyecto-modulo-2"]
  }
}

# ── Key pair ──────────────────────────────────────────────────────────────────

resource "aws_key_pair" "observabilidad" {
  key_name   = "modulo2-observabilidad"
  public_key = file("${path.module}/../../../globomatics.pub")

  tags = {
    Project  = "proyecto-modulo-2"
    MemberId = "integrante-6"
  }
}

# ── Security group ────────────────────────────────────────────────────────────

resource "aws_security_group" "observabilidad" {
  name        = "modulo2-observabilidad"
  description = "Observabilidad: Grafana y Prometheus accesibles solo desde mi IP"
  vpc_id      = var.vpc_id

  ingress {
    description = "Grafana"
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = [var.my_ip]
  }

  ingress {
    description = "Prometheus"
    from_port   = 9090
    to_port     = 9090
    protocol    = "tcp"
    cidr_blocks = [var.my_ip]
  }

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.my_ip]
  }

  egress {
    description = "Salida total"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Project  = "proyecto-modulo-2"
    Role     = "observabilidad"
    MemberId = "integrante-6"
  }
}

# ── Instancia EC2 ─────────────────────────────────────────────────────────────

resource "aws_instance" "observabilidad" {
  ami                    = data.aws_ami.observabilidad.id
  instance_type          = var.instance_type
  subnet_id              = var.subnet_id
  vpc_security_group_ids = [aws_security_group.observabilidad.id]
  key_name               = aws_key_pair.observabilidad.key_name

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = 16
    encrypted             = true
    delete_on_termination = true
  }

  tags = {
    Project  = "proyecto-modulo-2"
    Role     = "observabilidad"
    ImageId  = data.aws_ami.observabilidad.id
    MemberId = "integrante-6"
    Name     = "modulo2-observabilidad"
  }
}

# ── IP elástica ───────────────────────────────────────────────────────────────

resource "aws_eip" "observabilidad" {
  instance = aws_instance.observabilidad.id
  domain   = "vpc"

  tags = {
    Project  = "proyecto-modulo-2"
    MemberId = "integrante-6"
  }
}
