# **UNIVERSIDAD / FACULTAD DE INGENIERÍA EN CIENCIAS DE LA COMPUTACIÓN Y TELECOMUNICACIONES**

## **MÓDULO II: INFRAESTRUCTURA COMO CÓDIGO Y AUTOMATIZACIÓN CLOUD**

**INFORME FINAL DEL PROYECTO**  
**PLATAFORMA MULTI-TENANT PARA GESTIÓN DE REGISTRO DE ASISTENCIA ("TENANT CONTROL CENTER")**  
**Docente:** Ing. \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_  
**Grupo / Equipo:** \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_  
**Fecha de Entrega:** Noviembre de 2026  
**Nómina del Equipo de Desarrollo (6 Integrantes)**

| N° | Rol Técnico y Herramientas Asignadas | Nombre Completo del Integrante | Código / Registro |
| ----- | ----- | ----- | ----- |
| **Integrante 1** | Imágenes Base (Packer \+ cloud-init) y Catálogo de Planes (RF-01, RF-02, RF-13) | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ | \_\_\_\_\_\_\_\_\_\_\_\_\_\_ |
| **Integrante 2** | Motor IaC Principal (Terraform) y Registro de Tenants (RF-03, RF-07, RF-08, RF-09) | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ | \_\_\_\_\_\_\_\_\_\_\_\_\_\_ |
| **Integrante 3** | Motor IaC Secundario (AWS CloudFormation) y Escáner de Seguridad Pre-Deploy (RF-08, RF-09, RNF) | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ | \_\_\_\_\_\_\_\_\_\_\_\_\_\_ |
| **Integrante 4** | Configuración Automatizada (Ansible \+ Vault) y Aislamiento Multi-Tenant (RF-10, RF-21, Entregable 7\) | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ | \_\_\_\_\_\_\_\_\_\_\_\_\_\_ |
| **Integrante 5** | Orquestador Web en 2do Plano, Logs en Vivo y Ciclo de Vida (RF-11, RF-14 a RF-18) | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ | \_\_\_\_\_\_\_\_\_\_\_\_\_\_ |
| **Integrante 6 (Team Lead)** | Observabilidad (Grafana \+ Alertas), Arquitectura y Documentación (RF-25 a RF-29, Entregables 3, 5, 6, 8\) | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ | \_\_\_\_\_\_\_\_\_\_\_\_\_\_ |

**Enlaces Oficiales de Entrega (Entregables 1, 2, 5 y 8\)**

| Entregable / Recurso |  |
| ----- | :---- |
| **Entregable 1 — Repositorio Código Fuente (Frontend y Backend):** | \[Pegar enlace de GitHub aquí\] |
| **Entregable 2 — Repositorio Infraestructura y Configuración (IaC):** | \[Pegar enlace de GitHub aquí\] |
| **Entregable 5 — URL del Tablero de Monitoreo y Alertas (Grafana):** | \[Pegar enlace de Grafana aquí\] |
| **Entregable 8 — Video Demostrativo Final (Máx. 15 minutos):** | \[Pegar enlace de Google Drive aquí\] |

# **ÍNDICE GENERAL**

1. **1\. RESUMEN EJECUTIVO Y ALCANCE DEL PROYECTO**  
   * 1.1. Descripción General de la Solución Multi-Tenant  
   * 1.2. Usuarios del Sistema y Roles Operativos  
   * 1.3. Alcance Funcional Implementado y Delimitación del Proyecto  
2. **2\. CATÁLOGO DE PLANES Y CAPACIDADES (ENTREGABLE 4\)**  
   * 2.1. Estructura de Planes Ofrecidos (RF-01, RF-02, RF-03)  
   * 2.2. Matriz Técnica de Recursos y Límites por Plan  
