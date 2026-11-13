# ProvisioningResult (contrato de packages/contracts). Sin contraseñas ni claves.

output "provisioning_result" {
  description = "ProvisioningResult (schema_version 1)."
  value = {
    schema_version = 1
    request_id     = var.request_id
    tenant_slug    = local.slug
    engine         = var.engine
    region         = var.region
    nodes = {
      for role, node in aws_instance.node : role => {
        instance_id = node.id
        image_id    = node.ami
        private_ip  = node.private_ip
        public_ip   = role == "frontend" ? node.public_ip : null
      }
    }
    network = {
      vpc_id             = aws_vpc.tenant.id
      subnet_ids         = [aws_subnet.public.id, aws_subnet.private.id]
      security_group_ids = [for role in ["frontend", "backend", "database"] : local.security_groups[role]]
    }
    state_reference = var.state_reference
  }
}

output "access_url" {
  description = "URL del tenant (IP pública del frontend). Cambia tras stop/start."
  value       = "http://${aws_instance.node["frontend"].public_ip}"
}

output "inventory_path" {
  value = abspath(local_file.inventory.filename)
}
