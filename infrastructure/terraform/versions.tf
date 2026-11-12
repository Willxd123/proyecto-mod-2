# Raíz Terraform del motor principal. La lógica está en modules/tenant (compartida con OpenTofu).
terraform {
  required_version = ">= 1.7.0"

  # Estado local por tenant: scripts/terraform_tenant.py pasa -backend-config=path=state/<tenant>/terraform.tfstate
  backend "local" {}

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.5"
    }
  }
}

locals {
  # try(): si la solicitud es inválida, el error claro lo da la validación del módulo.
  request = try(jsondecode(file(var.request_file)), {})
}

provider "aws" {
  region = try(local.request.region, "us-east-1")

  # Ninguna operación se ejecuta si las credenciales pertenecen a otra cuenta.
  allowed_account_ids = [var.expected_account_id]

  default_tags {
    tags = {
      Project   = "proyecto-modulo-2"
      MemberId  = var.member_id
      TenantId  = try(local.request.tenant_slug, "invalido")
      RunId     = try(local.request.request_id, "invalido")
      Plan      = try(local.request.plan_snapshot.slug, "invalido")
      ManagedBy = try(local.request.engine, "invalido")
    }
  }
}
