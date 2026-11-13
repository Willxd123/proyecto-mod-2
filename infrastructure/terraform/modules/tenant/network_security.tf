# Red exclusiva del tenant: subred pública (frontend/bastión) y subred privada
# (backend y base de datos, sin IP pública).

resource "aws_vpc" "tenant" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "${local.slug}-vpc" }

  lifecycle {
    precondition {
      condition     = local.availability_zone != ""
      error_message = "Ninguna zona de la región ofrece todos los tipos de instancia del plan."
    }
  }
}

# El security group por defecto queda sin reglas: nada usa acceso implícito.
resource "aws_default_security_group" "closed" {
  vpc_id = aws_vpc.tenant.id
  tags   = { Name = "${local.slug}-default-closed" }
}

resource "aws_internet_gateway" "tenant" {
  vpc_id = aws_vpc.tenant.id
  tags   = { Name = "${local.slug}-igw" }
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.tenant.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, 1)
  availability_zone       = local.availability_zone
  map_public_ip_on_launch = false
  tags                    = { Name = "${local.slug}-public", Tier = "public" }
}

resource "aws_subnet" "private" {
  vpc_id                  = aws_vpc.tenant.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, 2)
  availability_zone       = local.availability_zone
  map_public_ip_on_launch = false
  tags                    = { Name = "${local.slug}-private", Tier = "private" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.tenant.id
  tags   = { Name = "${local.slug}-public-rt" }

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.tenant.id
  }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# Sin NAT, la subred privada no tiene ruta a internet (solo tráfico interno de la VPC).
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.tenant.id
  tags   = { Name = "${local.slug}-private-rt" }
}

resource "aws_route_table_association" "private" {
  subnet_id      = aws_subnet.private.id
  route_table_id = aws_route_table.private.id
}

resource "aws_eip" "nat" {
  count      = var.enable_nat_gateway ? 1 : 0
  domain     = "vpc"
  depends_on = [aws_internet_gateway.tenant]
  tags       = { Name = "${local.slug}-nat-eip" }
}

resource "aws_nat_gateway" "tenant" {
  count         = var.enable_nat_gateway ? 1 : 0
  allocation_id = aws_eip.nat[0].id
  subnet_id     = aws_subnet.public.id
  tags          = { Name = "${local.slug}-nat" }
}

resource "aws_route" "private_nat" {
  count                  = var.enable_nat_gateway ? 1 : 0
  route_table_id         = aws_route_table.private.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.tenant[0].id
}
# Security groups encadenados:
#   internet --80--> frontend --backend_port--> backend --5432--> database
#   SSH: operador --22--> frontend (bastión) --22--> backend / database
# PostgreSQL nunca acepta tráfico desde internet.

resource "aws_security_group" "frontend" {
  name        = "${local.slug}-frontend"
  description = "Frontend del tenant ${local.slug}: HTTP publico y SSH restringido"
  vpc_id      = aws_vpc.tenant.id
  tags        = { Name = "${local.slug}-frontend-sg", Role = "frontend" }
}

resource "aws_security_group" "backend" {
  name        = "${local.slug}-backend"
  description = "Backend del tenant ${local.slug}: API solo desde el frontend"
  vpc_id      = aws_vpc.tenant.id
  tags        = { Name = "${local.slug}-backend-sg", Role = "backend" }
}

resource "aws_security_group" "database" {
  name        = "${local.slug}-database"
  description = "Base de datos del tenant ${local.slug}: 5432 solo desde el backend"
  vpc_id      = aws_vpc.tenant.id
  tags        = { Name = "${local.slug}-database-sg", Role = "database" }
}

locals {
  security_groups = {
    frontend = aws_security_group.frontend.id
    backend  = aws_security_group.backend.id
    database = aws_security_group.database.id
  }
  exporter_ports = { frontend = [9100], backend = [9100], database = [9100, 9187] }
  monitoring_rules = merge([
    for role, ports in local.exporter_ports : {
      for pair in setproduct(ports, var.monitoring_cidrs) : "${role}-${pair[0]}-${pair[1]}" => {
        role = role, port = pair[0], cidr = pair[1]
      }
    }
  ]...)
}

# --- Frontend ---
resource "aws_vpc_security_group_ingress_rule" "frontend_http" {
  security_group_id = aws_security_group.frontend.id
  description       = "HTTP publico de la aplicacion"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "frontend_https" {
  count             = var.enable_frontend_https ? 1 : 0
  security_group_id = aws_security_group.frontend.id
  description       = "HTTPS publico de la aplicacion"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "frontend_ssh" {
  for_each          = toset(var.ssh_ingress_cidrs)
  security_group_id = aws_security_group.frontend.id
  description       = "SSH del operador"
  ip_protocol       = "tcp"
  from_port         = 22
  to_port           = 22
  cidr_ipv4         = each.value
}

# --- Backend ---
resource "aws_vpc_security_group_ingress_rule" "backend_api" {
  security_group_id            = aws_security_group.backend.id
  description                  = "API desde el frontend"
  ip_protocol                  = "tcp"
  from_port                    = var.backend_port
  to_port                      = var.backend_port
  referenced_security_group_id = aws_security_group.frontend.id
}

resource "aws_vpc_security_group_ingress_rule" "backend_ssh" {
  security_group_id            = aws_security_group.backend.id
  description                  = "SSH a traves del bastion"
  ip_protocol                  = "tcp"
  from_port                    = 22
  to_port                      = 22
  referenced_security_group_id = aws_security_group.frontend.id
}

# --- Base de datos ---
resource "aws_vpc_security_group_ingress_rule" "database_postgres" {
  security_group_id            = aws_security_group.database.id
  description                  = "PostgreSQL solo desde el backend"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.backend.id
}

resource "aws_vpc_security_group_ingress_rule" "database_ssh" {
  security_group_id            = aws_security_group.database.id
  description                  = "SSH a traves del bastion"
  ip_protocol                  = "tcp"
  from_port                    = 22
  to_port                      = 22
  referenced_security_group_id = aws_security_group.frontend.id
}

# --- Exporters (integrante 6), cerrados mientras monitoring_cidrs esté vacío ---
resource "aws_vpc_security_group_ingress_rule" "exporters" {
  for_each          = local.monitoring_rules
  security_group_id = local.security_groups[each.value.role]
  description       = "Exporter Prometheus ${each.value.port}"
  ip_protocol       = "tcp"
  from_port         = each.value.port
  to_port           = each.value.port
  cidr_ipv4         = each.value.cidr
}

# Salida: necesaria para actualizaciones y paquetes (en la subred privada solo funciona con NAT).
resource "aws_vpc_security_group_egress_rule" "all" {
  for_each          = local.security_groups
  security_group_id = each.value
  description       = "Salida del servidor ${each.key}"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}
