# Pruebas offline del módulo: proveedores simulados, sin credenciales ni recursos reales.
# Ejecutar desde infrastructure/terraform:  terraform init -backend=false && terraform test

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

variables {
  request_file         = "tests/fixtures/request.json"
  expected_account_id  = "123456789012"
  ssh_ingress_cidrs    = ["203.0.113.10/32"]
  inventory_dir        = "tests/.out"
  ssh_private_key_path = "/home/operador/.ssh/practico7-asistencia.pem"
}

run "plan_estandar_usa_capacidades_del_snapshot" {
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
  assert {
    condition     = strcontains(aws_instance.node["database"].user_data, "pg_createcluster") && strcontains(aws_instance.node["frontend"].user_data, "hostname: i2-fixture-frontend")
    error_message = "Cada instancia debe recibir el cloud-init de su rol."
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
    condition     = strcontains(local_file.inventory.content, "ansible_ssh_private_key_file=/home/operador/.ssh/practico7-asistencia.pem") && !strcontains(local_file.inventory.content, "PRIVATE KEY")
    error_message = "El inventario solo debe contener la ruta de la clave."
  }
  assert {
    condition     = local_file.inventory.filename == "tests/.out/i2-fixture/hosts.ini" && local_file.inventory.file_permission == "0600"
    error_message = "Ruta o permisos del inventario incorrectos."
  }
  assert {
    condition     = output.provisioning_result.schema_version == 1 && output.provisioning_result.engine == "terraform" && output.provisioning_result.nodes["database"].public_ip == null && output.provisioning_result.nodes["backend"].public_ip == null
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

run "rechaza_borrador_no_desplegable" {
  command = plan
  variables {
    request_file = "tests/fixtures/draft.json"
  }
  expect_failures = [var.request_file]
}

run "rechaza_motor_de_otro_integrante" {
  command = plan
  variables {
    request_file = "tests/fixtures/pulumi.json"
  }
  expect_failures = [var.request_file]
}

run "rechaza_imagen_de_otra_region" {
  command = plan
  variables {
    request_file = "tests/fixtures/wrong-region.json"
  }
  expect_failures = [var.request_file]
}

run "rechaza_ssh_abierto_a_internet" {
  command = plan
  variables {
    ssh_ingress_cidrs = ["0.0.0.0/0"]
  }
  expect_failures = [var.ssh_ingress_cidrs]
}
