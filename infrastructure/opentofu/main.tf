# Un tenant por estado. Todas las variables se validan dentro del módulo.
module "tenant" {
  source = "../terraform/modules/tenant"

  request_file         = var.request_file
  expected_account_id  = var.expected_account_id
  member_id            = var.member_id
  ssh_ingress_cidrs    = var.ssh_ingress_cidrs
  monitoring_cidrs     = var.monitoring_cidrs
  backend_port         = var.backend_port
  vpc_cidr             = var.vpc_cidr
  availability_zone    = var.availability_zone
  enable_nat_gateway   = var.enable_nat_gateway
  inventory_dir        = var.inventory_dir
  ssh_private_key_path = var.ssh_private_key_path
  state_reference      = var.state_reference
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
