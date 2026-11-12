# Requisitos del proyecto académico de DevSecOps

## 1. Objetivo y alcance

Construir una plataforma web para crear y administrar tenants de la aplicación de registro de asistencia. Cada tenant representa una institución educativa con sus propios usuarios, cursos, estudiantes, registros y recursos de infraestructura.

La plataforma permite seleccionar un plan, aprovisionar y configurar recursos, desplegar la aplicación, gestionar su ciclo de vida y consultar métricas y alertas.

**Nube elegida: AWS.** El equipo confirmó que el docente permite elegir una sola nube. Azure y una arquitectura multinube quedan fuera del alcance.

**Tecnologías del panel acordadas durante la implementación:** Angular 20, NestJS, PostgreSQL y pnpm workspaces. La base central se denomina `proyecto_modulo_2`. El monorepo está en [proyecto-modulo-2](proyecto-modulo-2/README.md); las credenciales locales quedan fuera del documento y del repositorio. La aplicación de asistencia existente se integra como componente distinto del panel administrador.

El énfasis académico está en integrar las herramientas del módulo y explicar su funcionamiento. Se reutiliza la aplicación de asistencia existente. La plataforma administradora puede ejecutarse localmente; los tenants deben desplegarse en AWS. Cada integrante debe demostrar un aporte técnico a infraestructura, automatización, seguridad u observabilidad.

## 2. Fuentes y criterio de organización

| Fuente | Uso |
| --- | --- |
| [Documento del docente](scrip-pdf-a-md/DOCUMENTO%20QUE%20DIO%20EL%20DOCENTE%20Requisitos%20del%20proyecto%20finalv2.md) | Numeración original, requisitos y entregables. |
| [Transcripción original de la clase 10](clase-10-proyecto.transcripcion-original.md) | Aclaraciones de alcance y requisitos dejados como puntos extra. |
| [Guía para seis integrantes V3](scrip-pdf-a-md/Gu%C3%ADa%20Completa%20del%20Proyecto%20Final%20y%20Plan%20de%20Trabajo%20para%206%20Integrantes%20V3.md) | Propuestas de implementación y distribución de tareas. |
| Confirmación del equipo en esta conversación | Uso exclusivo de AWS autorizado por el docente. |

Se conservan los identificadores originales. El documento del docente salta de RF-21 a RF-25; no se inventan RF-22, RF-23 ni RF-24.

Se distinguen requisitos **obligatorios**, requisitos **simplificados en clase**, ampliaciones **opcionales / puntos extra** y **propuestas de implementación**. Los detalles técnicos de la guía no se convierten automáticamente en exigencias del docente.

## 3. Usuarios

| Usuario | Responsabilidad |
| --- | --- |
| Administrador de la plataforma | Consulta planes, crea y gestiona tenants, consulta despliegues, métricas y alertas. Editar planes queda como extra. |
| Administrador del tenant | Gestiona estudiantes, cursos e información de su institución mediante la aplicación existente. |
| Docente | Usa las funciones de asistencia conforme a sus permisos actuales. |
| Estudiante | Registra su asistencia conforme a sus permisos actuales. |

## 4. Requisitos funcionales del alcance base

### 4.1. Catálogo de planes

| ID | Requisito | Criterio de aceptación |
| --- | --- | --- |
| RF-01 | Ofrecer un catálogo de planes, tomando Básico, Estándar y Avanzado como referencia. | Se pueden consultar los planes disponibles. |
| RF-02 | Definir cómputo, almacenamiento, capacidad de base de datos y límites de uso por plan. | Cada ficha de plan coincide con los valores empleados al aprovisionar. |
| RF-03 | Seleccionar un plan y consultar sus características antes de crear un tenant. | El formulario muestra el plan elegido y sus recursos. |

El catálogo puede estar definido en configuración fija, según 1:53:09–1:55:59 de la clase. Definir límites y asignar capacidades por plan es obligatorio; el control automático de cuotas queda como extra en RF-05.

Los tamaños concretos de CPU, RAM, disco, base de datos y límites de estudiantes deben ser acordados por el equipo. Los valores mencionados en clase y en la guía son ejemplos.

### 4.2. Creación y despliegue

