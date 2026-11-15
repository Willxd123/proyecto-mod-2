import { AfterViewChecked, Component, ElementRef, computed, input, signal, viewChild } from '@angular/core';

export interface LogLine { occurred_at: string; stage: string | null; status: string; message: string; }
type Filter = 'all' | 'steps' | 'problems';

/**
 * Consola del registro en vivo de una operación (RF-11): hora, etapa y mensaje de cada paso real, con colores,
 * seguimiento automático, filtros y descarga como archivo de texto.
 */
@Component({
  selector: 'app-log-console',
  template: `
    <div class="log-head">
      <span class="count">{{ shown().length }} de {{ lines().length }} líneas</span>
      <span class="spacer"></span>
      <label>Ver <select aria-label="Filtro del registro" (change)="filter.set(value($event))">
        <option value="all">todo</option><option value="steps">pasos principales</option><option value="problems">errores y avisos</option></select></label>
      <label class="follow"><input type="checkbox" [checked]="follow()" (change)="follow.set(checked($event))"> seguir</label>
      <button type="button" class="btn sm" (click)="download()" [disabled]="!lines().length">Descargar .log</button>
    </div>
    <div #scroller class="log-body" role="log" aria-live="polite" aria-label="Registro de la operación">
      @for (line of shown(); track $index) {
        <div class="row" [class.err]="kind(line) === 'err'" [class.warn]="kind(line) === 'warn'" [class.ok]="kind(line) === 'ok'" [class.task]="kind(line) === 'task'" [class.dim]="kind(line) === 'dim'">
          <span class="time">{{ time(line.occurred_at) }}</span><span class="stage">{{ line.stage ?? line.status }}</span><span class="msg">{{ line.message }}</span>
        </div>
      } @empty { <div class="row dim">{{ lines().length ? 'Ninguna línea coincide con el filtro.' : 'Esperando eventos…' }}</div> }
      @if (running()) { <div class="row dim"><span class="time"></span><span class="stage">···</span><span class="msg">en curso; no cierres el panel</span></div> }
    </div>
  `,
  styles: [`
    :host{display:block}
    .log-head{display:flex;align-items:center;gap:12px;font-size:11px;color:#94a3b8;margin-bottom:6px;flex-wrap:wrap}
    .log-head .spacer{flex:1}
    .log-head select{font-size:11px;padding:2px 4px;border-radius:4px}
    .log-head .follow{display:flex;align-items:center;gap:4px}
    .log-body{max-height:380px;overflow:auto;background:#020617;border:1px solid #1e293b;border-radius:8px;padding:8px 10px;font-family:var(--mono);font-size:11px;line-height:1.6}
    .row{display:flex;gap:8px;color:#e2e8f0;white-space:pre-wrap;word-break:break-word}
    .row .time{color:#64748b;flex-shrink:0;min-width:58px}
    .row .stage{color:#38bdf8;flex-shrink:0;min-width:72px}
    .row.err .msg{color:#f87171}
    .row.warn .msg{color:#fbbf24}
    .row.ok .msg{color:#34d399}
    .row.task .msg{color:#7dd3fc}
    .row.dim .msg,.row.dim{color:#94a3b8}
  `],
})
export class LogConsoleComponent implements AfterViewChecked {
  readonly lines = input.required<LogLine[]>();
  readonly running = input(false);
  readonly name = input('operacion');
  readonly filter = signal<Filter>('all');
  readonly follow = signal(true);
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private lastCount = 0;

  readonly shown = computed(() => {
    const all = this.lines();
    if (this.filter() === 'problems') return all.filter(line => this.kind(line) === 'err' || this.kind(line) === 'warn');
    if (this.filter() === 'steps') return all.filter(line => this.kind(line) === 'task' || this.kind(line) === 'ok' || this.kind(line) === 'err' || !/^\s/.test(line.message) && !line.message.startsWith('  '));
    return all;
  });

  /** Clasifica una línea para colorearla: error, aviso, éxito, paso principal o detalle secundario. */
  kind(line: LogLine): 'err' | 'warn' | 'ok' | 'task' | 'dim' | 'plain' {
    const text = line.message;
    if (line.status === 'FAILED' || /✖|ERROR|FAILED|falló|fatal/i.test(text)) return 'err';
    if (/^Advertencia|advertencia/.test(text)) return 'warn';
    if (line.status === 'SUCCEEDED' || /Creation complete|Apply complete|CREATE_COMPLETE|verificad|completad/i.test(text)) return 'ok';
    if (/^Ansible · (play|tarea)|^Terraform ·|^Pulumi ·|^CloudFormation ·/.test(text)) return 'task';
    if (text.startsWith('  ↳') || text.startsWith('  ')) return 'dim';
    return 'plain';
  }

  ngAfterViewChecked(): void {
    const element = this.scroller()?.nativeElement;
    if (element && this.follow() && this.lastCount !== this.shown().length) { element.scrollTop = element.scrollHeight; }
    this.lastCount = this.shown().length;
  }

  time(value: string): string { return new Date(value).toLocaleTimeString('es-BO', { hour12: false }); }
  value(event: Event): Filter { return (event.target as HTMLSelectElement).value as Filter; }
  checked(event: Event): boolean { return (event.target as HTMLInputElement).checked; }

  /** Descarga el registro completo (sin filtros) como texto plano. */
  download(): void {
    const text = this.lines().map(line => `${new Date(line.occurred_at).toISOString()} [${line.stage ?? line.status}] ${line.message}`).join('\n') + '\n';
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${this.name()}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.log`;
    link.click();
    URL.revokeObjectURL(url);
  }
}
