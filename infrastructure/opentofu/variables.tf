# Entradas de la raíz; descripción y validaciones completas en modules/tenant/variables.tf.
# El script scripts/terraform_tenant.py las genera en tenant.tfvars.json.

variable "request_file" { type = string }        # DeploymentRequest: tenant, plan, región y las 3 AMIs
variable "expected_account_id" { type = string } # cuenta AWS permitida
variable "ssh_ingress_cidrs" { type = list(string) }

variable "member_id" {
  type    = string
  default = "integrante-2"
}
variable "monitoring_cidrs" {
  type    = list(string)
  default = []
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
variable "enable_nat_gateway" {
  type    = bool
  default = false
}
variable "inventory_dir" {
  type    = string
  default = ""
}
variable "ssh_private_key_path" {
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