| ID | Requisito | Criterio de aceptación |
| --- | --- | --- |
| RF-07 | Crear un tenant con institución, identificador único, contacto, entorno y plan. Incluir la región AWS. | Se validan los campos y no se repite el identificador. Puede utilizarse solo el entorno Producción. |
| RF-08 | Elegir el motor de aprovisionamiento entre los implementados. | La selección ejecuta el motor correspondiente; las opciones no implementadas no se presentan como funcionales. |
| RF-09 | Crear recursos propios para frontend, backend y base de datos. | Cada tenant dispone de tres máquinas virtuales en AWS, basadas en imágenes propias de Packer, con aislamiento de red y datos. |
| RF-10 | Desplegar la aplicación y configurar su base de datos por tenant. | La aplicación queda accesible y opera sobre la base de datos de su institución. |
| RF-11 | Mostrar progreso, resultado y errores comprensibles. | La interfaz permite consultar logs y conocer el resultado sin exponer secretos. |
| RF-13 | Registrar versiones de aplicación, plantillas y herramientas por despliegue. | Se puede identificar qué versiones se utilizaron al crear el tenant. |

**Objetivo de demostración adoptado:** crear al menos dos tenants con planes distintos y utilizar dos motores IaC dentro de AWS. En 1:56:15–1:57:45 el docente pidió dos pruebas y expresó que lo ideal era usar al menos dos motores; la guía adopta ese objetivo. No es necesario implementar los cuatro motores.

La plataforma administradora puede correr localmente (1:58:59–1:59:36). Cada tenant puede utilizar una IP/URL diferente; no es necesario comprar dominios (2:14:00–2:14:34).

### 4.3. Ciclo de vida del tenant

| ID | Estado | Requisito y aceptación |
| --- | --- | --- |
| RF-14 | Obligatorio | Consultar tenants por nombre, estado, plan y entorno. Mostrar también motor y dirección de acceso. |
| RF-15 | Simplificado en clase | Editar datos básicos, como nombre o contacto. El mínimo verbal de 2:03:08–2:03:29 no exige actualizar aplicación ni infraestructura. |
| RF-16 | Obligatorio | Suspender y reanudar mediante operaciones reales sobre las máquinas, reflejando el resultado en la plataforma. |
| RF-17 | Obligatorio | Suspender los recursos definidos y conservar los datos según una política documentada. Al reanudar, comprobar el acceso a los datos conservados. |
| RF-18 | Obligatorio | Mostrar qué recursos y datos se eliminarán, solicitar confirmación y ejecutar la baja definitiva de los recursos propios del tenant. |

Suspender conserva los datos definidos por la política del proyecto; eliminar realiza la baja definitiva. Al reanudar se debe verificar la dirección de acceso y actualizar las referencias que hayan cambiado para asegurar el funcionamiento.

### 4.4. Aplicación de asistencia

| ID | Requisito | Criterio de aceptación |
| --- | --- | --- |
| RF-21 | Conservar las funciones actuales de la aplicación de asistencia. | Después del despliegue se puede acceder como administrador, importar el Excel de estudiantes, gestionar cursos y registrar asistencia según los permisos existentes. |

La aclaración de 2:04:55–2:05:24 permite reutilizar lo desarrollado. Se debe verificar que funciona en cada tenant. No corresponde construir un sistema nuevo de notas.

### 4.5. Observabilidad y alertas

| ID | Requisito | Criterio de aceptación |
| --- | --- | --- |
| RF-25 | Integrar Grafana para consultar salud y rendimiento. | El tablero presenta datos reales de los servicios por tenant. |
| RF-26 | Mostrar disponibilidad, CPU, memoria, latencia, errores del backend y estado de la base de datos. | Se visualizan todas las métricas mínimas. Disco y volumen de peticiones complementan lo mencionado en clase. |
| RF-27 | Consultar métricas por tenant y entorno. | Se identifican y filtran ambos valores; se permite un único entorno Producción. |
| RF-28 | Generar alertas por indisponibilidad, aumento de errores o límites de recursos. | Se definen condiciones y umbrales y se demuestra una alerta. |
| RF-29 | Mostrar alertas y eventos recientes en la plataforma. | Cada registro identifica el tenant afectado y la hora de detección. |

Grafana puede alojarse junto a la plataforma o en una máquina adicional, a criterio del equipo (2:54:30–2:54:41). Prometheus, exporters y umbrales como 30 segundos u 85 % son propuestas de la guía, no condiciones impuestas por el docente.

## 5. Seguridad, operación y arquitectura

