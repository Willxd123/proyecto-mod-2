"""Registro en vivo del aprovisionamiento (RF-11).

Convierte la salida de Ansible, Terraform/OpenTofu y Pulumi, y los eventos de la pila de CloudFormation, en líneas cortas y
legibles que el panel muestra paso a paso. Nunca reenvía la salida cruda: descarta secuencias de color, limita el largo de
cada línea y omite cualquier línea que mencione contraseñas, claves, tokens o credenciales.
"""
import json
import re
import subprocess
import threading
import time

ANSI = re.compile(r'\x1b\[[0-9;?]*[A-Za-z]')
CONTROL = re.compile(r'[\x00-\x1f\x7f]+')
SENSITIVE = re.compile(
    r'pass(word|wd)?\b|passw|secret|token|vault|authorization|credential|contrase|clave|private[_ -]?key|jwt|api[_-]?key|BEGIN [A-Z ]*KEY|certbot_email', re.I)
OMITTED = '[línea omitida: puede contener datos sensibles]'
LIMIT = 200
MAX_EVENTS = 500


def clean(text):
    """Una sola línea sin colores ni caracteres de control, de largo acotado; vacía si no queda nada."""
    return CONTROL.sub(' ', ANSI.sub('', text or '')).strip()[:LIMIT]


def safe(text):
    """Como clean, pero reemplaza la línea completa si podría contener datos sensibles."""
    value = clean(text)
    return OMITTED if value and SENSITIVE.search(value) else value


class _Progress:
    """Base: limita el volumen total de eventos, salvo los errores y los resúmenes (force)."""
    def __init__(self, sink, limit=MAX_EVENTS):
        self.sink, self.limit, self.count = sink, limit, 0

    def _emit(self, message, force=False):
        if not message:
            return
        if self.count >= self.limit and not force:
            return
        self.count += 1
        self.sink(message)


class AnsibleProgress(_Progress):
    """Ansible: cada play y tarea, dónde cambió algo, los errores y el resumen final por servidor."""
    def __init__(self, sink, limit=MAX_EVENTS):
        super().__init__(sink, limit)
        self.recap = False

    def feed(self, raw):
        line = clean(raw)
        if not line:
            return
        play = re.match(r'PLAY \[(.+?)\]', line)
        task = re.match(r'TASK \[(.+?)\]', line)
        result = re.match(r'(changed|fatal|failed): \[([\w.-]+)\](.*)', line)
        if play:
            self.recap = False
            self._emit('Ansible · ' + safe(play.group(1)))
        elif task:
            self._emit('Ansible · tarea: ' + safe(task.group(1)))
        elif result and result.group(1) == 'changed':
            self._emit(f'  ↳ cambió en {result.group(2)}')
        elif result:
            detalle = re.sub(r'^:?\s*(FAILED!|failed!)?\s*=>\s*', '', result.group(3))
            self._emit(f'  ✖ ERROR en {result.group(2)}: ' + (safe(detalle) or 'la tarea falló'), force=True)
        elif line.startswith('PLAY RECAP'):
            self.recap = True
            self._emit('Ansible · resumen por servidor', force=True)
        elif self.recap and re.match(r'[\w.-]+\s+: ok=\d+', line):
            self._emit('  ' + re.sub(r'\s+', ' ', line), force=True)


class TerraformProgress(_Progress):
    """Terraform y OpenTofu: cada recurso que se crea, modifica o destruye y el resultado del apply."""
    RESOURCE = re.compile(r'^([\w.\[\]"/-]+): (Creating\.\.\.|Creation complete.*|Destroying\.\.\.|Destruction complete.*|Modifying\.\.\.|Modifications complete.*)$')

    def feed(self, raw):
        line = clean(raw)
        if not line:
            return
        resource = self.RESOURCE.match(line)
        if resource:
            self._emit(f'Terraform · {resource.group(1)}: {resource.group(2).rstrip(".")}')
        elif re.match(r'(Apply|Destroy) complete!', line) or re.match(r'Plan: ', line):
            self._emit('Terraform · ' + line, force=True)
        elif line.startswith('Error:'):
            self._emit('  ✖ ' + safe(line), force=True)


class PulumiProgress(_Progress):
    """Pulumi: cada recurso que crea o elimina, el resumen y los errores."""
    ACTION = re.compile(r'\b(creating|created|deleting|deleted|updating|updated)\b')

    def feed(self, raw):
        line = clean(raw)
        if not line:
            return
        if line.startswith(('+', '-', '~')) and self.ACTION.search(line):
            self._emit('Pulumi · ' + re.sub(r'\s+', ' ', line))
        elif re.match(r'Resources:', line) or re.match(r'\s*(\+|-|~)\s+\d+ (created|deleted|updated)', line):
            self._emit('Pulumi · ' + re.sub(r'\s+', ' ', line), force=True)
        elif line.lower().startswith('error:') or 'error:' in line.lower():
            self._emit('  ✖ ' + safe(line), force=True)


def stream(command, progress, cwd=None, env=None, timeout=3600):
    """Ejecuta el comando y entrega su salida línea por línea a progress.feed; devuelve el código de salida."""
    process = subprocess.Popen(command, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                               encoding='utf-8', errors='replace', bufsize=1)
    deadline = time.monotonic() + timeout
    timer = threading.Timer(timeout, process.kill)
    timer.start()
    try:
        for line in process.stdout:
            progress.feed(line)
            if time.monotonic() > deadline:
                process.kill()
                break
        return process.wait()
    finally:
        timer.cancel()
        if process.poll() is None:
            process.kill()


class StackEvents(threading.Thread):
    """CloudFormation no imprime progreso: consulta los eventos de la pila mientras se crea y los entrega uno a uno."""
    def __init__(self, sink, region, stack_name, interval=6):
        super().__init__(daemon=True)
        self.sink, self.region, self.stack_name, self.interval = sink, region, stack_name, interval
        self.seen, self.halt = set(), threading.Event()

    def poll(self):
        try:
            done = subprocess.run(['aws', 'cloudformation', 'describe-stack-events', '--stack-name', self.stack_name, '--max-items', '100',
                                   '--region', self.region, '--output', 'json', '--no-cli-pager'], capture_output=True, text=True, timeout=60, check=False)
            events = json.loads(done.stdout).get('StackEvents', []) if done.returncode == 0 else []
        except (OSError, subprocess.TimeoutExpired, ValueError):
            return
        for event in reversed(events):
            identifier = event.get('EventId')
            if not identifier or identifier in self.seen:
                continue
            self.seen.add(identifier)
            kind = str(event.get('ResourceType', '')).split('::')[-1]
            status = str(event.get('ResourceStatus', ''))
            message = f"CloudFormation · {clean(event.get('LogicalResourceId'))} ({clean(kind)}): {clean(status)}"
            if status.endswith('FAILED') and event.get('ResourceStatusReason'):
                message += ' — ' + safe(event['ResourceStatusReason'])
            self.sink(message[:230])

    def run(self):
        while not self.halt.is_set():
            self.poll()
            self.halt.wait(self.interval)

    def stop(self):
        self.halt.set()
        self.join(timeout=70)
        self.poll()
