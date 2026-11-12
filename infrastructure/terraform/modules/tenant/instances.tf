# Tres servidores por tenant desde las Golden AMIs (RF-09). Tipo y disco salen del plan elegido.

resource "aws_instance" "node" {
  for_each = local.roles

  ami                         = data.aws_ami.golden[each.key].id
  instance_type               = local.plan.roles[each.key].instance_type
  subnet_id                   = each.key == "frontend" ? aws_subnet.public.id : aws_subnet.private.id
  vpc_security_group_ids      = [local.security_groups[each.key]]
  associate_public_ip_address = each.key == "frontend"
  key_name                    = local.request.key_pair_name

  # cloud-init del integrante 1 (hostname, zona horaria, swap, SSH). Solo se aplica en el primer arranque.
  user_data = file("${local.request_dir}/${basename(local.request.user_data[each.key])}")

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required" # IMDSv2
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = local.plan.roles[each.key].disk_gib
    encrypted             = true
    delete_on_termination = true
    tags                  = merge(local.tags, { Name = "${local.slug}-${each.key}-root", Role = each.key })
  }

  tags = { Name = "${local.slug}-${each.key}", Role = each.key }

  lifecycle {
    # Cambiar el user-data después del primer arranque no tiene efecto y forzaría un stop/start.
    ignore_changes = [user_data]
  }

  depends_on = [aws_route_table_association.public, aws_route_table_association.private]
}
