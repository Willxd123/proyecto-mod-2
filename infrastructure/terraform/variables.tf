# Entradas de la raíz (descripción y validaciones completas en modules/tenant/variables.tf).
# Datos del tenant: los genera el backend en output/tenants/<tenant_id>/terraform.tfvars.json.
# Datos del operador (cuenta, IP SSH, ruta de la clave): los agrega scripts/terraform_tenant.py.

# --- Tenant (guía del integrante 2) ---
variable "tenant_id" { type = string }
variable "tenant_name" { type = string }
variable "plan_type" { type = string }
variable "region" { type = string }
variable "frontend_ami_id" { type = string }
variable "backend_ami_id" { type = string }
variable "database_ami_id" { type = string }
variable "plan_capacity" {
  type = map(object({
    instance_type = string
    disk_gib      = number
  }))
}
variable "engine" {
  type    = string
  default = "terraform"
}
variable "request_id" {
  type    = string
  default = ""
}
variable "key_pair_name" {
  type    = string
  default = "practico7-asistencia"
}
variable "ssh_authorized_keys" {
  type    = list(string)
  default = []
}

# --- Operador ---
variable "expected_account_id" { type = string }
variable "ssh_ingress_cidrs" { type = list(string) }
variable "member_id" {
  type    = string
  default = "integrante-2"
}
variable "ssh_private_key_path" {
  type    = string
  default = ""
}
variable "monitoring_cidrs" {
  type    = list(string)
  default = []
}
variable "enable_nat_gateway" {
  type    = bool
  default = false
}
variable "inventory_dir" {
  type    = string
  default = ""
}
variable "backend_port" {
  type    = number
  default = 8000
}
variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}
variable "availability_zone" {
  type    = string
  default = ""
}
variable "state_reference" {
  type = object({
    backend      = string
    key_or_stack = string
  })
  default = {
    backend      = "local"
    key_or_stack = ""
  }
}
