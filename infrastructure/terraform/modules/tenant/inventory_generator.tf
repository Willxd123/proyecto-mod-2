# Genera inventories/<tenant_id>/hosts.ini al terminar el apply, para Ansible (integrante 4).
# Backend y base de datos se alcanzan por el frontend (bastión) con ProxyCommand.

resource "local_file" "inventory" {
  filename        = "${local.inventory_root}/${local.slug}/hosts.ini"
  file_permission = "0600"
  # Siempre LF: Ansible en Linux no tolera retornos de carro en las variables del inventario.
  content = replace(templatefile("${path.module}/templates/inventory.tftpl", {
    tenant_slug          = local.slug
    plan_slug            = var.plan_type
    region               = var.region
    backend_port         = var.backend_port
    ssh_private_key_path = var.ssh_private_key_path
    frontend_public_ip   = aws_instance.node["frontend"].public_ip
    frontend_private_ip  = aws_instance.node["frontend"].private_ip
    backend_private_ip   = aws_instance.node["backend"].private_ip
    database_private_ip  = aws_instance.node["database"].private_ip
  }), "\r\n", "\n")
}