Los códigos RNF son locales a este documento.

| ID local | Requisito | Evidencia esperada |
| --- | --- | --- |
| RNF-01 | Aislar datos y accesos por tenant. | Recursos y credenciales separados, más una prueba de que un tenant no puede consultar datos de otro. |
| RNF-02 | Proteger secretos en código, repositorios, imágenes y logs. | Ausencia de secretos incrustados y mecanismo documentado para suministrarlos sin exponerlos. |
| RNF-03 | Escanear configuraciones antes del aprovisionamiento y mostrar hallazgos de credenciales expuestas. | Prueba con datos ficticios y resultado visible sin revelar el valor del secreto. Exigencia verbal de 2:06:53–2:07:18. |
| RNF-04 | Aprovisionar mediante trabajos en segundo plano y permitir consultar su estado. | La interfaz sigue respondiendo durante la ejecución y muestra su resultado. |
| RNF-05 | Repetir operaciones de forma segura y consistente. | Una segunda ejecución controlada no crea recursos innecesarios ni mezcla tenants. No implica el reintento avanzado de RF-12. |
| RNF-06 | Documentar almacenamiento y protección del estado IaC. | Se explica ubicación, separación por tenant y control de acceso. Se conserva este requisito escrito, sin exclusión verbal clara. |
| RNF-07 | Mostrar errores útiles sin exponer secretos. | Los fallos pueden entenderse desde la interfaz y no revelan credenciales. |
| RNF-08 | Controlar recursos de prueba mediante suspensión y eliminación. | Se demuestra la operación real en AWS y se documenta qué se conserva o elimina. |

**Simplificación de logs:** en 2:07:20–2:07:35 el docente permitió mostrar el log sin persistir todo el historial. La auditoría detallada de operaciones queda como extra. El registro de versiones de RF-13 se mantiene.

Como propuesta de seguridad, bloquear el despliegue si el escáner detecta secretos y corregir los hallazgos antes de continuar. La exigencia verbal explícita es ejecutar el escaneo y mostrar sus hallazgos.

## 6. Herramientas y flujo de integración

| Herramienta | Función y alcance |
| --- | --- |
| Packer | Crear previamente imágenes propias con las dependencias de frontend, backend y base de datos. Reutilizarlas al crear tenants. |
| Terraform u OpenTofu | Motor principal recomendado para aprovisionar según el plan y las imágenes seleccionadas. |
| Segundo motor IaC | Elegir otro entre Terraform, OpenTofu, Pulumi o CloudFormation para demostrar una segunda alternativa dentro de AWS. |
| cloud-init | Configuración inicial de primer arranque que no esté incluida en la imagen. |
| Ansible | Configuración posterior, parámetros por tenant, conexiones, usuarios y despliegue de la aplicación. |
| Escáner de seguridad | Revisar configuraciones antes del despliegue y presentar hallazgos en la plataforma. |
| Grafana | Visualizar métricas y gestionar alertas con una fuente de datos compatible; Prometheus es una opción. |

Flujo esperado:

1. Preparar y registrar las imágenes con Packer, antes de solicitar tenants.
2. Capturar institución, plan, región, entorno y motor en la plataforma.
3. Ejecutar el escaneo de seguridad y mostrar el resultado.
4. Ejecutar el motor IaC en segundo plano utilizando las imágenes propias.
5. Aplicar cloud-init y esperar su finalización antes de las tareas de Ansible que dependan de él.
6. Configurar y desplegar con Ansible; comprobar frontend, backend y base de datos.
7. Publicar la dirección del tenant y habilitar métricas, alertas y acciones de ciclo de vida.

El equipo debe explicar la función e integración de cada herramienta y evitar duplicar instalaciones entre Packer, cloud-init y Ansible.

## 7. Requisitos opcionales y puntos extra

