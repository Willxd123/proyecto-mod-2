variable "request_file" {
  description = "Ruta al DeploymentRequest (request.json) generado por scripts/prepare_handoff.py. Los YAML de user-data deben estar en la misma carpeta."
  type        = string

  validation {
    condition     = can(jsondecode(file(var.request_file)))
    error_message = "No se pudo leer request_file como JSON."
  }
  validation {
    condition     = try(jsondecode(file(var.request_file)).schema_version == 1 && jsondecode(file(var.request_file)).provider == "aws", false)
    error_message = "El contrato debe ser DeploymentRequest con schema_version=1 y provider=aws."
  }
  validation {
    condition     = try(jsondecode(file(var.request_file)).deployable == true, false)
    error_message = "La solicitud tiene deployable=false: es un borrador y no puede aprovisionarse."
  }
  validation {
    condition     = try(contains(["terraform", "opentofu"], jsondecode(file(var.request_file)).engine), false)
    error_message = "Este módulo solo atiende solicitudes con engine terraform u opentofu."
  }
  validation {
    condition     = try(can(regex("^[a-z][a-z0-9-]{2,39}$", jsondecode(file(var.request_file)).tenant_slug)), false)
    error_message = "tenant_slug inválido: 3 a 40 letras minúsculas, números o guiones; debe comenzar con letra."
  }
  validation {
    condition     = try(can(regex("^[a-z]{2}(-[a-z]+)+-[0-9]$", jsondecode(file(var.request_file)).region)) && can(regex("^[a-zA-Z0-9._-]{1,255}$", jsondecode(file(var.request_file)).key_pair_name)), false)
    error_message = "Región o nombre de key pair inválidos."
  }
  validation {
    condition = try(alltrue([
      for role in ["frontend", "backend", "database"] :
      jsondecode(file(var.request_file)).images[role].region == jsondecode(file(var.request_file)).region
      && can(regex("^ami-[a-f0-9]{17}$", jsondecode(file(var.request_file)).images[role].ami_id))
    ]), false)
    error_message = "Faltan las tres Golden AMIs (frontend, backend, database) o alguna pertenece a otra región."
  }
  validation {
    condition = try(alltrue([
      for role in ["frontend", "backend", "database"] :
      jsondecode(file(var.request_file)).plan_snapshot.roles[role].disk_gib >= 12
      && can(regex("^[a-z0-9]+\\.[a-z0-9]+$", jsondecode(file(var.request_file)).plan_snapshot.roles[role].instance_type))
    ]), false)
    error_message = "plan_snapshot.roles debe definir instance_type y disk_gib >= 12 GiB (tamaño de la AMI) para los tres roles."
  }
  validation {
    condition = try(alltrue([
      for role in ["frontend", "backend", "database"] :
      fileexists("${dirname(var.request_file)}/${basename(jsondecode(file(var.request_file)).user_data[role])}")
    ]), false)
    error_message = "No se encontraron los YAML de user-data junto a request.json."
  }
}

variable "expected_account_id" {
  description = "Cuenta AWS esperada. El proveedor rechaza credenciales de cualquier otra cuenta."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.expected_account_id))
    error_message = "expected_account_id debe tener 12 dígitos."
  }
}

variable "member_id" {
  description = "Etiqueta MemberId de los recursos."
  type        = string
  default     = "integrante-2"

  validation {
    condition     = can(regex("^integrante-[1-6]$", var.member_id))
    error_message = "member_id debe ser integrante-1 … integrante-6."
  }
}

variable "ssh_ingress_cidrs" {
  description = "IPs públicas autorizadas a entrar por SSH al frontend (bastión). Nunca 0.0.0.0/0."
  type        = list(string)

  validation {
    condition     = length(var.ssh_ingress_cidrs) > 0 && alltrue([for c in var.ssh_ingress_cidrs : can(cidrhost(c, 0)) && !startswith(c, "0.0.0.0/")])
    error_message = "Indique al menos un CIDR válido para SSH; 0.0.0.0/0 no está permitido."
  }
}

variable "monitoring_cidrs" {
  description = "CIDRs del recolector Prometheus (integrante 6) para node_exporter 9100 y postgres_exporter 9187. Vacío = cerrado."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for c in var.monitoring_cidrs : can(cidrhost(c, 0)) && !startswith(c, "0.0.0.0/")])
    error_message = "CIDR de monitoreo inválido; 0.0.0.0/0 no está permitido."
  }
}

variable "backend_port" {
  description = "Puerto de la API de asistencia en el servidor backend (solo accesible desde el frontend)."
  type        = number
  default     = 8000

  validation {
    condition     = var.backend_port >= 1024 && var.backend_port <= 65535 && var.backend_port != 5432
    error_message = "backend_port debe estar entre 1024 y 65535 y no ser 5432."
  }
}

variable "vpc_cidr" {
  description = "Bloque de la VPC exclusiva del tenant."
  type        = string
  default     = "10.20.0.0/16"

  validation {
    condition     = can(cidrsubnet(var.vpc_cidr, 8, 2))
    error_message = "vpc_cidr debe admitir dos subredes /24 (por ejemplo, 10.20.0.0/16)."
  }
}

variable "availability_zone" {
  description = "Zona fija opcional. Vacío = primera zona que ofrezca todos los tipos de instancia del plan."
  type        = string
  default     = ""
}

variable "enable_nat_gateway" {
  description = "Crea un NAT Gateway para que backend y base de datos (subred privada) tengan salida a internet. Factura por hora."
  type        = bool
  default     = false
}

variable "inventory_dir" {
  description = "Carpeta raíz de inventarios. Se genera <inventory_dir>/<tenant>/hosts.ini (ignorado por Git)."
  type        = string
  default     = ""
}

variable "ssh_private_key_path" {
  description = "Ruta LOCAL de la clave privada para el inventario de Ansible. Solo se escribe la ruta, nunca el contenido."
  type        = string
  default     = ""

  validation {
    condition     = can(regex("^[^\"'\\n\\r]*$", var.ssh_private_key_path)) && !endswith(var.ssh_private_key_path, ".pub")
    error_message = "Ruta de clave inválida (sin comillas ni saltos de línea; no una llave .pub)."
  }
}

variable "state_reference" {
  description = "Referencia del estado para ProvisioningResult; la completa el script de ejecución."
  type = object({
    backend      = string
    key_or_stack = string
  })
  default = {
    backend      = "local"
    key_or_stack = ""
  }
}
