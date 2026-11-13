#!/usr/bin/env python3
"""Prepare versioned assistance archives on a Linux/WSL controller."""

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "infrastructure" / "ansible" / "vars" / "private" / "artifact-sources.json"
OUTPUT = ROOT / "output" / "ansible-artifacts" / "releases"
REPO_URL = re.compile(r"https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:\.git)?\Z")
REVISION = re.compile(r"[0-9a-f]{40}\Z")
FILES = ("source.tar.gz", "wheels.tar.gz", "build.tar.gz")
WINDOWS_CMD = Path("/mnt/c/Windows/System32/cmd.exe")


class PreparationError(Exception):
    pass


def command(args, cwd=None, timeout=600, capture=True):
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0")
    try:
        result = subprocess.run(
            args, cwd=cwd, env=env, text=True, capture_output=capture,
            timeout=timeout, check=True,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise PreparationError(f"Falló {args[0]}; compruebe herramientas, red y dependencias.") from error
    return result.stdout.strip() if capture else ""


def load_config():
    try:
        data = json.loads(CONFIG.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise PreparationError("Falta o no es válido artifact-sources.json; consulte la documentación.") from error
    if not isinstance(data, dict) or set(data) != {"backend", "frontend"}:
        raise PreparationError("La configuración requiere solamente backend y frontend.")
    for role in ("backend", "frontend"):
        if not isinstance(data[role], str) or not REPO_URL.fullmatch(data[role]):
            raise PreparationError("Los repositorios deben ser URL HTTPS de GitHub sin credenciales.")
    return data


def main_revision(url):
    output = command(["git", "ls-remote", "--exit-code", "--heads", url, "refs/heads/main"], timeout=60)
    lines = output.splitlines()
    if len(lines) != 1:
        raise PreparationError("No se pudo determinar una única revisión de main.")
    fields = lines[0].split()
    if len(fields) != 2 or not REVISION.fullmatch(fields[0]) or fields[1] != "refs/heads/main":
        raise PreparationError("La revisión de main no es válida.")
    return fields[0]


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def release_id(config, revisions):
    values = {"sources": config, "revisions": revisions, "python": platform.python_version(),
              "system": platform.system(), "machine": platform.machine(), "libc": platform.libc_ver()}
    return hashlib.sha256(json.dumps(values, sort_keys=True).encode()).hexdigest()[:32]


def verify_release(directory, config, revisions):
    manifest_path = directory / "manifest.json"
    if not directory.exists():
        return False
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest["sources"] != config or manifest["revisions"] != revisions:
            raise PreparationError("El manifiesto no coincide con los repositorios o revisiones.")
        for name in FILES:
            file = directory / name
            if file.is_symlink() or not file.is_file() or digest(file) != manifest["sha256"][name]:
                raise PreparationError(f"El paquete {name} está ausente o dañado; no se reutilizará.")
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise PreparationError("El manifiesto de paquetes existente es inválido.") from error
    return True


def inspect():
    if platform.system() != "Linux":
        raise PreparationError("La preparación requiere Linux o WSL para generar paquetes compatibles con el servidor.")
    config = load_config()
    revisions = {name: main_revision(config[name]) for name in ("backend", "frontend")}
    directory = OUTPUT / release_id(config, revisions)
    return config, revisions, directory, verify_release(directory, config, revisions)


def clone(url, revision, target):
    command(["git", "clone", "--no-checkout", "--single-branch", "--branch", "main", "--", url, str(target)])
    command(["git", "-C", str(target), "checkout", "--detach", revision])
    if command(["git", "-C", str(target), "rev-parse", "HEAD"]) != revision:
        raise PreparationError("La revisión descargada no coincide con la aprobada.")


def node_tools():
    if shutil.which("node") and shutil.which("npm"):
        return ["node"], ["npm"]
    if WINDOWS_CMD.is_file() and re.match(r"^/mnt/[a-z]/", str(ROOT)):
        return [str(WINDOWS_CMD), "/d", "/c", "node"], [str(WINDOWS_CMD), "/d", "/c", "npm"]
    raise PreparationError("Faltan Node.js y npm en Linux/WSL; instálelos antes de preparar paquetes.")


def make_archives(work, staging, config, revisions):
    node, npm = node_tools()
    backend, frontend = work / "backend", work / "frontend"
    clone(config["backend"], revisions["backend"], backend)
    clone(config["frontend"], revisions["frontend"], frontend)
    if not (backend / "requirements.txt").is_file() or not (frontend / "package-lock.json").is_file():
        raise PreparationError("Los repositorios no contienen requirements.txt y package-lock.json requeridos.")
    command(["git", "-C", str(backend), "archive", "--format=tar.gz", "-o",
             str(staging / "source.tar.gz"), revisions["backend"]])
    env = work / "venv"
    command([sys.executable, "-m", "venv", str(env)])
    pip = str(env / "bin" / "pip")
    command([pip, "install", "--only-binary=:all:", "-r", str(backend / "requirements.txt"), "gunicorn==23.0.0"])
    wheels = work / "wheels"
    wheels.mkdir()
    (wheels / "requirements.lock").write_text(command([pip, "freeze"]) + "\n", encoding="utf-8")
    command([pip, "download", "--only-binary=:all:", "-r", str(wheels / "requirements.lock"), "-d", str(wheels)])
    with tarfile.open(staging / "wheels.tar.gz", "w:gz") as archive:
        for item in sorted(wheels.iterdir()):
            archive.add(item, arcname=item.name, recursive=False)
    command(npm + ["ci", "--ignore-scripts"], cwd=frontend, timeout=1200)
    command(npm + ["run", "build"], cwd=frontend, timeout=1200)
    build = frontend / "dist" / "control-asistencia-web" / "browser"
    if not (build / "index.html").is_file():
        raise PreparationError("La compilación del frontend no produjo index.html en la ruta esperada.")
    with tarfile.open(staging / "build.tar.gz", "w:gz") as archive:
        for item in sorted(build.rglob("*")):
            if item.is_symlink():
                raise PreparationError("El frontend compilado contiene enlaces simbólicos.")
            if item.is_file():
                archive.add(item, arcname=str(item.relative_to(build)), recursive=False)


def prepare(config, revisions, directory):
    OUTPUT.mkdir(parents=True, exist_ok=True)
    lock = OUTPUT / ".preparation.lock"
    try:
        lock.mkdir()
    except FileExistsError as error:
        raise PreparationError("Ya hay una preparación en curso o un bloqueo pendiente de revisión.") from error
    try:
        if verify_release(directory, config, revisions):
            return
        with tempfile.TemporaryDirectory(prefix=".prepare-", dir=OUTPUT) as temporary:
            work = Path(temporary)
            staging = work / "release"
            staging.mkdir()
            make_archives(work, staging, config, revisions)
            node, npm = node_tools()
            manifest = {
                "schema_version": 1, "sources": config, "revisions": revisions,
                "sha256": {name: digest(staging / name) for name in FILES},
                "python": platform.python_version(), "system": platform.system(),
                "machine": platform.machine(), "libc": platform.libc_ver(),
                "node": command(node + ["--version"]), "npm": command(npm + ["--version"]),
            }
            (staging / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
            staging.rename(directory)
    finally:
        lock.rmdir()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("inspect", "prepare"))
    parser.add_argument("--backend")
    parser.add_argument("--frontend")
    args = parser.parse_args()
    config, revisions, directory, ready = inspect()
    if args.action == "prepare":
        if args.backend != revisions["backend"] or args.frontend != revisions["frontend"]:
            raise PreparationError("main cambió desde la confirmación; revise nuevamente las revisiones.")
        prepare(config, revisions, directory)
        ready = verify_release(directory, config, revisions)
    print(json.dumps({"revisions": revisions, "ready": ready, "release": directory.name}))


if __name__ == "__main__":
    try:
        main()
    except PreparationError as error:
        print("ERROR: " + str(error), file=sys.stderr)
        sys.exit(1)
