# -*- coding: utf-8 -*-
"""Блок CVE-корреляции через OSV (раздел 3). ДОСТРАИВАЕТ webfinger.

Правило раздела 3, соблюдаем буквально: «версия совпала с CVE» — это
КАНДИДАТ, а не факт. Поэтому:
  * нет версии  → запроса нет (баннер вроде 'kittenx' без версии не даёт CVE);
  * нет надёжного маппинга имя→пакет → пропуск (НЕ гадаем экосистему);
  * OSV вернул пусто → кандидатов нет (но это лишь «по версии», не аудит кода);
  * сеть упала → статус 'unknown', а НЕ 'чисто' (закрываем дыру ложного «ок»).

Запрос идёт в публичный OSV (api.osv.dev) о ПАКЕТЕ, самой мишени не касается.

    python webcve.py https://in-scope.example/ --allow in-scope.example
    python webcve.py --pkg npm:lodash@4.17.11        # прямая проверка слоя
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

OSV_URL = "https://api.osv.dev/v1/query"

# Только НАДЁЖНЫЕ маппинги имя(webfinger)→(ecosystem, package). Всё, чего тут
# нет, пропускаем — гадать экосистему значит плодить ложные.
ECOSYSTEM_MAP = {
    "next.js": ("npm", "next"),
    "nuxt": ("npm", "nuxt"),
    "express": ("npm", "express"),
    "angular": ("npm", "@angular/core"),
    "vue": ("npm", "vue"),
    "react": ("npm", "react"),
    "svelte": ("npm", "svelte"),
    "wordpress": ("Packagist", "johnpbloch/wordpress-core"),
    "drupal": ("Packagist", "drupal/core"),
    # серверы/языки самой ОС/дистрибутива в OSV npm/Packagist НЕ ищем —
    # backport-патчи дистрибутива делают такой матч заведомо ложным.
}


def osv_query(ecosystem: str, package: str, version: str, opener=None) -> dict:
    """Вернуть {ok, vulns|error}. ok=False при сетевой ошибке — вызывающий
    ОБЯЗАН трактовать это как 'unknown', не как 'безопасно'."""
    body = json.dumps({"version": version,
                       "package": {"name": package, "ecosystem": ecosystem}}).encode()
    req = urllib.request.Request(OSV_URL, body,
                                 {"Content-Type": "application/json",
                                  "User-Agent": "auditscout-cve/0.1"})
    try:
        op = opener or urllib.request.urlopen
        with op(req, timeout=15) as r:
            data = json.loads(r.read())
        return {"ok": True, "vulns": data.get("vulns", []) or []}
    except Exception as e:
        return {"ok": False, "error": str(e)[:160]}


def _sev(vuln: dict) -> str | None:
    for s in vuln.get("severity", []) or []:
        if s.get("score"):
            return s["score"]
    db = vuln.get("database_specific") or {}
    return db.get("severity")


def correlate(tech: list[dict], opener=None) -> dict:
    """tech = вывод webfinger. Возвращает кандидатов + пропуски (почему)."""
    candidates, skipped, unknown = [], [], []
    for t in tech:
        name = (t.get("name") or "").lower()
        version = t.get("version")
        if not version:
            skipped.append({"name": t.get("name"), "why": "нет версии"})
            continue
        mp = ECOSYSTEM_MAP.get(name)
        if not mp:
            skipped.append({"name": t.get("name"),
                            "why": "нет надёжного маппинга имя→пакет (не гадаем)"})
            continue
        eco, pkg = mp
        res = osv_query(eco, pkg, version, opener)
        if not res["ok"]:
            unknown.append({"name": t.get("name"), "package": pkg,
                            "version": version, "error": res["error"]})
            continue
        for v in res["vulns"]:
            ids = [v.get("id")] + (v.get("aliases") or [])
            cve = next((x for x in ids if str(x).startswith("CVE-")), v.get("id"))
            candidates.append({
                "id": cve,
                "package": f"{eco}:{pkg}",
                "version": version,
                "summary": (v.get("summary") or v.get("details") or "")[:200],
                "severity": _sev(v),
                # раздел 3: это КАНДИДАТ, контекст (backport/путь/конфиг) не проверен
                "status": "candidate",
                "confidence": 0.4,
                "note": "версия→CVE: кандидат, доступность пути и конфиг НЕ проверены",
            })
    return {"candidates": candidates, "skipped": skipped, "unknown": unknown,
            "candidate_count": len(candidates)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base", nargs="?", metavar="URL")
    ap.add_argument("--allow", action="append", default=[])
    ap.add_argument("--pkg", help="прямая проверка слоя: ecosystem:package@version")
    args = ap.parse_args()

    if args.pkg:
        eco_pkg, _, ver = args.pkg.partition("@")
        eco, _, pkg = eco_pkg.partition(":")
        tech = [{"name": pkg, "version": ver, "category": "probe"}]
        # для --pkg маппинг задан явно, обходим ECOSYSTEM_MAP
        ECOSYSTEM_MAP[pkg.lower()] = (eco, pkg)
        print(json.dumps(correlate(tech), ensure_ascii=False, indent=1))
        return

    if not args.base or not args.allow:
        raise SystemExit("нужен URL и --allow, либо --pkg ecosystem:package@version")
    import webfinger
    webfinger.webaudit.host_ok(args.base, args.allow)
    jsrefs = []
    try:
        import webmap
        jsrefs = [a["url"] for a in webmap.crawl(args.base, args.allow, max_js=0)["assets"]]
    except Exception:
        pass
    tech = webfinger.fingerprint(args.base, args.allow, jsrefs)["tech"]
    print(json.dumps({"tech": [{"name": t["name"], "version": t["version"]} for t in tech],
                      **correlate(tech)}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