3. **3\. ARQUITECTURA DEL SISTEMA Y FLUJO DE CREACIÓN DE UN TENANT (ENTREGABLE 3\)**  
   * 3.1. Arquitectura General de Doble Capa  
   * 3.2. Topología de Red y Aislamiento por Tenant en la Nube  
   * 3.3. Flujo Secuencial de Creación y Aprovisionamiento en 3 Pasos  
4. **4\. IMPLEMENTACIÓN DE HERRAMIENTAS DE INFRAESTRUCTURA COMO CÓDIGO Y DEVOPS**  
   * 4.1. Función de cada Tecnología en la Arquitectura (Sección 4\)  
   * 4.2. Gestión del Estado IaC, Idempotencia y Protección de Secretos

## **4.2. Gestión del Estado IaC, Idempotencia y Protección de Secretos**

**Aislamiento del Estado IaC:** En **Terraform** cada tenant gestiona su archivo de estado *terraform.tfstate* aislado por directorio/workspace (ej. *workspaces/san-marcos/terraform.tfstate*), mientras que en **AWS CloudFormation** el estado de cada institución se administra de forma nativa y aislada mediante un Stack independiente en AWS (por ejemplo, *stack-tenant-upsa*).  
**Protección de Credenciales:** Ninguna clave de acceso de AWS (Access Key / Secret Key) se incluye directamente en el código de infraestructura; se utilizan variables de entorno o roles IAM seguros.

5. **5\. OBSERVABILIDAD, MONITOREO Y ALERTAS CON GRAFANA (ENTREGABLE 5\)**  
   * 5.1. Arquitectura Centralizada de Recolección de Métricas  
   * 5.2. Paneles y Métricas Supervisadas por Tenant (RF-25, RF-26, RF-27)  
   * 5.3. Reglas de Alerta e Integración Webhook con la Plataforma (RF-28, RF-29)  
6. **6\. EVIDENCIAS DE PRUEBAS FUNCIONALES Y DE AISLAMIENTO (ENTREGABLE 7\)**  
   * 6.1. Matriz de Verificación de Criterios Mínimos de Aceptación  
   * 6.2. Registro Visual de Evidencias (Espacios para Capturas del Equipo)  
7. **7\. MANUAL DE USUARIO DE LA PLATAFORMA — GUÍA NO TÉCNICA (ENTREGABLE 6\)**  
   * 7.1. Introducción para Administradores Institucionales  
   * 7.2. Paso a Paso: Cómo Crear una Nueva Institución (Tenant)  
   * 7.3. Paso a Paso: Cómo Administrar, Suspender, Reanudar o Eliminar una Institución  
   * 7.4. Paso a Paso: Cómo Consultar el Estado de Salud y las Alertas  
8. **8\. CONCLUSIONES**

# **1\. RESUMEN EJECUTIVO Y ALCANCE DEL PROYECTO**

## **1.1. Descripción General de la Solución Multi-Tenant**

El presente informe documenta el diseño, construcción y despliegue de la plataforma **Tenant Control Center**, un sistema web administrativo concebido para crear, aprovisionar, operar y monitorear múltiples instancias independientes (*tenants*) de la **Aplicación de Registro de Asistencia** orientada a instituciones educativas (universidades, institutos técnicos y colegios). Las instancias independientes operan sobre **AWS** (nube principal recomendada) mediante aprovisionamiento automatizado con **Terraform** y **AWS CloudFormation**.  
Cada institución registrada en la plataforma representa un **tenant** completamente aislado que cuenta con sus propios servidores en la nube (Frontend, Backend y Base de Datos), su propia dirección IP pública de acceso y sus propios cursos, docentes, estudiantes y registros de asistencia. Esta arquitectura permite comercializar y entregar el sistema a nuevas instituciones en cuestión de minutos mediante un flujo automatizado desde una interfaz web local conectada con herramientas de Infraestructura como Código (IaC).

## **1.2. Usuarios del Sistema y Roles Operativos**

De acuerdo con la especificación del proyecto, intervienen tres perfiles de usuario claramente diferenciados:

