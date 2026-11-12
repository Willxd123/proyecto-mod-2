# Pruebas offline del módulo: proveedores simulados, sin credenciales ni recursos reales.
# Ejecutar desde infrastructure/terraform/modules/tenant:  terraform init -backend=false && terraform test

mock_provider "aws" {
  override_data {
    target = data.aws_ec2_instance_type_offerings.plan
    values = {
      # us-east-1a ofrece t3.micro y t3.small; las otras zonas no tienen ambos.
      locations      = ["us-east-1a", "us-east-1a", "us-east-1b", "us-east-1e"]
      instance_types = ["t3.micro", "t3.small", "t3.micro", "t3.micro"]
    }
  }
  override_data {
    target = data.aws_ami.golden["frontend"]
    values = { id = "ami-0aaaaaaaaaaaaaaa1", state = "available", architecture = "x86_64" }
  }
  override_data {
    target = data.aws_ami.golden["backend"]
    values = { id = "ami-0bbbbbbbbbbbbbbb2", state = "available", architecture = "x86_64" }
  }
  override_data {
    target = data.aws_ami.golden["database"]
    values = { id = "ami-0ccccccccccccccc3", state = "available", architecture = "x86_64" }
  }
}

mock_provider "local" {}

# Mismas entradas que genera POST /api/tenants/:slug/tfvars para un tenant del plan Estándar.
variables {
  tenant_id   = "i2-fixture"
  tenant_name = "Instituto Fixture"
  plan_type   = "estandar"
  plan_capacity = {
    frontend = { instance_type = "t3.micro", disk_gib = 16 }
    backend  = { instance_type = "t3.small", disk_gib = 20 }
    database = { instance_type = "t3.small", disk_gib = 40 }
  }
  region               = "us-east-1"
  frontend_ami_id      = "ami-0aaaaaaaaaaaaaaa1"
  backend_ami_id       = "ami-0bbbbbbbbbbbbbbb2"
  database_ami_id      = "ami-0ccccccccccccccc3"
  request_id           = "00000000-0000-4000-8000-000000000001"
  ssh_ingress_cidrs    = ["203.0.113.10/32"]
  inventory_dir        = "tests/.out"
  ssh_private_key_path = "/home/operador/.ssh/practico7-asistencia.pem"
}

# Primero: user_data tiene ignore_changes (no reinicia servidores reales), y las ejecuciones comparten estado.
run "cloud_init_con_llaves_publicas" {
  command = apply

  variables {
    ssh_authorized_keys = ["ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOperadorOperadorOperadorOperadorOperadorOp operador"]
  }

  assert {
    condition     = strcontains(aws_instance.node["backend"].user_data, "ssh_authorized_keys:\n  - \"ssh-ed25519 AAAAC3NzaC1lZDI1NTE5")
    error_message = "Las llaves públicas deben inyectarse como lista YAML entre comillas."
  }
}

run "plan_estandar_usa_capacidades_del_plan" {
  command = apply

  assert {
    condition     = aws_instance.node["frontend"].instance_type == "t3.micro" && aws_instance.node["backend"].instance_type == "t3.small" && aws_instance.node["database"].instance_type == "t3.small"
    error_message = "Los tipos de instancia no corresponden al plan Estándar."
  }
  assert {
    condition     = aws_instance.node["frontend"].root_block_device[0].volume_size == 16 && aws_instance.node["backend"].root_block_device[0].volume_size == 20 && aws_instance.node["database"].root_block_device[0].volume_size == 40
    error_message = "Los discos no corresponden al plan Estándar."
  }
  assert {
    condition     = aws_instance.node["database"].ami == "ami-0ccccccccccccccc3" && aws_instance.node["frontend"].ami == "ami-0aaaaaaaaaaaaaaa1"
    error_message = "Cada rol debe usar su Golden AMI."
  }
  assert {
    condition     = aws_subnet.public.availability_zone == "us-east-1a"
    error_message = "Debe elegirse la zona que ofrece todos los tipos del plan."
  }
  assert {
    condition     = aws_instance.node["backend"].tags["Name"] == "i2-fixture-backend" && aws_instance.node["backend"].key_name == "practico7-asistencia"
    error_message = "Nombre por tenant_id y key pair esperados."
  }
}

run "cloud_init_del_integrante_1" {
  command = apply

  assert {
    condition     = strcontains(aws_instance.node["frontend"].user_data, "hostname: i2-fixture-frontend") && strcontains(aws_instance.node["database"].user_data, "pg_createcluster")
    error_message = "Cada instancia debe recibir el cloud-init de su rol con el tenant_id."
  }
  assert {
    condition     = alltrue([for n in aws_instance.node : !strcontains(n.user_data, "__") && !strcontains(n.user_data, "\r") && strcontains(n.user_data, "timezone: America/La_Paz")])
    error_message = "El cloud-init no debe dejar marcadores sin reemplazar ni retornos de carro."
  }
}

