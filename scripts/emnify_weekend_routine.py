#!/usr/bin/env python3
"""
Rutina de fin de semana para Teltonika + Emnify.

Uso:
  python3 scripts/emnify_weekend_routine.py --action off
  python3 scripts/emnify_weekend_routine.py --action on

Sugerencia de cron:
  50 23 * * 5  cd /ruta/navixy-webapp && /usr/bin/python3 scripts/emnify_weekend_routine.py --action off
  0 5 * * 1   cd /ruta/navixy-webapp && /usr/bin/python3 scripts/emnify_weekend_routine.py --action on
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib import error, parse, request


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ENV_FILES = [PROJECT_ROOT / ".env.production", PROJECT_ROOT / ".env.local"]
DEFAULT_LOG_DIR = PROJECT_ROOT / "logs" / "emnify-routines"

TARGET_IMEIS = [
    "865413054332696",
    "863719065300825",
    "865413054291579",
    "865413052149696",
    "860896051475861",
    "860896050875145",
    "865413054332829",
]


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def choose_env_file(explicit: str | None) -> Path | None:
    if explicit:
        path = Path(explicit).expanduser().resolve()
        if not path.exists():
            raise FileNotFoundError(f"No existe el archivo de entorno: {path}")
        return path
    for candidate in DEFAULT_ENV_FILES:
        if candidate.exists():
            return candidate
    return None


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


def nested(data: Any, *keys: str) -> Any:
    current = data
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


class EmnifyClient:
    def __init__(self, app_token: str, base_url: str, source_address: str) -> None:
        self.app_token = app_token
        self.base_url = base_url.rstrip("/")
        self.source_address = source_address
        self.auth_token: str | None = None

    def authenticate(self) -> str:
        if self.auth_token:
            return self.auth_token
        payload = {"application_token": self.app_token}
        response = self._request("POST", "/authenticate", payload=payload, auth=False)
        auth_token = response.get("auth_token")
        if not auth_token:
            raise RuntimeError("Emnify no devolvio auth_token")
        self.auth_token = auth_token
        return auth_token

    def _request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
        auth: bool = True,
    ) -> Any:
        headers = {"Content-Type": "application/json"}
        if auth:
            headers["Authorization"] = f"Bearer {self.authenticate()}"
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        req = request.Request(
            f"{self.base_url}{path}",
            data=body,
            headers=headers,
            method=method,
        )
        try:
            with request.urlopen(req, timeout=60) as resp:
                raw = resp.read().decode("utf-8")
        except error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Emnify {method} {path} fallo con {exc.code}: {detail}") from exc
        except error.URLError as exc:
            raise RuntimeError(f"No se pudo conectar con Emnify: {exc.reason}") from exc
        if not raw:
            return None
        return json.loads(raw)

    def find_endpoint(self, imei: str) -> dict[str, Any] | None:
        queries = [f"name:{imei}", f"imei:{imei}", imei]
        for query in queries:
            encoded = parse.quote(query, safe=":")
            result = self._request("GET", f"/endpoint?q={encoded}")
            if isinstance(result, list) and result:
                return result[0]
        return None

    def get_connectivity(self, endpoint_id: int) -> dict[str, Any]:
        return self._request("GET", f"/endpoint/{endpoint_id}/connectivity")

    def reset_connectivity(self, endpoint_id: int) -> None:
        self._request(
            "PATCH",
            f"/endpoint/{endpoint_id}/connectivity",
            payload={"location": None, "pdp_context": None},
        )

    def send_sms(self, endpoint_id: int, message: str) -> None:
        self._request(
            "POST",
            f"/endpoint/{endpoint_id}/sms",
            payload={"payload": message, "source_address": self.source_address},
        )

    def list_sms(self, endpoint_id: int) -> list[dict[str, Any]]:
        result = self._request("GET", f"/endpoint/{endpoint_id}/sms")
        return result if isinstance(result, list) else []


def connectivity_snapshot(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": nested(raw, "status", "description"),
        "rat": nested(raw, "pdp_context", "rat_type", "description"),
        "operator": nested(raw, "location", "operator", "name"),
        "country": nested(raw, "location", "country", "name"),
        "last_updated": nested(raw, "location", "last_updated"),
    }


def is_sms_path_ready(snapshot: dict[str, Any]) -> bool:
    status = str(snapshot.get("status") or "").upper()
    rat = str(snapshot.get("rat") or "").upper()
    return status == "ONLINE" and ("4G" in rat or "LTE" in rat)


def wait_for_network_ready(
    client: EmnifyClient,
    endpoint_id: int,
    timeout_seconds: int,
    poll_interval: int,
    stable_polls: int,
) -> tuple[bool, dict[str, Any]]:
    deadline = time.monotonic() + timeout_seconds
    consecutive_ready = 0
    last_snapshot: dict[str, Any] = {}
    while time.monotonic() < deadline:
        last_snapshot = connectivity_snapshot(client.get_connectivity(endpoint_id))
        ready = is_sms_path_ready(last_snapshot)
        consecutive_ready = consecutive_ready + 1 if ready else 0
        logging.info(
            "Estado de red: status=%s rat=%s operador=%s updated=%s ready=%s (%s/%s)",
            last_snapshot.get("status"),
            last_snapshot.get("rat"),
            last_snapshot.get("operator"),
            last_snapshot.get("last_updated"),
            ready,
            consecutive_ready,
            stable_polls,
        )
        if consecutive_ready >= stable_polls:
            return True, last_snapshot
        time.sleep(poll_interval)
    return False, last_snapshot


def inbound_replies_since(
    messages: list[dict[str, Any]],
    baseline_ids: set[int],
) -> list[dict[str, Any]]:
    replies: list[dict[str, Any]] = []
    for message in messages:
        message_id = message.get("id")
        direction = str(message.get("direction") or "").lower()
        if isinstance(message_id, int) and message_id not in baseline_ids and direction == "mo":
            replies.append(message)
    return replies


def send_command_and_wait_reply(
    client: EmnifyClient,
    endpoint_id: int,
    command: str,
    reply_timeout_seconds: int,
    poll_interval: int,
) -> dict[str, Any]:
    baseline_ids = {
        msg["id"]
        for msg in client.list_sms(endpoint_id)
        if isinstance(msg, dict) and isinstance(msg.get("id"), int)
    }
    payload = f"  {command.strip()}"
    logging.info('Enviando SMS "%s"', payload)
    client.send_sms(endpoint_id, payload)

    deadline = time.monotonic() + reply_timeout_seconds
    while time.monotonic() < deadline:
        messages = client.list_sms(endpoint_id)
        replies = inbound_replies_since(messages, baseline_ids)
        if replies:
            reply = replies[0]
            logging.info('Respuesta recibida: "%s"', reply.get("payload"))
            return {"ok": True, "reply": reply, "payload": payload}
        time.sleep(poll_interval)

    logging.warning("No se recibio respuesta al comando %s dentro del tiempo esperado", command)
    return {"ok": False, "reply": None, "payload": payload}


def run_for_imei(
    client: EmnifyClient,
    imei: str,
    action: str,
    command: str,
    *,
    do_reset_first: bool,
    use_probe: bool,
    initial_wait_seconds: int,
    network_timeout_seconds: int,
    reply_timeout_seconds: int,
    poll_interval: int,
    stable_polls: int,
) -> dict[str, Any]:
    started_at = now_iso()
    result: dict[str, Any] = {
        "imei": imei,
        "action": action,
        "command": command,
        "started_at": started_at,
    }

    endpoint = client.find_endpoint(imei)
    if not endpoint:
        result["ok"] = False
        result["reason"] = "endpoint-no-encontrado"
        logging.error("No se encontro endpoint para IMEI %s", imei)
        return result

    endpoint_id = endpoint.get("id")
    result["endpoint_id"] = endpoint_id
    logging.info("IMEI %s corresponde a endpoint %s", imei, endpoint_id)

    if do_reset_first:
        logging.info("Reset de conectividad para %s", imei)
        client.reset_connectivity(int(endpoint_id))
        logging.info("Esperando %s segundos despues del reset", initial_wait_seconds)
        time.sleep(initial_wait_seconds)

    ready, snapshot = wait_for_network_ready(
        client,
        int(endpoint_id),
        timeout_seconds=network_timeout_seconds,
        poll_interval=poll_interval,
        stable_polls=stable_polls,
    )
    result["connectivity"] = snapshot
    if not ready:
        result["ok"] = False
        result["reason"] = "red-no-estable"
        logging.error("La red no quedo estable para %s, no se enviara SMS", imei)
        return result

    if use_probe:
        logging.info("Validando ruta SMS con probe getgps para %s", imei)
        probe = send_command_and_wait_reply(
            client,
            int(endpoint_id),
            command="getgps",
            reply_timeout_seconds=reply_timeout_seconds,
            poll_interval=poll_interval,
        )
        result["probe"] = probe
        if not probe["ok"]:
            result["ok"] = False
            result["reason"] = "probe-sin-respuesta"
            logging.error("La validacion getgps no respondio para %s, se cancela el comando final", imei)
            return result

    final_send = send_command_and_wait_reply(
        client,
        int(endpoint_id),
        command=command,
        reply_timeout_seconds=reply_timeout_seconds,
        poll_interval=poll_interval,
    )
    result["final_send"] = final_send
    result["ok"] = final_send["ok"]
    result["finished_at"] = now_iso()
    return result


def setup_logging(log_dir: Path, action: str) -> tuple[Path, Path]:
    log_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    log_path = log_dir / f"{stamp}-{action}.log"
    summary_path = log_dir / f"{stamp}-{action}.json"

    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.handlers.clear()

    formatter = logging.Formatter("%(asctime)s | %(levelname)s | %(message)s")
    file_handler = logging.FileHandler(log_path, encoding="utf-8")
    file_handler.setFormatter(formatter)
    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.setFormatter(formatter)
    root.addHandler(file_handler)
    root.addHandler(stream_handler)

    return log_path, summary_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Rutina Emnify + Teltonika para fin de semana")
    parser.add_argument("--action", choices=["off", "on"], required=True, help="off=apagar motor, on=encender")
    parser.add_argument("--env-file", help="Ruta explicita al archivo .env")
    parser.add_argument("--imei", action="append", dest="imeis", help="Permite correr solo ciertos IMEIs")
    parser.add_argument("--log-dir", default=str(DEFAULT_LOG_DIR), help="Directorio de logs")
    parser.add_argument("--poll-interval", type=int, default=30, help="Segundos entre consultas")
    parser.add_argument("--initial-wait", type=int, default=180, help="Espera despues del reset")
    parser.add_argument("--network-timeout", type=int, default=600, help="Maximo para esperar red estable")
    parser.add_argument("--reply-timeout", type=int, default=240, help="Maximo para esperar respuesta SMS")
    parser.add_argument("--stable-polls", type=int, default=2, help="Cantidad de lecturas ONLINE/4G consecutivas")
    parser.add_argument("--skip-probe", action="store_true", help="No mandar getgps antes del comando final")
    parser.add_argument("--dry-run", action="store_true", help="Solo valida endpoints y red; no manda comandos")
    parser.add_argument(
        "--off-command",
        default=os.getenv("TELTONIKA_OFF_COMMAND", "setdigout ?1?"),
        help="Comando SMS para paro de motor",
    )
    parser.add_argument(
        "--on-command",
        default=os.getenv("TELTONIKA_ON_COMMAND", "setdigout ?0?"),
        help="Comando SMS para reactivar",
    )
    parser.add_argument(
        "--source-address",
        default=os.getenv("EMNIFY_SMS_SOURCE_ADDRESS", "NAVEGO"),
        help="Remitente del SMS MT en Emnify",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    env_path = choose_env_file(args.env_file)
    if env_path:
        load_env_file(env_path)

    app_token = os.getenv("EMNIFY_APP_TOKEN")
    base_url = os.getenv("EMNIFY_BASE_URL", "https://cdn.emnify.net/api/v1")
    if not app_token:
        raise RuntimeError("Falta EMNIFY_APP_TOKEN en el archivo de entorno")

    action = args.action
    log_path, summary_path = setup_logging(Path(args.log_dir), action)
    logging.info("Rutina iniciada: action=%s env=%s log=%s", action, env_path, log_path)

    imeis = args.imeis or TARGET_IMEIS
    command = args.off_command if action == "off" else args.on_command
    do_reset_first = action == "on"

    client = EmnifyClient(
        app_token=app_token,
        base_url=base_url,
        source_address=args.source_address,
    )
    results: list[dict[str, Any]] = []

    for imei in imeis:
        logging.info("Procesando IMEI %s", imei)
        if args.dry_run:
            endpoint = client.find_endpoint(imei)
            results.append(
                {
                    "imei": imei,
                    "action": action,
                    "dry_run": True,
                    "endpoint_id": endpoint.get("id") if endpoint else None,
                    "ok": bool(endpoint),
                    "reason": None if endpoint else "endpoint-no-encontrado",
                }
            )
            continue

        try:
            result = run_for_imei(
                client,
                imei,
                action,
                command,
                do_reset_first=do_reset_first,
                use_probe=not args.skip_probe,
                initial_wait_seconds=args.initial_wait,
                network_timeout_seconds=args.network_timeout,
                reply_timeout_seconds=args.reply_timeout,
                poll_interval=args.poll_interval,
                stable_polls=args.stable_polls,
            )
        except Exception as exc:  # noqa: BLE001
            logging.exception("Fallo procesando IMEI %s", imei)
            result = {
                "imei": imei,
                "action": action,
                "ok": False,
                "reason": str(exc),
                "finished_at": now_iso(),
            }
        results.append(result)

    summary = {
        "action": action,
        "command": command,
        "finished_at": now_iso(),
        "results": results,
        "ok_count": sum(1 for item in results if item.get("ok")),
        "fail_count": sum(1 for item in results if not item.get("ok")),
    }
    summary_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    with (Path(args.log_dir) / "history.jsonl").open("a", encoding="utf-8") as history:
        history.write(json.dumps(summary, ensure_ascii=False) + "\n")

    logging.info("Rutina terminada. ok=%s fail=%s summary=%s", summary["ok_count"], summary["fail_count"], summary_path)
    return 0 if summary["fail_count"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