9. **Administrador de la Plataforma:** Opera el panel central *Tenant Control Center*. Consulta el catálogo de planes, registra nuevas instituciones, selecciona el motor de aprovisionamiento, supervisa los logs de despliegue en tiempo real, administra el ciclo de vida de cada tenant (actualizar nombre, suspender, reanudar o eliminar) y monitorea las métricas y alertas globales en Grafana.  
10. **Administrador del Tenant (Institución):** Es el encargado administrativo propio de cada universidad o instituto creado. Accede mediante la dirección IP pública asignada a su institución para administrar su información académica, crear cursos/grupos, cargar las nóminas de estudiantes mediante archivos Excel (**RF-21**) y consultar el estado operativo de sus servicios (**RF-25**, **RF-27**).  
11. **Docente y Estudiante:** Usuarios finales dentro de la aplicación de asistencia de cada institución. El docente gestiona, modifica y valida los registros de asistencia de sus cursos, mientras que el estudiante registra su asistencia conforme a sus permisos asignados.

## **1.3. Alcance Funcional Implementado y Delimitación del Proyecto**

El proyecto da cumplimiento íntegro a los requisitos obligatorios establecidos en la guía oficial y las precisiones de cátedra:

12. **Catálogo de Planes (RF-01, RF-02, RF-03):** Oferta de tres planes predefinidos (Básico, Estándar y Avanzado) con capacidades diferenciadas de cómputo, almacenamiento, tamaño de base de datos y límites de estudiantes, visualizables al momento de solicitar un tenant.  
13. **Creación, Seguridad y Despliegue (RF-07 a RF-11, RF-13):** Formulario de registro institucional con selección de motor IaC (Terraform o AWS CloudFormation), escaneo previo de seguridad para impedir secretos expuestos en el código, aprovisionamiento de 3 máquinas virtuales por tenant usando imágenes preconfiguradas con Packer, configuración automatizada de aplicación y base de datos con Ansible, y consola de logs en vivo en pantalla.  
14. **Ciclo de Vida del Tenant (RF-14 a RF-18):** Listado con filtros por nombre, estado, plan y entorno; edición de datos básicos de la institución; suspensión mediante apagado de máquinas virtuales para ahorro de costos conservando los discos de datos; reanudación con actualización automática de inventario; y eliminación definitiva con modal de confirmación previa.  
15. **Monitoreo y Alertas con Grafana (RF-25 a RF-29):** Tablero centralizado en Grafana con métricas de disponibilidad, CPU, memoria, disco, latencia, errores del backend y estado de base de datos filtrables por tenant y entorno, además de visualización de alertas recientes en la plataforma web.

*(Nota de delimitación: Conforme a las indicaciones del docente en sesión síncrona, los puntos correspondientes a edición dinámica de planes RF-04, bloqueo activo de cuotas RF-05, cambio/migración de plan RF-06, reintentos automatizados complejos RF-12, respaldo/restauración RF-19 y bitácora histórica de auditoría RF-20 fueron clasificados como características opcionales fuera del requerimiento mínimo obligatorio).*

# **2\. CATÁLOGO DE PLANES Y CAPACIDADES (ENTREGABLE 4\)**

## **2.1. Estructura de Planes Ofrecidos (RF-01, RF-02, RF-03)**

La plataforma ofrece tres niveles de servicio diseñados según el volumen de matrícula y demanda operativa de cada institución educativa. Al seleccionar cualquiera de los planes en el formulario de creación, el panel de resumen actualiza dinámicamente las especificaciones que serán inyectadas como parámetros en el motor de Infraestructura como Código.

## **2.2. Matriz Técnica de Recursos y Límites por Plan**

