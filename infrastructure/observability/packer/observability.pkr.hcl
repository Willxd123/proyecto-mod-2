packer {
  required_version = ">= 1.14.0, < 2.0.0"
  required_plugins {
    amazon = {
      source  = "github.com/hashicorp/amazon"
      version = ">= 1.3.0, < 2.0.0"
    }
    ansible = {
      source  = "github.com/hashicorp/ansible"
      version = ">= 1.1.0, < 2.0.0"
    }
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
  default = "1.0.0"
  validation {
    condition     = can(regex("^[0-9]+\\.[0-9]+\\.[0-9]+$", var.image_version))
    error_message = "Usar versión semántica, por ejemplo 1.0.0."
  }
}

variable "source_revision" {
  type = string
  validation {
    condition     = can(regex("^[a-f0-9]{7,40}$", var.source_revision))
    error_message = "Proporcionar el commit del monorepo (7 a 40 caracteres hexadecimales)."
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

variable "prometheus_version" {
  type    = string
  default = "2.54.1"
}

variable "grafana_version" {
  type    = string
  default = "11.2.0"
}

source "amazon-ebs" "observability" {
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
  ami_name                              = "modulo2-observabilidad-${var.image_version}-${var.build_id}-{{timestamp}}"
  ami_description                       = "Imagen academica observabilidad (Prometheus + Grafana); sin credenciales ni datos de tenants."
  encrypt_boot                          = true
  imds_support                          = "v2.0"
  source_ami_filter {
    filters = {
      name                = "ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"
      architecture        = "x86_64"
      virtualization-type = "hvm"
      root-device-type    = "ebs"
    }
    owners      = ["099720109477"]
    most_recent = true
  }
  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }
  launch_block_device_mappings {
    device_name           = "/dev/sda1"
    volume_size           = 16
    volume_type           = "gp3"
    encrypted             = true
    delete_on_termination = true
  }
  tags = {
    Project        = "proyecto-modulo-2"
    Role           = "observabilidad"
    ImageVersion   = var.image_version
    SourceRevision = var.source_revision
    MemberId       = "integrante-6"
    RunId          = var.build_id
    Monitoreo      = "prometheus,grafana,node-exporter"
  }
  run_tags = {
    Project  = "proyecto-modulo-2"
    Purpose  = "packer-build"
    MemberId = "integrante-6"
    RunId    = var.build_id
  }
}

build {
  name    = "observability-image"
  sources = ["source.amazon-ebs.observability"]

  # Paso 1: instalar Ansible y prometheus-node-exporter dentro de la instancia
  provisioner "shell" {
    environment_vars = ["DEBIAN_FRONTEND=noninteractive"]
    inline = [
      "cloud-init status --wait || true",
      "sudo apt-get update -q",
      "sudo apt-get install -y -q software-properties-common prometheus-node-exporter",
      "sudo add-apt-repository --yes --update ppa:ansible/ansible",
      "sudo apt-get install -y -q ansible",
      "ansible --version",
    ]
  }

  # Paso 2: Ansible instala Prometheus, Grafana y node_exporter
  provisioner "ansible-local" {
    playbook_file = "${path.root}/ansible/observability.yml"
    playbook_dir  = "${path.root}/ansible"
    extra_arguments = [
      "--extra-vars",
      "prometheus_version=${var.prometheus_version}",
      "--extra-vars",
      "grafana_version=${var.grafana_version}",
    ]
  }

  # Paso 3: limpiar Ansible de la imagen final
  provisioner "shell" {
    environment_vars = ["DEBIAN_FRONTEND=noninteractive"]
    inline = [
      "sudo apt-get purge -y ansible ansible-core 2>/dev/null || true",
      "sudo apt-get autoremove -y -q",
      "sudo rm -rf /tmp/* /var/tmp/*",
      "sudo truncate -s 0 /etc/machine-id",
    ]
  }

  post-processor "manifest" {
    output     = "manifest-observability.json"
    strip_path = true
    custom_data = {
      role               = "observabilidad"
      image_version      = var.image_version
      source_revision    = var.source_revision
      prometheus_version = var.prometheus_version
      grafana_version    = var.grafana_version
    }
  }
}
