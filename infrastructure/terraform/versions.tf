# Raíz Terraform del motor principal. La lógica está en modules/tenant (compartida con OpenTofu).
terraform {
  required_version = ">= 1.7.0"

  # Estado aislado por tenant con workspaces: terraform workspace new <tenant_id>.
  # Backend local: cada workspace guarda su estado en terraform.tfstate.d/<tenant_id>/ (ignorado por Git).
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

provider "aws" {
  region = var.region

  # Ninguna operación se ejecuta si las credenciales pertenecen a otra cuenta.
  allowed_account_ids = [var.expected_account_id]

  default_tags {
    tags = {
      Project   = "proyecto-modulo-2"
      MemberId  = var.member_id
      TenantId  = var.tenant_id
      RunId     = var.request_id != "" ? var.request_id : var.tenant_id
      Plan      = var.plan_type
      ManagedBy = var.engine
    }
  }
}