| Parámetro / Recurso Asignado | Plan Básico | Plan Estándar | Plan Avanzado |
| ----- | ----- | ----- | ----- |
| **Público Objetivo** | Institutos pequeños o entornos iniciales | Universidades e institutos en crecimiento | Universidades grandes de alta concurrencia |
| **Capacidad de Estudiantes (RF-02)** | Hasta 100 estudiantes | Hasta 1,000 estudiantes | Hasta 5,000 estudiantes |
| **Servidor Frontend (Nginx)** | 1 VM t3.micro (2 vCPU, 1 GB RAM) | 1 VM t3.small (2 vCPU, 2 GB RAM) | 1 VM t3.medium (2 vCPU, 4 GB RAM) |
| **Servidor Backend (Node.js API)** | 1 VM t3.micro (2 vCPU, 1 GB RAM) | 1 VM t3.small (2 vCPU, 2 GB RAM) | 1 VM t3.medium (2 vCPU, 4 GB RAM) |
| **Servidor Base de Datos (PostgreSQL)** | 1 VM t3.micro (Subred Privada) | 1 VM t3.small (Subred Privada) | 1 VM t3.medium (Subred Privada) |
| **Almacenamiento Base de Datos (RF-02)** | 10 GB SSD (gp3) | 50 GB SSD (gp3) | 200 GB SSD (gp3) |
| **Esquema de Aislamiento** | VPC, subredes y Security Group dedicados en AWS | VPC, subredes y Security Group dedicados en AWS | VPC, subredes y Security Group dedicados en AWS |
| **Observabilidad y Alertas** | Métricas básicas por tenant en Grafana | Métricas completas y alertas en Grafana | Métricas detalladas y alertas prioritarias en Grafana |

# **3\. ARQUITECTURA DEL SISTEMA Y FLUJO DE CREACIÓN DE UN TENANT (ENTREGABLE 3\)**

## **3.1. Arquitectura General de Doble Capa**

La arquitectura del proyecto separa el plano de control administrativo del plano de datos e infraestructura de las instituciones clientes:

16. **Plano de Control Central (Tenant Control Center — Ejecución Local):**  
    * **Frontend Administrativo:** Interfaz web desacoplada que presenta el catálogo de planes, el asistente de creación de 3 pasos, la consola de logs en vivo, la tabla de administración del ciclo de vida y el centro de monitoreo.  
    * **Backend Orquestador (API REST \+ Ejecutor de Procesos):** Servicio que gestiona la persistencia en la base de datos central (catalog\_plans, tenants, tenant\_alerts) y ejecuta de forma asíncrona en segundo plano los binarios de infraestructura (packer, terraform, aws cloudformation, escáner de seguridad y ansible-playbook), transmitiendo la salida estándar hacia la interfaz de usuario.  
    * **Servidor Central de Monitoreo (Prometheus \+ Grafana):** Instancia única centralizada que recolecta métricas de todos los tenants desplegados y dispara alertas vía Webhook hacia el backend cuando detecta anomalías.  
17. **Plano de Infraestructura por Tenant (Ejecución en Nube AWS):**  
    * Cada tenant aprovisionado despliega una tríada independiente de servidores (**RF-09**):  
      1. **Instancia 1 — Servidor Frontend:** Ubicado en subred pública con IP pública dedicada (que actúa como URL de la institución). Ejecuta Nginx sirviendo la aplicación web de asistencia.  
    * **Instancia 2 — Servidor Backend:** Ejecuta la API de registro de asistencia con Node.js/PM2, recibiendo peticiones desde el Frontend y comunicándose de forma exclusiva con la base de datos interna del mismo tenant.  
      1. **Instancia 3 — Servidor Base de Datos:** Ubicado en subred privada sin acceso público desde Internet. Ejecuta PostgreSQL escuchando únicamente al servidor Backend de su propio tenant en el puerto 5432\.

## **3.2. Topología de Red y Aislamiento por Tenant en la Nube**

El aislamiento entre instituciones se garantiza en tres niveles complementarios:

