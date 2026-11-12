import type { Routes } from '@angular/router';
import { CreateComponent } from './pages/create.component';
import { PendingComponent } from './pages/pending.component';
import { PlansComponent } from './pages/plans.component';
import { TeamComponent } from './pages/team.component';
import { TenantsComponent } from './pages/tenants.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'planes' },
  { path: 'planes', component: PlansComponent, data: { title: 'Catálogo de Planes y Golden AMIs (RF-01, RF-02)' } },
  { path: 'imagenes', redirectTo: 'planes' },
  { path: 'crear', component: CreateComponent, data: { title: 'Crear tenant (RF-07 a RF-13)' } },
  { path: 'tenants', component: TenantsComponent, data: { title: 'Lista y Ciclo de Vida de Tenants (RF-14 a RF-18)' } },
  { path: 'seguridad', component: PendingComponent, data: { title: 'Escáner de Seguridad y Versiones (RF-11, RF-13)', heading: 'Escáner de seguridad pre-deploy y versiones', rf: 'RF-11, RF-13, RNF-Seguridad', owner: 'Integrante 3',
    description: 'Inspecciona los archivos de infraestructura para impedir secretos expuestos y muestra las versiones usadas en cada despliegue.',
    tasks: ['Consumir la solicitud validada de creación.', 'Ejecutar el escáner y ocultar valores sensibles.', 'Registrar versiones de app, Packer, motor IaC, Ansible y Grafana (RF-13).'] } },
  { path: 'monitoreo', component: PendingComponent, data: { title: 'Monitoreo y Alertas en Grafana (RF-25 a RF-29)', heading: 'Salud, métricas y alertas con Grafana', rf: 'RF-25 a RF-29', owner: 'Integrante 6',
    description: 'Filtra métricas por tenant y entorno: disponibilidad, CPU, RAM, disco, latencia, errores del backend y estado de PostgreSQL.',
    tasks: ['Configurar el recolector y los dashboards.', 'Integrar los exporters preinstalados en las imágenes del Integrante 1 (node_exporter 9100, postgres_exporter).', 'Mostrar alertas por tenant y hora de detección.'] } },
  { path: 'equipo', component: TeamComponent, data: { title: 'División de 6 Integrantes y Mapeo de RFs' } },
  { path: '**', redirectTo: 'planes' },
];
