# DOCUMENTO QUE DIO EL DOCENTE Requisitos del proyecto finalv2

## Página 1

Requisitos del proyecto final 
1. Descripción 
Construir una plataforma para crear y administrar tenants de una aplicación de registro de 
asistencia. Cada tenant representa una institución educativa con sus propios usuarios, 
cursos, estudiantes y asistencia. 
La plataforma debe permitir elegir un plan, aprovisionar y desplegar los recursos 
necesarios, administrar el ciclo de vida del tenant y consultar su estado operativo. 
Supuesto recomendado: usar AWS como nube principal para el proyecto, ya que 
CloudFormation es específico de AWS. Terraform, OpenTofu y Pulumi también pueden 
aprovisionar recursos en AWS. 
2. Usuarios 
• Administrador de la plataforma: administra planes, crea y gestiona tenants, 
consulta despliegues y métricas. 
• Administrador del tenant: administra la información de su institución y consulta el 
estado de sus servicios. 
• Docente y estudiante: usan las funciones de la aplicación según sus permisos. 
3. Requisitos funcionales 
Catálogo de planes 
• RF-01: La plataforma debe ofrecer un catálogo de planes, como Básico, Estándar y 
Avanzado. 
• RF-02: Cada plan debe definir los recursos asignados, como capacidad de 
cómputo, almacenamiento, tamaño de base de datos y límites de uso. 
• RF-03: Al solicitar un tenant, el usuario debe seleccionar un plan y ver sus 
características. 
• RF-04: El administrador de la plataforma debe poder consultar y modificar la 
configuración de los planes. 
• RF-05: La plataforma debe impedir que un tenant exceda los límites establecidos 
por su plan. 
• RF-06: El administrador debe poder cambiar el plan de un tenant y consultar qué 
recursos se modificarán.

## Página 2

Creación y despliegue 
• RF-07: Permitir crear un tenant con nombre, identificador único, datos de contacto, 
entorno y plan. 
• RF-08: Permitir elegir Terraform, OpenTofu, Pulumi o CloudFormation como motor 
de aprovisionamiento. 
• RF-09: Crear y configurar los recursos necesarios para ejecutar frontend, backend y 
base de datos. 
• RF-10: Desplegar la aplicación y configurar su conexión con la base de datos del 
tenant. 
• RF-11: Mostrar el progreso y el resultado del aprovisionamiento, incluidos errores 
comprensibles. 
• RF-12: Permitir reintentar una operación fallida sin duplicar recursos. 
• RF-13: Registrar las versiones de la aplicación, las plantillas y las herramientas 
usadas en cada despliegue. 
Ciclo de vida del tenant 
• RF-14: Permitir consultar tenants por nombre, estado, plan y entorno. 
• RF-15: Permitir actualizar la aplicación y la infraestructura de un tenant. 
• RF-16: Permitir suspender y reanudar un tenant. 
• RF-17: La suspensión debe detener o reducir los recursos definidos por la política 
del proyecto y conservar los datos según la política de retención. 
• RF-18: Antes de eliminar un tenant, la plataforma debe mostrar qué recursos y 
datos se eliminarán y solicitar confirmación. 
• RF-19: Permitir respaldar y restaurar un tenant. 
• RF-20: Registrar quién inició cada operación, cuándo se realizó y cuál fue su 
resultado. 
Aplicación de registro de Asistencia 
• RF-21: Los mismo requerimientos actuales de la aplicacion. 
Salud, métricas y alertas

## Página 3

• RF-25: Integrar Grafana para mostrar la salud y el rendimiento de los servicios de 
cada tenant. 
• RF-26: Mostrar, como mínimo, disponibilidad, uso de CPU y memoria, latencia, 
errores del backend y estado de la base de datos. 
• RF-27: Permitir consultar las métricas por tenant y por entorno. 
• RF-28: Generar alertas cuando un servicio deje de responder, aumenten los errores 
o se alcancen límites de recursos. 
• RF-29: Mostrar alertas y eventos recientes en la plataforma, junto con su tenant 
afectado y hora de detección. 
4. Uso de tecnologías 
• Terraform u OpenTofu: motor principal recomendado para aprovisionar 
infraestructura. 
• Pulumi y CloudFormation: segunda implementación pequeña o comparación 
técnica con el motor principal. 
• cloud-init: configuración inicial de máquinas virtuales. 
• Ansible: configuración posterior de máquinas virtuales. 
• Packer: creación de imágenes preconfiguradas 
• Grafana: métricas, paneles y alertas operativas. 
El equipo debe explicar qué función cumple cada herramienta en su arquitectura.  
5. Requisitos no funcionales y de arquitectura 
• Mantener aislados los datos de cada tenant. 
• Proteger secretos y credenciales; no guardarlos en el código ni en los repositorios. 
• Ejecutar los aprovisionamientos como trabajos en segundo plano y permitir 
consultar su estado. 
• Guardar el historial de operaciones y los resultados de despliegue. 
• Hacer que las operaciones puedan repetirse de forma segura y consistente. 
• Documentar cómo se almacena y protege el estado del motor de infraestructura. 
• Mostrar los errores sin exponer secretos.

## Página 4

• Permitir detener o eliminar recursos de prueba para controlar costos. 
6. Entregables 
1. Código fuente del frontend y backend. 
2. Código de infraestructura y configuración. 
3. Diagrama de arquitectura y flujo de creación de un tenant. 
4. Catálogo de planes y límites de cada uno. 
5. Tablero de Grafana con métricas y alertas. 
6. Instrucciones para crear, actualizar, suspender, reanudar, respaldar, restaurar y 
eliminar un tenant. 
7. Evidencia de pruebas de aislamiento entre tenants. 
8. Demostración funcional y presentación del diseño. 
7. Criterios mínimos de aceptación 
El equipo debe demostrar que puede: 
• Crear tenants seleccionando distintos planes. 
• Desplegar frontend, backend y base de datos para cada tenant. 
• Cambiar el plan de un tenant y explicar el efecto esperado. 
• Suspender y reanudar un tenant, conservando sus datos según la política definida. 
• Respaldar y restaurar un tenant. 
• Consultar en Grafana la salud de los servicios y ver una alerta de ejemplo. 
• Comprobar que un tenant no puede consultar los datos de otro. 
• Revisar el historial de una operación fallida y reintentarla.

## Página 5

[Esta página no contiene texto extraíble.]