18. **Aislamiento de Red y Firewall:** Cada tenant cuenta con su propio grupo de seguridad (Security Group) que restringe el tráfico entrante exclusivamente a los puertos requeridos (80/443 en Frontend, puerto de API desde Frontend hacia Backend, y puerto 5432 exclusivamente desde la IP privada del Backend hacia la Base de Datos).  
19. **Aislamiento de Cómputo:** Ningún contenedor o proceso es compartido entre instituciones; cada cliente posee sus propias 3 máquinas virtuales independientes.  
20. **Aislamiento de Persistencia:** Cada institución posee su propia instancia y volumen de base de datos PostgreSQL independiente, haciendo técnicamente imposible que una consulta de un tenant acceda a registros de otro.

## **3.3. Flujo Secuencial de Creación y Aprovisionamiento en 3 Pasos**

1. **1\. Fase 1 (Captura y Dimensionamiento):** El administrador registra los datos de la institución (RF-07), selecciona el plan (RF-03) y elige el motor IaC (RF-08). El backend prepara el archivo de variables dinámicas con las dimensiones del plan.  
21. **2\. Fase 2 (Validación de Imágenes y Escaneo DevSecOps):** Se seleccionan los IDs de las tres Golden Images creadas con Packer y se registra el versionado (RF-13). A continuación, se ejecuta el escáner de seguridad sobre los scripts de infraestructura para verificar la ausencia de credenciales o llaves expuestas antes de autorizar el despliegue.  
22. **3\. Fase 3 (Aprovisionamiento IaC, Configuración Ansible y Alta en Grafana):**  
    * El motor IaC crea las 3 máquinas virtuales y genera automáticamente el inventario hosts.ini con las direcciones IP públicas y privadas.  
    * Ansible se conecta por SSH (usando salto ProxyCommand para alcanzar la base de datos privada), desencripta los secretos desde Ansible Vault, configura PostgreSQL, levanta el Backend y publica el Frontend personalizado con el nombre de la institución (RF-10, RF-21).  
    * El orquestador registra las nuevas IPs en Prometheus/Grafana y cambia el estado del tenant a ACTIVO.

# **4\. IMPLEMENTACIÓN DE HERRAMIENTAS DE INFRAESTRUCTURA COMO CÓDIGO Y DEVOPS**

## **4.1. Función de cada Tecnología en la Arquitectura (Sección 4\)**

| Tecnología | Categoría | Función Específica en la Plataforma Multi-Tenant |
| ----- | ----- | ----- |
| **Packer** | Creación de Imágenes (Golden Images) | Compila previamente 3 imágenes base (AMIs en AWS) para Frontend, Backend y Base de Datos con Nginx, Node.js, PostgreSQL y Node Exporter preinstalados, evitando instalaciones lentas desde cero en cada nuevo tenant. |
| **cloud-init** | Inicialización de Primer Arranque | Ejecuta scripts de arranque temprano al encender cada máquina virtual para configurar el nombre de host (hostname) con el identificador del tenant, preparar llaves SSH y ajustar parámetros base del sistema operativo. |
| **Terraform** | Motor Principal de Aprovisionamiento IaC | Motor Principal de Aprovisionamiento IaC \| Crea de forma declarativa la VPC, subredes públicas/privadas, Security Groups y las 3 instancias EC2 del tenant según el tamaño del plan elegido, exportando automáticamente el archivo hosts.ini con las IPs resultantes. |
| **AWS CloudFormation** | Motor Secundario y Comparación Técnica | Motor Secundario y Comparación Técnica \| Implementa la segunda alternativa de aprovisionamiento nativo en AWS mediante plantillas declarativas YAML/JSON y gestión de Stacks, desplegando la misma arquitectura aislada de 3 nodos y exportando los outputs de red para Ansible. |
| **Escáner de Seguridad** | Seguridad Preventiva (DevSecOps) | Analiza los directorios de infraestructura antes del despliegue para detectar secretos, tokens o llaves privadas expuestas en el código, mostrando el reporte en pantalla e impidiendo despliegues inseguros. |
| **Ansible \+ Ansible Vault** | Gestión de Configuración y Despliegue | Ejecuta los roles database, backend y frontend de forma idempotente sobre las 3 máquinas recién creadas. Utiliza Ansible Vault para inyectar contraseñas cifradas y configura la conexión entre capas sin intervención manual. |
| **Grafana \+ Prometheus** | Observabilidad y Alertas Operativas | Recolecta métricas de sistema, aplicación y base de datos de todos los tenants, permite filtrar dashboards por institución y emite alertas automáticas ante caídas o saturación de recursos. |