| ID / tema | Ampliación | Referencia de clase |
| --- | --- | --- |
| RF-04 | Editar planes desde la plataforma. Consultar el catálogo sigue siendo obligatorio. | 2:00:54–2:01:39. |
| RF-05 | Control automático de todas las cuotas del plan. | 2:01:13–2:01:39. |
| RF-06 | Cambiar de plan y mostrar el impacto sobre recursos. | 1:57:49–1:58:33; exclusión reiterada en 2:11:23. |
| RF-12 | Reintentar operaciones fallidas sin duplicar recursos desde la plataforma. | 2:02:41–2:02:48. |
| RF-15 completo | Actualizar aplicación e infraestructura desde la plataforma. | El mínimo se reduce a datos básicos en 2:03:08–2:03:29. |
| RF-19 | Respaldar y restaurar un tenant. | 2:04:41–2:04:52; exclusión reiterada en 2:11:32. |
| RF-20 | Registrar quién inició cada operación, cuándo y su resultado. | 2:04:41–2:04:52. |
| Historial persistente | Almacenar y consultar todo el historial de operaciones y logs. | Simplificado en 2:07:29–2:07:35. |
| Políticas avanzadas de costos | Automatizar apagados o limpieza adicionales a los controles manuales del ciclo de vida. | Último punto dejado opcional en 2:07:55–2:08:02. |

**Discrepancia por confirmar:** en 2:11:40 el docente vuelve a leer el criterio de revisar una operación fallida y reintentarla, aunque previamente dejó RF-12 como avanzado y simplificó el historial. Se clasifica como extra por esas aclaraciones expresas; conviene confirmarlo antes de cerrar la rúbrica final.

Las tablas, endpoints, WebSockets/SSE, Ansible Vault, túneles SSH y versiones de software de la guía son opciones de implementación. Tampoco se incorpora como nueva exigencia un pipeline CI/CD completo, Kubernetes o escáneres adicionales: pueden añadirse si el tiempo y la evaluación lo justifican.

## 8. Entregables

| N.º original | Entregable | Contenido mínimo |
| --- | --- | --- |
| 1 | Código de frontend y backend | Plataforma administradora y aplicación de asistencia; enlaces a los repositorios. |
| 2 | Código de infraestructura y configuración | Packer, motores IaC elegidos, cloud-init, Ansible, escaneo y observabilidad. |
| 3 | Diagrama de arquitectura y flujo | Plataforma, recursos AWS por tenant, aislamiento y secuencia de creación. |
| 4 | Catálogo de planes | Capacidades y límites concretos, consistentes con IaC. |
| 5 | Tablero de Grafana | Enlace y evidencia de métricas, filtros y alerta de ejemplo. |
| 6 | Instrucciones de ciclo de vida | Crear, editar datos, suspender, reanudar y eliminar. Pueden explicarse en el video según 2:09:19, con un manual sencillo para usuario no técnico. Respaldar y restaurar solo si se implementan como extras. |
| 7 | Evidencia de aislamiento | Pruebas de separación de datos y rechazo de acceso entre tenants. |
| 8 | Demostración y presentación del diseño | Video de máximo 15 minutos con contribuciones técnicas de todos los integrantes. |

Solo el líder carga el documento final con los nombres del equipo, enlaces al código y enlace al video (2:57:36–2:58:16). Puede alojarse el video en Google Drive con acceso para el docente. Se pueden pausar las esperas largas de aprovisionamiento durante la grabación (2:15:24–2:16:05).

La fecha y el formato definitivo deben verificarse en la plataforma del curso: las menciones relativas a días de la semana de la grabación no establecen una fecha vigente.

## 9. Lista de aceptación para la defensa

Las casillas están pendientes de comprobación. Este documento organiza requisitos; no certifica que ya estén implementados.

- [ ] Mostrar planes, capacidades y límites.
- [ ] Crear dos tenants con planes distintos en AWS y demostrar los dos motores adoptados.
- [ ] Mostrar tres máquinas por tenant creadas desde imágenes propias de Packer.
- [ ] Explicar y demostrar cloud-init y Ansible.
- [ ] Acceder a cada aplicación de asistencia y comprobar sus funciones actuales.
- [ ] Mostrar el escaneo previo con datos ficticios y sin exponer secretos.
- [ ] Consultar progreso, logs y resultado sin bloquear la interfaz.
- [ ] Identificar versiones por despliegue.
- [ ] Consultar tenants y editar al menos un dato básico.
- [ ] Suspender y reanudar conservando los datos definidos.
- [ ] Mostrar confirmación y eliminación real de un tenant de prueba.
- [ ] Consultar métricas mínimas en Grafana por tenant y entorno.
- [ ] Provocar una alerta y comprobar tenant y hora en la plataforma.
- [ ] Probar que un tenant no puede consultar datos de otro. Tener IPs diferentes no es evidencia suficiente.
- [ ] Explicar dónde se guarda y cómo se protege el estado IaC.
- [ ] Entregar código, diagrama, catálogo, manual, tablero y video con participación técnica individual.

