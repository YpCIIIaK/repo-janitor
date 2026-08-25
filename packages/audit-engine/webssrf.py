# -*- coding: utf-8 -*-
"""Блок SSRF. Подтверждение — маркер-контроль: даём URL-параметру ссылку на
контролируемый нами маркер-ресурс и смотрим, ДОТЯНУЛ ли его сервер (маркер-
токен вернулся в ответе). Это и есть доказательство SSRF без слепых догадок.

Честно: для РЕАЛЬНОЙ мишени нужен OOB/collaborator-хост под нашим контролем
(его адрес передаётся --marker). Без подтверждения — не находка. Ядро
ssrf_verdict — чистое, юнит-тест.

    python webssrf.py https://in-scope.example/fetch --allow in-scope.example \
        --param url --marker https://our-collab.example/tok --token TOK123
"""
from __future__ import annotations

import argparse
import json
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request

import webaudit

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def ssrf_verdict(body: str, token: str) -> dict:
    """Сервер вернул содержимое маркер-ресурса (токен) → он его дотянул."""
    if token and token in (body or ""):
        return {"ok": True, "severity": "high",
                "detail": f"сервер дотянул маркер-ресурс — токен {token[:12]} в ответе (SSRF)"}
    return {"ok": False, "detail": "маркер-токен не вернулся — SSRF не подтверждён"}


def audit_ssrf(url: str, marker_url: str, token: str, param: str = "url") -> dict:
    u = urllib.parse.urlparse(url)
    q = dict(urllib.parse.parse_qsl(u.query, keep_blank_values=True))
    q[param] = marker_url
    full = urllib.parse.urlunparse(u._replace(query=urllib.parse.urlencode(q)))
    req = urllib.request.Request(full, method="GET", headers={"User-Agent": webaudit.UA})
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=15, context=ctx) as r:
            body = r.read(50_000).decode("utf-8", "replace")
            status = r.status
    except urllib.error.HTTPError as e:
        body = e.read(50_000).decode("utf-8", "replace")
        status = e.code
    except Exception as e:
        return {"error": str(e)[:140]}
    v = ssrf_verdict(body, token)
    return {"status": status, "param": param, "marker": marker_url, **v}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("url", metavar="URL")
    ap.add_argument("--allow", action="append", default=[])
    ap.add_argument("--param", default="url")
    ap.add_argument("--marker", required=True, help="URL контролируемого маркер-ресурса")
    ap.add_argument("--token", required=True, help="токен, который маркер-ресурс возвращает")
    args = ap.parse_args()
    if not args.allow:
        raise SystemExit("нужен --allow hostname")
    webaudit.host_ok(args.url, args.allow)
    if webaudit.PAYLOAD_RE.search(args.url):
        raise SystemExit("URL похож на payload")
    print(json.dumps(audit_ssrf(args.url, args.marker, args.token, args.param),
                     ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