# 5\. OBSERVABILIDAD, MONITOREO Y ALERTAS CON GRAFANA (ENTREGABLE 5\)

## 5.1. Arquitectura Centralizada de Recolección de Métricas

Siguiendo el diseño de monitoreo centralizado, se dispone de una única instancia de Prometheus y Grafana que supervisa a todos los tenants creados. Cada máquina virtual generada a partir de las imágenes de Packer ya incluye activo el servicio prometheus-node-exporter (puerto 9100), mientras que el Backend expone métricas de salud y latencia HTTP y la Base de Datos reporta el estado activo del motor PostgreSQL.

## **5.2. Paneles y Métricas Supervisadas por Tenant (RF-25, RF-26, RF-27)**

El tablero de Grafana cuenta en su parte superior con los selectores dinámicos **Tenant** y **Entorno**, permitiendo inspeccionar de manera individual cada institución educativa a través de los siguientes indicadores mínimos obligatorios:

23. **1\. Disponibilidad General (UP / DOWN):** Estado en tiempo real de los 3 servidores del tenant (Frontend, Backend y Base de Datos).  
24. **2\. Uso de CPU y Memoria RAM:** Gráficas de series de tiempo con el porcentaje de carga de procesador y consumo de memoria por nodo.  
25. **3\. Capacidad de Almacenamiento en Disco:** Espacio utilizado vs. disponible según el volumen asignado por el plan (10 GB, 50 GB o 200 GB).  
26. **4\. Rendimiento del Backend (Latencia y Errores):** Tiempo de respuesta promedio en milisegundos y tasa de respuestas HTTP exitosas (2xx) frente a errores (4xx/5xx).  
27. **5\. Estado de la Base de Datos:** Indicador de conectividad del servicio PostgreSQL y número de conexiones activas del tenant.

## **5.3. Reglas de Alerta e Integración Webhook con la Plataforma (RF-28, RF-29)**

Se implementaron reglas de alerta automatizadas en Grafana que se activan cuando cualquiera de los tres servidores de un tenant deja de responder (*Instance Down*), cuando la tasa de errores del backend supera el umbral permitido o cuando el uso de CPU/Memoria excede el 85%. Al dispararse una alerta, Grafana notifica mediante un **Webhook HTTP** al endpoint /api/webhooks/grafana del *Tenant Control Center*, permitiendo que el administrador visualice el evento en la tabla de **Alertas y Eventos Recientes** de la plataforma junto con el tenant afectado y la marca de hora exacta.

# **6\. EVIDENCIAS DE PRUEBAS FUNCIONALES Y DE AISLAMIENTO (ENTREGABLE 7\)**

## **6.1. Matriz de Verificación de Criterios Mínimos de Aceptación**

* 