## 10. Distribución propuesta para seis integrantes

Esta distribución adapta la guía V3 a AWS e incorpora el mapeo actualizado compartido por el equipo. Es planificación, no un requisito adicional ni una garantía de cargas idénticas. **Nosotros somos el integrante 1.** Las responsabilidades compartidas se dividen por entregables para evitar que un mismo RF quede sin responsable de integración.

| Integrante | Responsabilidad técnica | Entrega para integración |
| --- | --- | --- |
| 1 — nuestro equipo | Packer, cloud-init y catálogo de planes | RF-01, RF-02, aporte a RF-09 y RF-13, sección de tecnologías y Entregable 4. Entrega imágenes, configuración inicial, catálogo consultable y metadatos de versiones. |
| 2 | Motor IaC principal y formulario de creación | RF-03, RF-07, RF-08 y RF-09; aislamiento de red y protección del estado IaC. Desarrolla el Paso 1 del panel y consume los planes e imágenes del integrante 1. |
| 3 | Segundo motor IaC y escaneo | RF-08, RF-09, aporte a RF-11 y RF-13; seguridad previa al despliegue. Entrega el segundo motor, la vista de escaneo y sus resultados. |
| 4 | Ansible y aplicación de asistencia | RF-10, RF-21, aislamiento de base de datos, gestión de secretos y Entregable 7. Entrega despliegue parametrizado y pruebas de aislamiento. Ansible Vault es el mecanismo propuesto. |
| 5 | Orquestación y ciclo de vida | RF-11, RF-14, RF-15, RF-16, RF-17 y RF-18; trabajos en segundo plano y logs en pantalla. Integra los comandos de los demás y entrega la lista de tenants y sus acciones. |
| 6 — Team Lead | Observabilidad y coordinación | RF-25 a RF-29, documentación para usuario no técnico y Entregables 3, 5, 6 y 8. Consolida la entrega con los aportes técnicos de todos. |

### 10.1. Panel web: pantallas y responsables

El panel administrador es parte de la solución y debe conectar la interfaz con operaciones reales. No basta con una maqueta. Se distribuye así:

| Pantalla o paso | Responsable principal | Dependencias y resultado |
| --- | --- | --- |
| Catálogo / Planes e imágenes | Integrante 1 | Muestra planes y capacidades desde la fuente acordada. La guía también propone mostrar las AMIs disponibles y sus versiones. Es una vista de consulta; no exige editar planes. |
| Paso 1: Crear tenant | Integrante 2 | Formulario de institución, identificador, contacto, región, entorno, plan y motor. Consume el catálogo e imágenes del integrante 1, valida los datos y muestra un resumen de la solicitud. |
| Paso 2: Validación de seguridad | Integrante 3 | Ejecuta el escáner sobre la configuración de la solicitud y muestra el resultado sin exponer secretos. |
| Paso 3: Aprovisionamiento | Integrante 5 | Inicia el trabajo en segundo plano y presenta progreso, logs y resultado de IaC y Ansible. Integra los motores de los integrantes 2 y 3 y la configuración del integrante 4. |
| Lista y detalle de tenants | Integrante 5 | Consulta, edición básica, dirección de acceso, suspensión, reanudación y eliminación con confirmación. |
| Aplicación de asistencia por institución | Integrante 4 | Mantiene las funciones existentes y comprueba su conexión con la base de datos correspondiente. |
| Monitoreo y alertas | Integrante 6 | Presenta métricas y alertas por tenant y acceso al tablero de Grafana. |

La división en tres pasos sigue la propuesta de la guía; puede resolverse en una sola pantalla si conserva las funciones y las responsabilidades acordadas. El integrante 1 no desarrolla todo el formulario de creación: entrega e integra los datos que permiten seleccionar correctamente el plan y las imágenes.

### 10.2. Trabajo concreto del integrante 1

**Papel de arranque e integración:** además de las imágenes y el catálogo, el integrante 1 prepara una base compartida de frontend y backend para que los demás amplíen el mismo proyecto. Esta es una ampliación organizativa propuesta para el equipo, no una obligación adicional impuesta por el docente. Preparar la base no significa implementar todas las funciones de administración de tenants.

