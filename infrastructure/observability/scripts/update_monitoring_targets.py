#!/usr/bin/env python3
"""
update_monitoring_targets.py
Gestiona los archivos de file_sd_configs de Prometheus para node_exporter y postgres_exporter.

Uso:
  python update_monitoring_targets.py add    --tenant <slug> --env <env> --node-ip <ip> [--db-ip <ip>]
  python update_monitoring_targets.py remove --tenant <slug>

El directorio de targets se lee de OBS_TARGETS_DIR (default: /etc/prometheus/targets).
Ejecutar en el servidor de observabilidad con permisos de escritura en ese directorio,
o apuntar a un directorio local si se sincroniza vía SCP/rsync.

Este script lo llama el integrante 5 (orquestación) al crear o retirar tenants.
"""

import argparse
import json
import os
import sys
from pathlib import Path

TARGETS_DIR = Path(os.environ.get("OBS_TARGETS_DIR", "/etc/prometheus/targets"))
TENANTS_DIR  = TARGETS_DIR / "tenants"
POSTGRES_DIR = TARGETS_DIR / "postgres"

NODE_EXPORTER_PORT = 9100
POSTGRES_EXPORTER_PORT = 9187


def _ensure_dirs() -> None:
    TENANTS_DIR.mkdir(parents=True, exist_ok=True)
    POSTGRES_DIR.mkdir(parents=True, exist_ok=True)


def _node_target_path(tenant: str) -> Path:
    return TENANTS_DIR / f"{tenant}.yml"


def _pg_target_path(tenant: str) -> Path:
    return POSTGRES_DIR / f"{tenant}.yml"


def add(tenant: str, environment: str, node_ip: str, db_ip: str | None) -> None:
    _ensure_dirs()

    # --- node_exporter (frontend, backend, database) ---
    # Aquí se ponen las tres IPs; para simplificar se reciben como lista separada por coma.
    node_targets = []
    for idx, ip in enumerate(node_ip.split(",")):
        ip = ip.strip()
        roles = ["frontend", "backend", "database"]
        role  = roles[idx] if idx < len(roles) else f"server-{idx}"
        node_targets.append({
            "targets": [f"{ip}:{NODE_EXPORTER_PORT}"],
            "labels": {
                "tenant":      tenant,
                "environment": environment,
                "role":        role,
                "scope":       "tenant",
            },
        })

    _node_target_path(tenant).write_text(
        json.dumps(node_targets, indent=2, ensure_ascii=False) + "\n"
    )
    print(f"[OK] node_exporter targets escritos para tenant '{tenant}'")

    # --- postgres_exporter (solo si se proporciona la IP de la base) ---
    if db_ip:
        pg_targets = [
            {
                "targets": [f"{db_ip}:{POSTGRES_EXPORTER_PORT}"],
                "labels": {
                    "tenant":      tenant,
                    "environment": environment,
                    "role":        "database",
                    "scope":       "tenant",
                },
            }
        ]
        _pg_target_path(tenant).write_text(
            json.dumps(pg_targets, indent=2, ensure_ascii=False) + "\n"
        )
        print(f"[OK] postgres_exporter target escrito para tenant '{tenant}'")


def remove(tenant: str) -> None:
    removed = False
    for path in [_node_target_path(tenant), _pg_target_path(tenant)]:
        if path.exists():
            path.unlink()
            print(f"[OK] Eliminado {path}")
            removed = True
    if not removed:
        print(f"[WARN] No se encontraron targets para tenant '{tenant}'", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(description="Gestión de targets de Prometheus por tenant")
    sub = parser.add_subparsers(dest="command", required=True)

    p_add = sub.add_parser("add", help="Registrar o actualizar targets de un tenant")
    p_add.add_argument("--tenant",  required=True, help="Slug del tenant")
    p_add.add_argument("--env",     required=True, help="Entorno (produccion, staging, etc.)")
    p_add.add_argument("--node-ip", required=True, help="IPs de los servidores separadas por coma (frontend,backend,database)")
    p_add.add_argument("--db-ip",   default=None,  help="IP del servidor de base de datos para postgres_exporter")

    p_rm = sub.add_parser("remove", help="Retirar targets de un tenant")
    p_rm.add_argument("--tenant", required=True, help="Slug del tenant")

    args = parser.parse_args()

    if args.command == "add":
        add(args.tenant, args.env, args.node_ip, args.db_ip)
    elif args.command == "remove":
        remove(args.tenant)


if __name__ == "__main__":
    main()
