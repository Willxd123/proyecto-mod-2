import type { Routes } from '@angular/router';
import { CreateComponent } from './pages/create.component';
import { MonitoringComponent } from './pages/monitoring.component';
import { LogsComponent } from './pages/logs.component';
import { PlansComponent } from './pages/plans.component';
import { TeamComponent } from './pages/team.component';
import { TenantsComponent } from './pages/tenants.component';
import { SecurityComponent } from './pages/security.component';
import { AuditComponent } from './pages/audit.component';
import { LoginComponent } from './pages/login.component';
import { authGuard } from './auth.service';

export const routes: Routes = [
  { path: 'login', component: LoginComponent, data: { title: 'Acceso' } },
  { path: '', pathMatch: 'full', redirectTo: 'planes' },
  { path: 'planes', canActivate: [authGuard], component: PlansComponent, data: { title: 'Catálogo de Planes y Golden AMIs (RF-01, RF-02)' } },
  { path: 'imagenes', redirectTo: 'planes' },
  { path: 'crear', canActivate: [authGuard], component: CreateComponent, data: { title: 'Crear tenant (RF-07 a RF-13)' } },
  { path: 'tenants', canActivate: [authGuard], component: TenantsComponent, data: { title: 'Lista y Ciclo de Vida de Tenants (RF-14 a RF-18)' } },
  { path: 'seguridad', canActivate: [authGuard], component: SecurityComponent, data: { title: 'Escáner de Seguridad (RF-11)' } },
  { path: 'monitoreo', canActivate: [authGuard], component: MonitoringComponent, data: { title: 'Monitoreo y Alertas en Grafana (RF-25 a RF-29)' } },
  { path: 'logs', canActivate: [authGuard], component: LogsComponent, data: { title: 'Logs de los tenants' } },
  { path: 'auditoria', canActivate: [authGuard], component: AuditComponent, data: { title: 'Auditoría de operaciones (RF-20)' } },
  { path: 'equipo', canActivate: [authGuard], component: TeamComponent, data: { title: 'División de 6 Integrantes y Mapeo de RFs' } },
  { path: '**', redirectTo: 'planes' },
];