1. **Imágenes Packer:** preparar las imágenes de frontend, backend y base de datos para AWS, comprobar su creación y entregar sus identificadores, región, rol y versión a los integrantes 2 y 3. Este es nuestro aporte a RF-09; los motores IaC crean las máquinas.
2. **cloud-init:** entregar la configuración de primer arranque por rol, acordando con el integrante 4 qué tareas corresponden a Ansible para evitar duplicaciones.
3. **Catálogo de planes:** definir con el equipo las capacidades y límites de cada plan, preparar la tabla `catalog_plans` y su carga inicial, y exponer su consulta para cumplir RF-01 y RF-02.
4. **Integración web:** entregar el servicio de consulta del catálogo y conectar la vista de Planes e imágenes propuesta en la guía. El integrante 2 reutiliza estos datos en su selector y resumen del formulario de creación. `GET /api/plans` y `GET /api/golden-images` son rutas propuestas que deben acordarse con el equipo.
5. **Versiones:** entregar los metadatos de imágenes y plantillas de nuestra parte. Coordinar con los integrantes 2, 3, 4 y 5 para que cada despliegue conserve también las versiones reales del motor, aplicación y configuración utilizadas. RF-13 es una responsabilidad de integración, no se completa únicamente mostrando la versión de Packer.
6. **Entregable 4:** elaborar el catálogo documentado, consistente con los datos que consume la plataforma y con los valores que aplican los motores IaC.
7. **Defensa:** mostrar nuestras imágenes, explicar cloud-init y demostrar que el catálogo alimenta el panel de creación. Explicar cómo se relacionan plan, imagen y recursos aprovisionados.

**Criterio de cierre de nuestra parte:** los integrantes 2 y 3 pueden consumir los planes, identificadores de AMIs y configuración inicial sin volver a definirlos; el formulario muestra los datos correctos y el despliegue conserva la referencia a las versiones utilizadas.

### 10.2.1. Base común que entrega el integrante 1

El proyecto incluye dos interfaces distintas: **el panel administrador de tenants**, que construye el equipo, y **la aplicación de asistencia por tenant**, que se reutiliza. La base web de esta sección corresponde al panel administrador.

| Base compartida | Entrega del integrante 1 | Extensión de los demás integrantes |
| --- | --- | --- |
| Frontend del panel | Proyecto ejecutable, estructura de páginas, navegación, diseño básico y componentes compartidos de formulario, tabla, mensajes y carga. Implementar primero los componentes necesarios para el catálogo. | Cada responsable desarrolla la funcionalidad de sus páginas sobre esta base. |
| Páginas de referencia | Catálogo funcional y rutas o páginas iniciales para Crear tenant, Tenants, Seguridad y Monitoreo, indicando claramente cuáles están pendientes. | Integrante 2 completa creación; 3 seguridad; 5 progreso, lista y ciclo de vida; 6 monitoreo. |
| Backend | Proyecto ejecutable, configuración por entorno, conexión a la base central, mecanismo de migraciones y consulta del catálogo. | Cada responsable agrega sus servicios y operaciones sin crear un backend independiente. |
| Base de datos | Migración y carga inicial de `catalog_plans`; acordar con los integrantes 2, 5 y 6 la estructura inicial de `tenants` y `tenant_alerts`. | Los responsables de tenants y alertas implementan y mantienen sus migraciones y consultas. |
| Contratos | Documento compartido de campos, identificadores, formatos de respuesta, errores y estados; especificar entradas y salidas de cada herramienta. | Cada integrante implementa su contrato y comunica los cambios antes de alterar a los consumidores. |
| Ejecución local | Instrucciones de instalación y arranque, archivo de ejemplo de variables sin secretos y datos ficticios identificados. | Cada integrante mantiene las instrucciones de su módulo. |
| Infraestructura inicial | Imágenes de Packer, metadatos y plantillas cloud-init. | Integrantes 2 y 3 consumen esas referencias en sus motores IaC. |

No corresponde al integrante 1 implementar de antemano el formulario completo de creación, el ejecutor de trabajos, las acciones de suspensión/eliminación ni los tableros de monitoreo. Puede dejar sus rutas y componentes base preparados; las operaciones funcionales mantienen los responsables de la sección 10.1.

### 10.2.2. Entregas incrementales del 1 al 6

La numeración representa una cadena de integración; no obliga a esperar a que termine por completo cada compañero. Con los contratos acordados, los integrantes pueden avanzar usando datos ficticios y sustituirlos luego por resultados reales.

