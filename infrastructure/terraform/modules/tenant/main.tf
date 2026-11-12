# Motor principal (integrante 2): un tenant = una VPC, tres security groups y tres EC2
# creadas desde las Golden AMIs del integrante 1. Todo se deriva del DeploymentRequest;
# los tamaños vienen de plan_snapshot (config/plans.json), no se repiten aquí.

locals {
  request     = jsondecode(file(var.request_file))
  request_dir = dirname(var.request_file)
  roles       = toset(["frontend", "backend", "database"])
  slug        = local.request.tenant_slug
  plan        = local.request.plan_snapshot

  tags = {
    Project   = "proyecto-modulo-2"
    MemberId  = var.member_id
    TenantId  = local.slug
    RunId     = local.request.request_id
    Plan      = local.plan.slug
    ManagedBy = local.request.engine
  }

  instance_types = distinct([for role in local.roles : local.plan.roles[role].instance_type])

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
    values = [local.request.images[each.key].ami_id]
  }

  lifecycle {
    postcondition {
      condition     = self.state == "available" && self.architecture == "x86_64"
      error_message = "La Golden AMI del rol ${each.key} no está disponible o no es x86_64."
    }
  }
}
