# Instrucción para el agente del integrante 3

Implementa segundo motor (Pulumi o CloudFormation) y escaneo pre-despliegue: RF-08/RF-09 y aportes RF-11/RF-13. Lee las instrucciones raíz, plan de integración, contratos y referencia HTML.

Elige una implementación secundaria en AWS y consume el mismo `DeploymentRequest` que Terraform. Debe funcionar de manera independiente y producir el mismo `ProvisioningResult`, con estado/stack separado, etiquetas y red aislada. No gestionar recursos creados por el otro motor.

Reemplaza el espacio de Seguridad del panel por una ejecución real del escáner y resultados estructurados. Analiza archivos de configuración de la solicitud autorizada; no aceptes rutas arbitrarias del navegador ni muestres valores de secretos. Coordina con integrante 5 el bloqueo del despliegue ante hallazgos según la política acordada. No copies los logs de ejemplo ni el botón de simulación de la plantilla como prueba real.

Prueba detección con credenciales ficticias, caso limpio, fallos del escáner y redacción de salida. Prueba además un tenant con tu motor, capacidades del plan, imágenes y salidas para Ansible. Conserva versiones reales de motor y plantillas. No se requiere una tabla histórica de escaneos.

Entrega herramientas elegidas, adaptador, contrato de resultados, código UI/API, pruebas y evidencia AWS. Ningún test debe utilizar una credencial real para demostrar una fuga.
