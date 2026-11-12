packer {
  required_version = ">= 1.14.0, < 2.0.0"
  required_plugins {
    amazon = {
      source  = "github.com/hashicorp/amazon"
      version = ">= 1.3.0, < 2.0.0"
    }
  }
}

variable "role" {
  type = string
  validation {
    condition     = contains(["frontend", "backend", "database"], var.role)
    error_message = "Elegir frontend, backend o database."
  }
}
variable "region" {
  type    = string
  default = "us-east-1"
}
variable "source_ami" {
  type = string
  validation {
    condition     = can(regex("^ami-[a-f0-9]{17}$", var.source_ami))
    error_message = "Proporcionar una AMI Ubuntu 24.04 amd64 real de la región seleccionada."
  }
}
variable "subnet_id" {
  type = string
}
variable "vpc_id" {
  type = string
}
variable "ssh_source_cidr" {
  type = string
  validation {
    condition     = can(cidrhost(var.ssh_source_cidr, 0)) && can(regex("^[0-9.]+/32$", var.ssh_source_cidr))
    error_message = "Usar únicamente la IP pública de salida del constructor con máscara /32."
  }
}
variable "image_version" {
  type    = string
  default = "0.1.0"
  validation {
    condition     = can(regex("^[0-9]+\\.[0-9]+\\.[0-9]+$", var.image_version))
    error_message = "Usar versión semántica, por ejemplo 0.1.0."
  }
}
variable "source_revision" {
  type = string
  validation {
    condition     = can(regex("^[a-f0-9]{7,40}$", var.source_revision))
    error_message = "Proporcionar el commit del monorepo (7 a 40 caracteres hexadecimales)."
  }
}
variable "node_version" {
  type    = string
  default = "22.18.0"
  validation {
    condition     = can(regex("^22\\.[0-9]+\\.[0-9]+$", var.node_version))
    error_message = "Usar una versión exacta de Node 22."
  }
}
variable "build_id" {
  type    = string
  default = "manual"
  validation {
    condition     = can(regex("^[a-z0-9-]{3,32}$", var.build_id))
    error_message = "Usar identificador de ejecución de 3 a 32 letras minúsculas, números o guiones."
  }
}

source "amazon-ebs" "tenant" {
  region                                = var.region
  source_ami                            = var.source_ami
  instance_type                         = "t3.small"
  ssh_username                          = "ubuntu"
  ssh_timeout                           = "10m"
  vpc_id                                = var.vpc_id
  subnet_id                             = var.subnet_id
  associate_public_ip_address           = true
  temporary_security_group_source_cidrs = [var.ssh_source_cidr]
  ssh_clear_authorized_keys             = true
  ami_name                              = "modulo2-${var.role}-${var.image_version}-${var.build_id}-{{timestamp}}"
  ami_description                       = "Imagen academica ${var.role}; sin credenciales ni datos de tenants."
  encrypt_boot                          = true
  imds_support                          = "v2.0"
  source_ami_filter {
    filters = {
      name                = "ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"
      architecture        = "x86_64"
      virtualization-type = "hvm"
      root-device-type    = "ebs"
    }
    owners = ["099720109477"]
  }
  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }
  launch_block_device_mappings {
    device_name           = "/dev/sda1"
    volume_size           = 12
    volume_type           = "gp3"
    encrypted             = true
    delete_on_termination = true
  }
  tags = {
    Project        = "proyecto-modulo-2"
    Role           = var.role
    ImageVersion   = var.image_version
    SourceRevision = var.source_revision
    MemberId       = "integrante-1"
    RunId          = var.build_id
  }
  run_tags = {
    Project  = "proyecto-modulo-2"
    Purpose  = "packer-build"
    MemberId = "integrante-1"
    RunId    = var.build_id
  }
}

build {
  name    = "tenant-image"
  sources = ["source.amazon-ebs.tenant"]
  provisioner "shell" {
    environment_vars = ["IMAGE_ROLE=${var.role}", "IMAGE_VERSION=${var.image_version}", "SOURCE_REVISION=${var.source_revision}", "NODE_VERSION=${var.node_version}"]
    execute_command  = "sudo -E env {{ .Vars }} bash -eux '{{ .Path }}'"
    script           = "${path.root}/scripts/provision.sh"
  }
  provisioner "shell" {
    execute_command = "sudo bash -eu '{{ .Path }}'"
    script          = "${path.root}/scripts/cleanup.sh"
  }
  post-processor "manifest" {
    output     = "manifest-${var.role}.json"
    strip_path = true
    custom_data = {
      role            = var.role
      image_version   = var.image_version
      source_revision = var.source_revision
      source_ami      = var.source_ami
    }
  }
}
