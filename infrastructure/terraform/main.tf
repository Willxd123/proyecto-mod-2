# Un tenant por workspace. Todas las variables se validan dentro del módulo.

# Candado: el workspace activo debe llamarse igual que el tenant, para que los datos de un tenant
# nunca se apliquen sobre el estado de otro.
resource "terraform_data" "workspace_guard" {
  input = var.tenant_id

  lifecycle {
    precondition {
      condition     = terraform.workspace == var.tenant_id
      error_message = "El workspace activo (${terraform.workspace}) no coincide con tenant_id (${var.tenant_id}). Ejecute: terraform workspace select -or-create ${var.tenant_id}"
    }
  }
}

module "tenant" {
  source = "./modules/tenant"

  tenant_id             = var.tenant_id
  tenant_name           = var.tenant_name
  plan_type             = var.plan_type
  plan_capacity         = var.plan_capacity
  region                = var.region
  frontend_ami_id       = var.frontend_ami_id
  backend_ami_id        = var.backend_ami_id
  database_ami_id       = var.database_ami_id
  engine                = var.engine
  request_id            = var.request_id
  key_pair_name         = var.key_pair_name
  ssh_authorized_keys   = var.ssh_authorized_keys
  member_id             = var.member_id
  ssh_ingress_cidrs     = var.ssh_ingress_cidrs
  monitoring_cidrs      = var.monitoring_cidrs
  backend_port          = var.backend_port
  enable_frontend_https = var.enable_frontend_https
  vpc_cidr              = var.vpc_cidr
  availability_zone     = var.availability_zone
  enable_nat_gateway    = var.enable_nat_gateway
  inventory_dir         = var.inventory_dir
  ssh_private_key_path  = var.ssh_private_key_path
  state_reference       = var.state_reference
}

output "provisioning_result" {
  value = module.tenant.provisioning_result
}

output "access_url" {
  value = module.tenant.access_url
}

output "inventory_path" {
  value = module.tenant.inventory_path
}
