import { Component } from '@angular/core';

@Component({
  template: `
    <section class="view">
      <div class="banner">
        <h1>División equilibrada de los 6 integrantes y mapeo de requisitos funcionales (RF)</h1>
        <p>Los requisitos tachados por el docente (<strong>RF-04, RF-05, RF-06, RF-12, RF-19 y RF-20</strong>) quedan fuera para concentrar el trabajo en lo obligatorio. El monorepo incluye instrucciones por integrante en <code>docs/agentes</code>.</p>
      </div>
      <div class="team-grid">
        @for (member of members; track member.number) {
          <article class="member" [class.mine]="member.number === 1">
            <header><span class="who">Integrante {{ member.number }}{{ member.number === 6 ? ' (Team Lead)' : '' }}</span><span class="rf-badge">{{ member.rf }}</span></header>
            <h3>{{ member.title }}</h3>
            <p>{{ member.description }}</p>
            <p class="footer-note">Guía: docs/agentes/{{ member.file }}</p>
          </article>
        }
      </div>
      <div class="card">
        <div class="card-head"><div><h2>Acuerdos de integración</h2></div></div>
        <ul class="dot-list">
          <li>Catálogo e imágenes del integrante 1 alimentan ambos motores.</li><li>Dos motores, un contrato de entrada y salida; estado por tenant.</li>
          <li>Packer prepara imágenes antes de solicitar tenants.</li><li>El orquestador conecta escaneo, IaC, Ansible y métricas.</li>
          <li>Cuenta IAM compartida; recursos identificados por integrante, tenant y ejecución.</li><li>La clave .pem y las credenciales permanecen fuera de Git.</li>
        </ul>
      </div>
    </section>
  `,
})
export class TeamComponent {
  readonly members = [
    { number: 1, rf: 'RF-01, 02, 09, 13', title: 'Packer (Golden Images) + cloud-init + catálogo', description: 'Compila las 3 AMIs con Packer, programa los cloud-init (swap 2 GiB, zona horaria, hostname y SSH) y mantiene las tablas catalog_plans y golden_images (Entregable 4).', file: '01-imagenes-catalogo.md' },
    { number: 2, rf: 'RF-03, 07, 08, 09', title: 'Terraform / OpenTofu + Paso 1', description: 'Redes, Security Groups y tamaños de VM por plan usando las AMIs del Integrante 1; genera el inventario y desarrolla el Paso 1 y la tabla tenants.', file: '02-motor-principal.md' },
    { number: 3, rf: 'RF-08, 09, 11, 13', title: 'Pulumi / CloudFormation + escáner DevSecOps', description: 'Segundo motor IaC con las AMIs del Integrante 1 y escáner de secretos expuestos antes de desplegar (Paso 2).', file: '03-motor-seguridad.md' },
    { number: 4, rf: 'RF-10, 21 · E7', title: 'Ansible + Vault + app de asistencia', description: 'Configura BD, backend y frontend por SSH con secretos cifrados, personaliza la app por tenant y demuestra el aislamiento.', file: '04-configuracion-asistencia.md' },
    { number: 5, rf: 'RF-11, 14 a 18', title: 'Orquestador en 2.º plano + ciclo de vida', description: 'Logs en vivo (Paso 3) y lista de tenants con actualizar nombre, suspender, reanudar y eliminar.', file: '05-orquestacion.md' },
    { number: 6, rf: 'RF-25 a 29', title: 'Grafana + alertas + manual y video', description: 'Prometheus/Grafana por tenant, alertas hacia la vista de monitoreo y consolidación del manual y el video final.', file: '06-observabilidad.md' },
  ];
}