run "seguridad_basica_de_instancias" {
  command = apply

  assert {
    condition     = alltrue([for n in aws_instance.node : n.root_block_device[0].encrypted && n.root_block_device[0].volume_type == "gp3"])
    error_message = "Todos los discos deben ser gp3 cifrados."
  }
  assert {
    condition     = alltrue([for n in aws_instance.node : n.metadata_options[0].http_tokens == "required"])
    error_message = "IMDSv2 debe ser obligatorio."
  }
  assert {
    condition     = aws_instance.node["frontend"].associate_public_ip_address && !aws_instance.node["backend"].associate_public_ip_address && !aws_instance.node["database"].associate_public_ip_address
    error_message = "Solo el frontend tiene IP pública."
  }
  assert {
    condition     = aws_instance.node["backend"].subnet_id == aws_subnet.private.id && aws_instance.node["database"].subnet_id == aws_subnet.private.id && aws_instance.node["frontend"].subnet_id == aws_subnet.public.id
    error_message = "Backend y base de datos deben estar en la subred privada."
  }
}

run "postgres_no_es_publico" {
  command = apply

  assert {
    condition     = aws_vpc_security_group_ingress_rule.database_postgres.referenced_security_group_id == aws_security_group.backend.id && aws_vpc_security_group_ingress_rule.database_postgres.cidr_ipv4 == null
    error_message = "5432 solo debe aceptar tráfico del SG del backend."
  }
  assert {
    condition     = aws_vpc_security_group_ingress_rule.backend_api.referenced_security_group_id == aws_security_group.frontend.id && aws_vpc_security_group_ingress_rule.backend_api.from_port == 8000
    error_message = "La API del backend solo debe aceptar tráfico del frontend."
  }
  assert {
    condition     = keys(aws_vpc_security_group_ingress_rule.frontend_ssh) == ["203.0.113.10/32"]
    error_message = "SSH solo desde los CIDR autorizados."
  }
  assert {
    condition     = length(aws_vpc_security_group_ingress_rule.exporters) == 0
    error_message = "Los exporters deben quedar cerrados sin monitoring_cidrs."
  }
  assert {
    condition     = length(aws_nat_gateway.tenant) == 0 && length(aws_route_table.private.route) == 0
    error_message = "Sin enable_nat_gateway la subred privada no tiene salida a internet."
  }
}

run "inventario_y_provisioning_result" {
  command = apply

  assert {
    condition     = strcontains(local_file.inventory.content, "[database]\ni2-fixture-database ansible_host=") && strcontains(local_file.inventory.content, "ProxyCommand=\"ssh -W %h:%p")
    error_message = "El inventario debe tener los tres grupos y el salto por el bastión."
  }
  assert {
    condition     = strcontains(local_file.inventory.content, "ansible_ssh_private_key_file=/home/operador/.ssh/practico7-asistencia.pem") && !strcontains(local_file.inventory.content, "PRIVATE KEY") && !strcontains(local_file.inventory.content, "\r")
    error_message = "El inventario solo debe contener la ruta de la clave y usar LF."
  }
  assert {
    condition     = local_file.inventory.filename == "tests/.out/i2-fixture/hosts.ini" && local_file.inventory.file_permission == "0600"
    error_message = "Ruta o permisos del inventario incorrectos."
  }
  assert {
    condition     = output.provisioning_result.schema_version == 1 && output.provisioning_result.engine == "terraform" && output.provisioning_result.request_id == "00000000-0000-4000-8000-000000000001" && output.provisioning_result.nodes["database"].public_ip == null && output.provisioning_result.nodes["backend"].public_ip == null
    error_message = "ProvisioningResult no cumple el contrato."
  }
  assert {
    condition     = length(output.provisioning_result.network.security_group_ids) == 3 && length(output.provisioning_result.network.subnet_ids) == 2
    error_message = "ProvisioningResult debe incluir la red del tenant."
  }
}

run "nat_opcional_y_exporters" {
  command = apply

  variables {
    enable_nat_gateway = true
    monitoring_cidrs   = ["10.99.0.10/32"]
  }

  assert {
    condition     = length(aws_nat_gateway.tenant) == 1 && length(aws_route.private_nat) == 1
    error_message = "Con enable_nat_gateway la subred privada debe salir por el NAT."
  }
  assert {
    condition     = length(aws_vpc_security_group_ingress_rule.exporters) == 4
    error_message = "Debe abrirse 9100 en los tres roles y 9187 en la base de datos solo para el recolector."
  }
}

run "rechaza_plan_inexistente" {
  command = plan
  variables {
    plan_type = "premium"
  }
  expect_failures = [var.plan_type]
}

run "rechaza_disco_menor_que_la_ami" {
  command = plan
  variables {
    plan_capacity = {
      frontend = { instance_type = "t3.micro", disk_gib = 10 }
      backend  = { instance_type = "t3.small", disk_gib = 20 }
      database = { instance_type = "t3.small", disk_gib = 40 }
    }
  }
  expect_failures = [var.plan_capacity]
}

run "rechaza_ami_invalida" {
  command = plan
  variables {
    database_ami_id = "ubuntu-generica"
  }
  expect_failures = [var.database_ami_id]
}

run "rechaza_motor_de_otro_integrante" {
  command = plan
  variables {
    engine = "pulumi"
  }
  expect_failures = [var.engine]
}

run "rechaza_tenant_id_invalido" {
  command = plan
  variables {
    tenant_id = "Colegio Demo"
  }
  expect_failures = [var.tenant_id]
}

run "rechaza_ssh_abierto_a_internet" {
  command = plan
  variables {
    ssh_ingress_cidrs = ["0.0.0.0/0"]
  }
  expect_failures = [var.ssh_ingress_cidrs]
}
