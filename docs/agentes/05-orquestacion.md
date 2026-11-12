# Instrucción para el agente del integrante 5

Implementa RF-11 y RF-14 a RF-18: trabajos en segundo plano, progreso y ciclo de vida. Lee instrucciones raíz, plan y tipos compartidos; coordina el endpoint de creación con integrante 2.

Integra solicitud validada → escáner → motor elegido → espera de cloud-init → Ansible → comprobaciones → registro ACTIVE y targets. Packer se ejecuta previamente; no reconstruir AMIs por tenant. Invoca ejecutables con listas de argumentos, sin shell formado con datos del usuario.

Rechaza borradores `deployable=false`; verifica cuenta, región y propiedad del tenant antes de cambios. Implementa una operación mutante activa por tenant y un bloqueo compartido antes de escalar a varios workers. No prometas que una cola en memoria soporta reinicios. Define recuperación y estado consultable; los logs completos no requieren persistencia histórica.

Publica `OperationEvent` por SSE/WebSocket o consulta periódica y oculta secretos. Conserva `DeploymentMetadata` con versiones reales y snapshot del plan. Acordar cómo almacenar el estado operativo en las tres tablas funcionales sin introducir historial obligatorio ni perder trabajos activos.

Completa lista y filtros, edición básica, stop/start y actualización de direcciones, y eliminación confirmada con detalle. Eliminar únicamente los recursos del tenant bajo su motor. Conserva datos al suspender según política.

Registra targets con `update_monitoring_targets.py` tras activar y actualiza direcciones al reanudar; coordina retirar/silenciar objetivos suspendidos y eliminados con integrante 6.

Prueba creación real con ambos motores, errores, concurrencia, estado, redacción de logs, suspensión/reanudación y eliminación de un tenant de prueba. Entrega controles y evidencias; el reintento avanzado no es requisito base confirmado.