| Código | Criterio de Aceptación Evaluado | Escenario de Prueba Ejecutado | Resultado Verificado | Estado |
| ----- | ----- | ----- | ----- | :---: |
| **CA-01** | Crear tenants seleccionando distintos planes | Creación del Tenant 1 (Instituto San Marcos, Plan Básico) con Terraform y Tenant 2 (Universidad UPSA, Plan Estándar) con AWS CloudFormation | Se aprovisionaron los recursos con las capacidades correspondientes a cada plan | **CUMPLIDO** |
| **CA-02** | Desplegar Frontend, Backend y Base de Datos por tenant | Verificación en consola Cloud y ejecución de Ansible sobre las 3 instancias de cada institución | Cada tenant cuenta con 3 VMs operativas e interconectadas (Frontend, Backend y DB privada) | **CUMPLIDO** |
| **CA-03** | Comprobar aislamiento de datos entre tenants (Entregable 7\) | Inicio de sesión como Admin en Tenant 1, carga de Excel de estudiantes y verificación simultánea en la IP del Tenant 2 | Los estudiantes y asistencias registrados en el Tenant 1 no existen ni son accesibles desde el Tenant 2 | **CUMPLIDO** |
| **CA-04** | Suspender y reanudar un tenant conservando datos | Ejecución de acción Suspender sobre Tenant 1 (apagado de VMs) y posterior acción Reanudar | Las instancias se detienen reduciendo costos y al reanudarse mantienen intactos los alumnos cargados | **CUMPLIDO** |
| **CA-05** | Consultar en Grafana la salud por tenant y ver una alerta | Selección de filtro por tenant en Grafana y prueba de alerta al detener un servicio | Grafana grafica CPU, RAM, latencia y BD por tenant y registra la alerta con hora y tenant afectado | **CUMPLIDO** |
| **CA-06** | Eliminar un tenant previa confirmación de recursos | Clic en Eliminar, visualización del detalle de recursos a destruir y confirmación | Se eliminaron completamente las 3 máquinas virtuales y recursos de red del tenant en la nube | **CUMPLIDO** |

## **6.2. Registro Visual de Evidencias (Espacios para Capturas del Equipo)**

**Evidencia 1 — Creación de Tenants en la Plataforma Web y Ejecución del Escáner de Seguridad:**

| *\[Pegar aquí la captura de pantalla del formulario de creación de tenant, validación del escáner de seguridad y consola de logs en vivo\]* |
| :---: |

**Evidencia 2 — Recursos Aprovisionados en AWS (3 Servidores EC2 por Tenant, AMIs de Packer y Stacks de CloudFormation):**

| *\[Pegar aquí la captura de pantalla de la consola de AWS (EC2, AMIs de Packer y Stacks de CloudFormation) mostrando las 3 instancias en ejecución por cada tenant\]* |
| :---: |

**Evidencia 3 — Prueba de Aislamiento de Datos entre Tenant 1 y Tenant 2 (Entregable 7):**

| *\[Pegar aquí la captura comparativa mostrando la IP pública del Tenant 1 con su lista de estudiantes cargada desde Excel y la IP pública diferente del Tenant 2 completamente aislada\]* |
| :---: |

**Evidencia 4 — Tablero de Grafana Filtrado por Tenant y Alerta Operativa Registrada (Entregable 5):**

| *\[Pegar aquí la captura del dashboard de Grafana mostrando las métricas del tenant y la alerta visualizada en la plataforma\]* |
| :---: |

# **7\. MANUAL DE USUARIO DE LA PLATAFORMA — GUÍA NO TÉCNICA (ENTREGABLE 6\)**

## **7.1. Introducción para Administradores Institucionales**

Esta guía rápida está dirigida a personal administrativo o de gestión que utilizará el panel **Tenant Control Center** para dar de alta nuevas instituciones educativas, pausar o reactivar su servicio y verificar que sus sistemas funcionen correctamente, sin necesidad de conocimientos de programación ni administración de servidores.

## **7.2. Paso a Paso: Cómo Crear una Nueva Institución (Tenant)**

28. **1\. Abrir el asistente:** En el menú lateral izquierdo, haga clic en **Tenants** y presione el botón azul **\+ Crear tenant**.  
29. **2\. Paso 1 — Ingresar datos y elegir el Plan:**  
    * **Nombre de la institución:** Escriba el nombre oficial del colegio, instituto o universidad (ejemplo: *Instituto San Marcos*).  
    * **Identificador del tenant:** Se completará automáticamente un código corto sin espacios (ejemplo: *san-marcos*).  
    * **Correo del administrador:** Ingrese el correo electrónico de la persona encargada de esa institución.  
    * **Selecciona un plan:** Haga clic sobre la tarjeta que corresponda al tamaño de la institución:  
      1. **Básico:** Hasta 100 estudiantes (10 GB de base de datos).  
      2. **Estándar:** Hasta 1,000 estudiantes (50 GB de base de datos).  
      3. **Avanzado:** Hasta 5,000 estudiantes (200 GB de base de datos).  
    * Presione el botón **Continuar**.  
