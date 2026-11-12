# Motor principal (integrante 2): un tenant = una VPC, tres security groups y tres EC2
# creadas desde las Golden AMIs del integrante 1, con el tamaño del plan elegido.

locals {
  roles = toset(["frontend", "backend", "database"])
  slug  = var.tenant_id

  # Los 3 AMI IDs de Packer, uno por rol.
  ami_ids = {
    frontend = var.frontend_ami_id
    backend  = var.backend_ami_id
    database = var.database_ami_id
  }

  tags = {
    Project   = "proyecto-modulo-2"
    MemberId  = var.member_id
    TenantId  = var.tenant_id
    RunId     = var.request_id != "" ? var.request_id : var.tenant_id
    Plan      = var.plan_type
    ManagedBy = var.engine
  }

  # cloud-init del integrante 1 (infrastructure/cloud-init/<rol>.yaml.tmpl): hostname <tenant>-<rol>,
  # zona America/La_Paz, swap 2 GiB y SSH solo por llave. Se normalizan saltos de línea a LF.
  ssh_keys_block = length(var.ssh_authorized_keys) > 0 ? "ssh_authorized_keys:\n${join("", [for k in var.ssh_authorized_keys : "  - ${jsonencode(k)}\n"])}" : ""
  user_data = {
    for role in local.roles : role => replace(
      replace(replace(file("${path.module}/../../../cloud-init/${role}.yaml.tmpl"), "\r\n", "\n"), "__TENANT_SLUG__", var.tenant_id),
      "__SSH_AUTHORIZED_KEYS__\n", local.ssh_keys_block
    )
  }

  instance_types = distinct([for role in local.roles : var.plan_capacity[role].instance_type])

  # Zona que ofrece todos los tipos de instancia del plan (t3 no existe en todas las zonas).
  offered_pairs = toset([
    for i, zone in data.aws_ec2_instance_type_offerings.plan.locations :
    "${zone}|${data.aws_ec2_instance_type_offerings.plan.instance_types[i]}"
  ])
  candidate_zones = sort([
    for zone in distinct(data.aws_ec2_instance_type_offerings.plan.locations) : zone
    if alltrue([for type in local.instance_types : contains(local.offered_pairs, "${zone}|${type}")])
  ])
  availability_zone = var.availability_zone != "" ? var.availability_zone : try(local.candidate_zones[0], "")

  inventory_root = var.inventory_dir != "" ? var.inventory_dir : "${path.root}/../../inventories"
}

data "aws_ec2_instance_type_offerings" "plan" {
  location_type = "availability-zone"

  filter {
    name   = "instance-type"
    values = local.instance_types
  }
}

# Cada AMI debe existir en la cuenta y región, estar disponible y ser x86_64.
data "aws_ami" "golden" {
  for_each = local.roles
  owners   = ["self"]

  filter {
    name   = "image-id"
    values = [local.ami_ids[each.key]]
  }

  lifecycle {
    postcondition {
      condition     = self.state == "available" && self.architecture == "x86_64"
      error_message = "La Golden AMI del rol ${each.key} no está disponible o no es x86_64."
    }
  }
}
