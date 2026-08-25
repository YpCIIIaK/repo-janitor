# -*- coding: utf-8 -*-
"""Блок open redirect. Безопасно: маркер-домен в redirect-параметр, смотрим,
уходит ли он в Location на ВНЕШНИЙ хост без проверки.

Не эксплуатация — редирект не проходим, только читаем заголовок Location.
Ядро redirect_verdict — чистое, юнит-тест. FP-защита: Location на СВОЙ хост
(относительный путь) — не open redirect.

    python webredirect.py https://in-scope.example/go --allow in-scope.example --param next
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

# маркер-хост: заведомо внешний, синтаксически валиден, не payload
MARKER_HOST = "redirect-probe.auditscout.invalid"
MARKER_URL = "https://" + MARKER_HOST + "/"


def redirect_verdict(location: str | None, self_host: str) -> dict:
    """location — значение заголовка Location; self_host — хост мишени."""
    if not location:
        return {"ok": False, "detail": "нет Location — редиректа нет"}
    # абсолютный внешний хост == наш маркер → уходит куда угодно
    p = urllib.parse.urlparse(location)
    host = (p.hostname or "").lower()
    if host == MARKER_HOST:
        return {"ok": True, "severity": "medium",
                "detail": f"Location уводит на внешний {location} — open redirect"}
    # protocol-relative //marker
    if location.startswith("//") and MARKER_HOST in location.lower():
        return {"ok": True, "severity": "medium",
                "detail": f"protocol-relative редирект на {location}"}
    if host and host != self_host.lower():
        return {"ok": False, "detail": f"Location на иной хост ({host}), но не наш маркер — проверить вручную"}
    return {"ok": False, "detail": f"Location остаётся на своём хосте ({location}) — не open redirect"}


def audit_redirect(url: str, param: str = "next") -> dict:
    u = urllib.parse.urlparse(url)
    q = dict(urllib.parse.parse_qsl(u.query, keep_blank_values=True))
    q[param] = MARKER_URL
    full = urllib.parse.urlunparse(u._replace(query=urllib.parse.urlencode(q)))
    req = urllib.request.Request(full, method="GET",
                                 headers={"User-Agent": webaudit.UA})
    ctx = ssl.create_default_context()

    class _NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None  # НЕ проходим редирект — только читаем Location
    opener = urllib.request.build_opener(_NoRedirect, urllib.request.HTTPSHandler(context=ctx))
    try:
        r = opener.open(req, timeout=15)
        status, loc = r.status, r.headers.get("Location")
    except urllib.error.HTTPError as e:
        status, loc = e.code, e.headers.get("Location")
    except Exception as e:
        return {"error": str(e)[:140]}
    v = redirect_verdict(loc, u.hostname or "")
    return {"status": status, "param": param, "location": loc, **v}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("url", metavar="URL")
    ap.add_argument("--allow", action="append", default=[])
    ap.add_argument("--param", default="next")
    args = ap.parse_args()
    if not args.allow:
        raise SystemExit("нужен --allow hostname")
    webaudit.host_ok(args.url, args.allow)
    if webaudit.PAYLOAD_RE.search(args.url):
        raise SystemExit("URL похож на payload")
    print(json.dumps(audit_redirect(args.url, args.param), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