1. **Integrante 1 → equipo:** entrega una primera versión ejecutable del panel y API con catálogo, instrucciones y contratos. Después entrega las imágenes reales y cloud-init, sin retrasar el arranque web hasta terminar Packer.
2. **Integrante 2 → integrantes 3, 4 y 5:** integra el formulario con el catálogo, entrega el motor principal y sus salidas: recursos creados, direcciones e inventario. El contrato de solicitud debe servir también para el segundo motor.
3. **Integrante 3 → integrantes 4 y 5:** integra escaneo y segundo motor con el mismo formato de salidas. El segundo motor no debe requerir haber desplegado primero con el motor principal.
4. **Integrante 4 → integrante 5:** consume el inventario de cualquiera de los motores y entrega el comando de configuración/despliegue, sus parámetros y la comprobación de aplicación funcional y aislamiento.
5. **Integrante 5 → integrante 6:** conecta la ejecución completa, implementa logs y ciclo de vida y entrega los datos de los tenants activos y los cambios de estado necesarios para monitoreo.
6. **Integrante 6 → equipo:** integra monitoreo y alertas sobre los tenants reales y consolida la documentación y la defensa con evidencias aportadas por todos.

**Primera entrega útil del integrante 1:** cualquier compañero puede descargar el proyecto, configurarlo siguiendo las instrucciones, iniciar frontend y backend, consultar planes reales del catálogo y ubicar dónde desarrollar su módulo. Las pantallas pendientes no deben simular operaciones exitosas sobre AWS.

### 10.3. Base de datos central simplificada

Se adopta como propuesta del equipo la simplificación compartida: **tres tablas centrales**, sin tablas adicionales para historial de logs, escaneos o respaldos. Esta base de datos pertenece al panel administrador y es distinta de las bases de datos de asistencia de los tenants.

| Tabla | Contenido y responsable |
| --- | --- |
| `catalog_plans` | Identificador, nombre, capacidades y límites del plan. Integrante 1 prepara estructura y carga inicial. No incluir políticas de respaldo diarias o semanales como prestaciones del alcance base. |
| `tenants` | Identidad, contacto, plan, entorno, región, motor, estado y referencias a recursos y dirección de acceso. Debe conservar también los metadatos de versiones de RF-13, por ejemplo en campos estructurados, y la configuración de plan aplicada al despliegue. Integrantes 2 y 5 coordinan su uso y reciben metadatos de los demás. |
| `tenant_alerts` | Tenant afectado, tipo o descripción de alerta, estado y hora de detección. Integrante 6. |

Para mantener solo tres tablas, el registro de imágenes puede resolverse mediante un manifiesto de configuración versionado que consulte el backend; no se exige una tabla `golden_images`. Su estructura y ruta deben acordarse antes de integrar los motores. Los identificadores de imágenes no son secretos; las credenciales no deben incluirse en ese manifiesto.

Los logs del escáner y del despliegue se muestran en pantalla durante la ejecución, sin exigir persistencia histórica. Se debe conservar el estado y resultado de la operación y permitir consultar el trabajo mientras está activo; usar solo tres tablas no elimina esa función. Los metadatos por despliegue de RF-13 tampoco se sustituyen por logs temporales.

Quitar RF-19 del alcance base significa retirar de las tarjetas promesas de respaldo automático y no desarrollar respaldo/restauración como obligación. La conservación de datos al suspender, exigida por RF-17, permanece.

Orden recomendado: acordar planes y contratos de integración → preparar imágenes y motores → integrar configuración y escaneo → completar ciclo de vida y observabilidad → verificar aceptación → grabar y entregar. Utilizar entradas de ejemplo mientras se reciben las salidas reales de otros integrantes.

## 11. Decisiones pendientes del equipo

1. Elegir dos motores IaC y región AWS.
2. Fijar capacidades y límites concretos de los planes.
3. Definir gestión de secretos y protección del estado por tenant.
4. Documentar qué datos se conservan al suspender y qué recursos se borran al eliminar.
5. Elegir fuente de métricas, ubicación de Grafana y umbrales de alerta.
6. Acordar identificadores, salidas IaC, inventario y estados de las operaciones.
7. Confirmar la discrepancia sobre reintentos e historial y verificar fecha y formato de entrega.
