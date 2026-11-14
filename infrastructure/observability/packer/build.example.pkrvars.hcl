# Copiar a build.pkrvars.hcl (ignorado por .gitignore). Identificadores de ejemplo; no desplegables.
region          = "us-east-1"
source_ami      = "REEMPLAZAR_AMI_CANONICAL_UBUNTU_24_04"
vpc_id          = "REEMPLAZAR_VPC"
subnet_id       = "REEMPLAZAR_SUBRED_PUBLICA_CON_SALIDA_HTTPS"
ssh_source_cidr = "REEMPLAZAR_IP_PUBLICA/32"
image_version   = "1.0.0"
source_revision = "REEMPLAZAR_COMMIT_REAL"

# Versiones de las herramientas (no cambiar salvo actualización revisada)
prometheus_version = "2.54.1"
grafana_version    = "11.2.0"
