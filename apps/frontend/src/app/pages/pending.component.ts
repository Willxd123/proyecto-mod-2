import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

@Component({
  template: `
    <section class="view">
      <div class="view-head">
        <div><h1>{{ data['heading'] }}</h1><p>{{ data['description'] }}</p></div>
        <div class="rf-badges"><span class="rf-badge">{{ data['rf'] }} · {{ data['owner'] }}</span><span class="pill warn plain">Pendiente</span></div>
      </div>
      <div class="card empty">
        <div class="empty-icon">◇</div><h2>Espacio listo para integrar</h2>
        <p>Esta sección forma parte de la base común. Todavía no ejecuta operaciones ni muestra datos simulados.</p>
        <ul class="todo">@for (task of data['tasks']; track task) { <li>{{ task }}</li> }</ul>
      </div>
    </section>
  `,
})
export class PendingComponent { readonly data = inject(ActivatedRoute).snapshot.data; }
