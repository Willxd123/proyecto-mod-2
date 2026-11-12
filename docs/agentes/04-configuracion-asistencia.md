# Instrucción para el agente del integrante 4

Implementa RF-10/RF-21, aislamiento de datos, secretos y Entregable 7. Lee instrucciones raíz, plan, contratos, imágenes y las referencias de Ansible existentes.

Consume inventarios generados por cualquiera de los motores. Espera a cloud-init, que crea el cluster PostgreSQL de la imagen database. Configura en orden database → backend → frontend con roles parametrizados. No reinstales dependencias ya incluidas salvo una necesidad validada.

Reutiliza la aplicación de asistencia existente. La elección de NestJS para el panel no obliga a reescribir esa aplicación. Personaliza institución, conexión, usuarios y configuración por tenant. Mantén contraseñas y claves fuera del repo, user-data, logs e imágenes mediante Vault u otro mecanismo acordado.

Completa la configuración de `prometheus-postgres-exporter`, instalado pero deshabilitado, con un usuario de monitoreo y conexión local/privada. Coordina con integrante 6 los puertos y métricas; nunca abrirlos globalmente.

Pruebas: conectividad por la topología acordada; playbook repetible; login, importación de Excel y asistencia; tenant A no puede acceder a B; servicios tras reinicio y suspensión/reanudación. La separación de IPs por sí sola no demuestra aislamiento.

Entrega comando único, variables públicas/secretas separadas, inventario esperado, pruebas y evidencia. No distribuir el `.pem` por Git; usar la ruta local del operador.
