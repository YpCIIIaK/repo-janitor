# -*- coding: utf-8 -*-
"""Блок Stored XSS: канарейка, сохранённая через один эндпоинт, всплывает на
ДРУГОМ (и у другого пользователя). Это то, что отличает stored от reflected —
и единственный XSS, который принимают строгие программы.

Marker-only: кладём безопасную строку-маркер (не payload), затем читаем view и
смотрим, вернулась ли она в HTML-контексте. Ядро stored_verdict — чистое.

    python webstored.py --store https://app/comment --field text \
        --view https://app/comments --allow app
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


def stored_verdict(canary: str, view_body: str, headers: dict, view_url: str) -> dict:
    """Переиспользуем контекстный анализ find_canary, но помечаем как stored."""
    hit = webaudit.find_canary(canary, view_body, headers, view_url)
    if hit["reflected"] and hit["where"] in ("text", "attribute", "script"):
        return {"ok": True, "severity": "high",
                "detail": f"маркер сохранён и всплыл на view в контексте {hit['where']}: {hit['snippet'][:100]}"}
    return {"ok": False, "detail": "маркер не всплыл на view — не stored"}


def _get(url: str) -> tuple[int, dict, str]:
    st, hdr, body, _ = webaudit.fetch(url)
    return st, hdr, body


def audit_stored(store_url: str, field: str, view_url: str) -> dict:
    canary = webaudit.canary()
    data = urllib.parse.urlencode({field: canary}).encode()
    req = urllib.request.Request(store_url, data=data, method="POST",
                                 headers={"User-Agent": webaudit.UA,
                                          "Content-Type": "application/x-www-form-urlencoded"})
    ctx = ssl.create_default_context()
    try:
        urllib.request.urlopen(req, timeout=15, context=ctx).read(1000)
    except urllib.error.HTTPError:
        pass
    except Exception as e:
        return {"error": "store: " + str(e)[:120]}
    st, hdr, body = _get(view_url)
    v = stored_verdict(canary, body, hdr, view_url)
    return {"canary": canary, "view_status": st, **v}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--store", required=True)
    ap.add_argument("--field", default="text")
    ap.add_argument("--view", required=True)
    ap.add_argument("--allow", action="append", default=[])
    args = ap.parse_args()
    if not args.allow:
        raise SystemExit("нужен --allow hostname")
    for u in (args.store, args.view):
        webaudit.host_ok(u, args.allow)
        if webaudit.PAYLOAD_RE.search(u):
            raise SystemExit("URL похож на payload")
    print(json.dumps(audit_stored(args.store, args.field, args.view),
                     ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
