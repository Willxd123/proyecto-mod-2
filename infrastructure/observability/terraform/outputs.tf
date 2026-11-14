output "observabilidad_ip_publica" {
  description = "IP pública del servidor de observabilidad (usar en la UI de Monitoreo)"
  value       = aws_eip.observabilidad.public_ip
}

output "grafana_url" {
  description = "URL de acceso a Grafana"
  value       = "http://${aws_eip.observabilidad.public_ip}:3000"
}

output "prometheus_url" {
  description = "URL de acceso a Prometheus (solo desde tu IP)"
  value       = "http://${aws_eip.observabilidad.public_ip}:9090"
}

output "ami_id" {
  description = "AMI usada para el despliegue"
  value       = data.aws_ami.observabilidad.id
}
