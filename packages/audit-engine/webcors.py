# -*- coding: utf-8 -*-
"""Блок CORS misconfiguration (раздел 9). Безопасно: +1 заголовок Origin.

Опасный паттерн — сервер ОТРАЖАЕТ произвольный Origin в
Access-Control-Allow-Origin И отдаёт Access-Control-Allow-Credentials: true.
Тогда чужой сайт читает приватные ответы жертвы. Проверяем именно это.

Ядро cors_verdict — чистое, юнит-тест. Не эксплуатация: шлём МАРКЕР-Origin
(невалидный домен-зонд), payload'ов нет. Гейт петли — живая перепроверка.

    python webcors.py https://in-scope.example/api/me --allow in-scope.example
"""
from __future__ import annotations

import argparse
import json
import ssl
import sys
import urllib.error
import urllib.request

import webaudit

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# домен-зонд: заведомо не наш, синтаксически валиден, не payload
PROBE_ORIGIN = "https://cors-probe.auditscout.invalid"


def cors_verdict(origin_sent: str, acao: str | None, acac: str | None) -> dict:
    """Чистое ядро. acao/acac — значения ответных заголовков (или None).
    ok=True только для реально опасной комбинации."""
    if not acao:
        return {"ok": False, "severity": None,
                "detail": "нет Access-Control-Allow-Origin — CORS не открыт"}
    acao = acao.strip()
    creds = (acac or "").strip().lower() == "true"
    reflected = acao == origin_sent
    is_null = acao.lower() == "null"

    # * с credentials браузер запрещает — не эксплуатируется как кража
    if acao == "*":
        return {"ok": False, "severity": "info",
                "detail": "ACAO: * — публично; с credentials браузер не отдаст"}
    # отражение произвольного Origin + credentials = кража приватных ответов
    if (reflected or is_null) and creds:
        return {"ok": True, "severity": "high",
                "detail": f"ACAO отражает {acao} и ACAC=true — кросс-доменное чтение с cookie"}
    # отражение произвольного Origin без credentials — слабее (нет cookie)
    if reflected:
        return {"ok": True, "severity": "medium",
                "detail": f"ACAO отражает произвольный Origin ({acao}) без credentials"}
    if is_null:
        return {"ok": False, "severity": "info",
                "detail": "ACAO: null без credentials — низкий риск"}
    # ACAO зафиксирован на доверенном домене, не на нашем зонде — корректно
    return {"ok": False, "severity": None,
            "detail": f"ACAO зафиксирован ({acao}), наш Origin не отражён — корректно"}


def audit_cors(url: str, origin: str = PROBE_ORIGIN) -> dict:
    req = urllib.request.Request(url, method="GET", headers={
        "User-Agent": webaudit.UA, "Origin": origin, "Accept": "*/*"})
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=15, context=ctx) as r:
            hdr = {k.lower(): v for k, v in r.headers.items()}
            status = r.status
    except urllib.error.HTTPError as e:
        hdr = {k.lower(): v for k, v in e.headers.items()}
        status = e.code
    except Exception as e:
        return {"error": str(e)[:140]}
    acao = hdr.get("access-control-allow-origin")
    acac = hdr.get("access-control-allow-credentials")
    v = cors_verdict(origin, acao, acac)
    return {"status": status, "origin_sent": origin,
            "acao": acao, "acac": acac, **v}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("url", metavar="URL")
    ap.add_argument("--allow", action="append", default=[])
    args = ap.parse_args()
    if not args.allow:
        raise SystemExit("нужен --allow hostname")
    webaudit.host_ok(args.url, args.allow)
    if webaudit.PAYLOAD_RE.search(args.url):
        raise SystemExit("URL похож на payload")
    print(json.dumps(audit_cors(args.url), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
