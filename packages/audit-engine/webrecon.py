# -*- coding: utf-8 -*-
"""Агрегатор discovery-слоёв для UI: один вызов = карта + стек + CVE-кандидаты.

Гоняет webmap → webfinger → webcve и печатает ОДИН JSON, чтобы воркбенчу
хватило одного subprocess. Пассивно, GET-only, --allow-гейт. Ничего нового не
делает — только собирает уже проверенные блоки вместе.

    python webrecon.py https://in-scope.example/ --allow in-scope.example
"""
from __future__ import annotations

import argparse
import json
import sys

import webaudit
import webcve
import webfinger
import webmap

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def recon(base: str, allow: list[str], max_js: int = 8) -> dict:
    out: dict = {"base": base, "allow": allow}
    # карта приложения
    try:
        m = webmap.crawl(base, allow, max_js=max_js)
        out["map"] = {"count": m["count"], "js_hits": m["js_hits"],
                      "assets": m["assets"]}
        jsrefs = [a["url"] for a in m["assets"]]
    except Exception as e:
        out["map"] = {"error": str(e)[:160], "assets": []}
        jsrefs = []
    # стек
    try:
        fp = webfinger.fingerprint(base, allow, jsrefs)
        out["tech"] = fp["tech"]
    except Exception as e:
        out["tech"] = []
        out["tech_error"] = str(e)[:160]
    # CVE-кандидаты по версиям (может быть пусто/unknown — это честно)
    try:
        out["cve"] = webcve.correlate(out.get("tech") or [])
    except Exception as e:
        out["cve"] = {"candidates": [], "skipped": [], "unknown": [],
                      "candidate_count": 0, "error": str(e)[:160]}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base", metavar="URL")
    ap.add_argument("--allow", action="append", default=[])
    ap.add_argument("--max-js", type=int, default=8)
    args = ap.parse_args()
    if not args.allow:
        raise SystemExit("нужен --allow hostname")
    webaudit.host_ok(args.base, args.allow)
    if webaudit.PAYLOAD_RE.search(args.base):
        raise SystemExit("URL похож на payload")
    print(json.dumps(recon(args.base, args.allow, args.max_js),
                     ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
