# Entradas del tenant (guía del integrante 2): tenant_id, tenant_name, plan_type, region y los 3 AMI IDs
# de Packer (integrante 1). El backend las genera en el tfvars del tenant (POST /api/tenants/:slug/tfvars).

variable "tenant_id" {
  description = "Identificador del tenant (slug). Nombra la VPC, los SG, las instancias, el workspace y el inventario."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,39}$", var.tenant_id))
    error_message = "tenant_id inválido: 3 a 40 letras minúsculas, números o guiones; debe comenzar con letra."
  }
}

variable "tenant_name" {
  description = "Nombre de la institución."
  type        = string

  validation {
    condition     = length(trimspace(var.tenant_name)) > 0 && length(var.tenant_name) <= 120
    error_message = "tenant_name es obligatorio (máximo 120 caracteres)."
  }
}

variable "plan_type" {
  description = "Plan elegido: basico, estandar o avanzado."
  type        = string

  validation {
    condition     = contains(["basico", "estandar", "avanzado"], var.plan_type)
    error_message = "plan_type debe ser basico, estandar o avanzado."
  }
}

variable "plan_capacity" {
  description = "Capacidad del plan por rol, copiada del catálogo (config/plans.json) al generar el tfvars. Así un cambio posterior del catálogo no redimensiona tenants existentes."
  type = map(object({
    instance_type = string
    disk_gib      = number
  }))

  validation {
    condition     = toset(keys(var.plan_capacity)) == toset(["frontend", "backend", "database"])
    error_message = "plan_capacity debe definir exactamente frontend, backend y database."
  }
  validation {
    condition     = alltrue([for c in values(var.plan_capacity) : c.disk_gib >= 12 && can(regex("^[a-z0-9]+\\.[a-z0-9]+$", c.instance_type))])
    error_message = "Cada rol necesita instance_type válido y disk_gib >= 12 GiB (tamaño de la Golden AMI)."
  }
}

variable "region" {
  description = "Región AWS donde están las Golden AMIs."
  type        = string

  validation {
    condition     = can(regex("^[a-z]{2}(-[a-z]+)+-[0-9]$", var.region))
    error_message = "Región AWS inválida (por ejemplo, us-east-1)."
  }
}

variable "frontend_ami_id" {
  description = "Golden AMI del frontend (Packer, integrante 1)."
  type        = string

  validation {
    condition     = can(regex("^ami-[a-f0-9]{17}$", var.frontend_ami_id))
    error_message = "frontend_ami_id debe tener el formato ami-xxxxxxxxxxxxxxxxx."
  }
}

variable "backend_ami_id" {
  description = "Golden AMI del backend (Packer, integrante 1)."
  type        = string

  validation {
    condition     = can(regex("^ami-[a-f0-9]{17}$", var.backend_ami_id))
    error_message = "backend_ami_id debe tener el formato ami-xxxxxxxxxxxxxxxxx."
  }
}

variable "database_ami_id" {
  description = "Golden AMI de la base de datos (Packer, integrante 1)."
  type        = string

  validation {
    condition     = can(regex("^ami-[a-f0-9]{17}$", var.database_ami_id))
    error_message = "database_ami_id debe tener el formato ami-xxxxxxxxxxxxxxxxx."
  }
}

variable "engine" {
  description = "Motor que gestiona el tenant. Este módulo solo atiende terraform y opentofu."
  type        = string
  default     = "terraform"

  validation {
    condition     = contains(["terraform", "opentofu"], var.engine)
    error_message = "Este módulo solo atiende los motores terraform u opentofu (Pulumi/CloudFormation son del integrante 3)."
  }
}

variable "request_id" {
  description = "Identificador del borrador (UUID de la tabla tenants). Se usa en la etiqueta RunId y en ProvisioningResult."
  type        = string
  default     = ""

  validation {
    condition     = can(regex("^[A-Za-z0-9-]{0,64}$", var.request_id))
    error_message = "request_id inválido."
  }
}

variable "key_pair_name" {
  description = "Key pair de EC2 existente en la región (la clave privada nunca pasa por aquí)."
  type        = string
  default     = "practico7-asistencia"

  validation {
    condition     = can(regex("^[a-zA-Z0-9._-]{1,255}$", var.key_pair_name))
    error_message = "Nombre de key pair inválido."
  }
}

variable "ssh_authorized_keys" {
  description = "Llaves SSH públicas adicionales para cloud-init. Vacío = solo el key pair de EC2."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for k in var.ssh_authorized_keys : can(regex("^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)) [A-Za-z0-9+/]+={0,3}( [A-Za-z0-9_.@-]{1,64})?$", k))])
    error_message = "Solo se aceptan llaves SSH públicas en una línea."
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

variable "enable_frontend_https" {
  description = "Permitir HTTPS publico al frontend cuando se configure TLS."
  type        = bool
  default     = false
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
  description = "Carpeta raíz de inventarios. Se genera <inventory_dir>/<tenant_id>/hosts.ini (ignorado por Git)."
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
