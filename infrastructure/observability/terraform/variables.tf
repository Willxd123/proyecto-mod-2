variable "region" {
  type    = string
  default = "us-east-1"
}

variable "vpc_id" {
  type        = string
  description = "ID de la VPC donde se despliega la instancia de observabilidad."
}

variable "subnet_id" {
  type        = string
  description = "Subred pública con salida a Internet."
}

variable "instance_type" {
  type    = string
  default = "t3.small"
}

variable "my_ip" {
  type        = string
  description = "Tu IP pública con máscara /32 para el Security Group (ej: 1.2.3.4/32)."
}