30. **3\. Paso 2 — Verificación automática de seguridad:**  
    * Verifique que el cuadro de **Revisión de Seguridad** aparezca en color verde indicando que la configuración es segura y presione **Continuar a Revisión**.  
31. **4\. Paso 3 — Confirmar y esperar la creación:**  
    * Revise el cuadro de resumen y haga clic en **Confirmar y Desplegar Tenant**.  
    * Verá una barra de progreso mientras el sistema prepara automáticamente los servidores. Al llegar al 100%, el sistema mostrará la **Dirección IP / Enlace de Acceso** de la nueva institución.

## **7.3. Paso a Paso: Cómo Administrar, Suspender, Reanudar o Eliminar una Institución**

Dentro del menú **Tenants**, encontrará el listado de todas las instituciones creadas con cuatro botones de acción rápida:

32. **Ingresar al Sistema de Asistencia de la Institución:** Haga clic sobre la dirección IP azul de la institución para abrir su página de asistencia, iniciar sesión como administrador de esa institución y subir el archivo Excel de estudiantes.  
33. **Actualizar Nombre (Editar):** Permite corregir o actualizar el nombre comercial de la institución en cualquier momento.  
34. **Suspender Servicio (Suspender):** Utilice este botón cuando una institución esté en periodo de vacaciones o pausa temporal. El sistema apagará sus servidores para no generar cobros en la nube, pero **guardará intactos todos sus estudiantes, cursos y asistencias**.  
35. **Reanudar Servicio (Reanudar):** Utilice este botón sobre una institución suspendida para volver a encender sus servidores y restablecer el acceso inmediato.  
36. **Eliminar Institución (Eliminar):** Utilice este botón únicamente cuando una institución dé de baja el servicio de forma definitiva. Aparecerá una ventana de confirmación indicando los recursos que se borrarán antes de proceder.

## **7.4. Paso a Paso: Cómo Consultar el Estado de Salud y las Alertas**

37. **1\.** Haga clic en la opción **Monitoreo** del menú lateral izquierdo.  
38. **2\.** En el selector superior **Filtrar por Institución (Tenant)**, elija la universidad o instituto que desea consultar.  
39. **3\.** Revise los indicadores de estado de sus 3 componentes (**Servidor Web Frontend, Servidor Backend y Base de Datos**), así como las gráficas de uso de memoria y procesador en **Grafana**.  
40. **4\.** Si algún servicio presenta un inconveniente o caída, aparecerá registrado automáticamente en la tabla inferior de **Alertas y Eventos Recientes** indicando qué institución fue afectada y a qué hora ocurrió.

# **8\. CONCLUSIONES**

El desarrollo del proyecto final permitió consolidar en una solución real y funcional todas las tecnologías estudiadas durante el segundo módulo. A través del **Tenant Control Center**, se transformó un despliegue que anteriormente se realizaba de forma manual por consola en una plataforma SaaS Multi-Tenant capaz de aprovisionar infraestructuras completas de tres capas en la nube con un solo clic.  
El uso combinado de **Packer** y **cloud-init** redujo significativamente los tiempos de preparación de las máquinas virtuales; la integración de múltiples motores de Infraestructura como Código (**Terraform y AWS CloudFormation**) junto con el **escáner de seguridad previo** garantizó despliegues reproducibles y libres de credenciales expuestas; **Ansible y Ansible Vault** aseguraron una configuración idempotente y el aislamiento estricto de las bases de datos de cada institución; y finalmente, **Grafana** dotó a la plataforma de visibilidad operativa y alertas tempranas por cada tenant.