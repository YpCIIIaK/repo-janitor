# -*- coding: utf-8 -*-
"""Блок fingerprinting: пассивное определение стека (раздел 3 роадмапа).

Определяет сервер/фреймворк/frontend/CDN по заголовкам, cookie, HTML-маркерам
и путям JS-бандлов. Каждый вывод с evidence и confidence. Версии извлекаются,
если видны. CVE-корреляция ЗДЕСЬ НЕ делается: правило раздела 3 — «версия
совпала с CVE» это КАНДИДАТ, а не факт; для этого нужен фид и проверка
контекста. Мы честно отдаём стек+версию, вопрос CVE оставляем следующему слою.

Пассивно, GET-only, --allow-гейт.

    python webfinger.py https://in-scope.example/ --allow in-scope.example
"""
from __future__ import annotations

import argparse
import json
import re
import sys

import webaudit

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# сигнатуры: (категория, имя, где искать, паттерн, confidence)
#   scope: header:<name> | cookie | html | jsref (пути бандлов из webmap)
SIGNATURES = [
    # frontend-фреймворки по путям бандлов / маркерам HTML
    ("frontend", "SvelteKit", "jsref", r"/_app/immutable/", 0.9),
    ("frontend", "Next.js", "jsref", r"/_next/static/", 0.9),
    ("frontend", "Next.js", "html", r"__NEXT_DATA__|/_next/", 0.85),
    ("frontend", "Nuxt", "html", r"__NUXT__|/_nuxt/", 0.85),
    ("frontend", "Vite", "jsref", r"/assets/index-[A-Za-z0-9_-]{6,}\.js", 0.6),
    ("frontend", "React", "html", r"data-reactroot|react(?:-dom)?[.@]", 0.5),
    ("frontend", "Angular", "html", r"ng-version=\"([0-9.]+)\"", 0.9),
    ("frontend", "Vue", "html", r"data-v-[0-9a-f]{8}", 0.5),
    # CMS
    ("cms", "WordPress", "html", r"/wp-content/|/wp-includes/", 0.9),
    ("cms", "Drupal", "html", r"Drupal\.settings|/sites/default/files", 0.8),
    # серверы / прокси (заголовки)
    ("server", None, "header:server", r"(.+)", 0.9),
    ("proxy", None, "header:via", r"(.+)", 0.7),
    ("lang", "PHP", "header:x-powered-by", r"PHP/?([0-9.]+)?", 0.9),
    ("lang", "ASP.NET", "header:x-powered-by", r"ASP\.NET", 0.9),
    ("lang", "Express", "header:x-powered-by", r"Express", 0.9),
    # CDN / WAF по заголовкам
    ("cdn", "Cloudflare", "header:server", r"cloudflare", 0.9),
    ("cdn", "Cloudflare", "header:cf-ray", r".+", 0.95),
    ("cdn", "Fastly", "header:x-served-by", r"cache-.*", 0.7),
    ("cdn", "Akamai", "header:x-akamai-transformed", r".+", 0.8),
    ("cdn", "Amazon CloudFront", "header:x-amz-cf-id", r".+", 0.9),
    # аналитика/сессии по имени cookie
    ("session", "PHP session", "cookie", r"\bPHPSESSID=", 0.8),
    ("session", "Java session", "cookie", r"\bJSESSIONID=", 0.8),
    ("session", "ASP.NET session", "cookie", r"\bASP\.NET_SessionId=", 0.8),
    ("session", "Express session", "cookie", r"\bconnect\.sid=", 0.8),
    ("session", "Django session", "cookie", r"\bsessionid=.*csrftoken=", 0.6),
]

VERSION_RE = re.compile(r"([0-9]+\.[0-9]+(?:\.[0-9]+)?)")


def _scan_scope(scope: str, headers: dict[str, str], body: str,
                cookies: list[str], jsrefs: list[str]) -> str | None:
    if scope.startswith("header:"):
        return headers.get(scope.split(":", 1)[1].lower())
    if scope == "cookie":
        return " ; ".join(cookies) if cookies else None
    if scope == "html":
        return body[:200_000]
    if scope == "jsref":
        return "\n".join(jsrefs) if jsrefs else None
    return None


def fingerprint(base: str, allow: list[str], jsrefs: list[str] | None = None) -> dict:
    st, hdr, body, cookies = webaudit.fetch(base)
    jsrefs = jsrefs or []
    tech = []
    seen = set()
    for cat, name, scope, pat, conf in SIGNATURES:
        hay = _scan_scope(scope, hdr, body, cookies, jsrefs)
        if not hay:
            continue
        m = re.search(pat, hay, re.I)
        if not m:
            continue
        # имя из группы, если сигнатура «header:*» без явного имени (server/via)
        label = name
        ev = m.group(0)
        if name is None:
            label = m.group(1).strip()[:60] if m.groups() else ev[:60]
        # версия: из захвата или из evidence
        version = None
        if m.groups() and m.group(1) and VERSION_RE.fullmatch(m.group(1)):
            version = m.group(1)
        else:
            vm = VERSION_RE.search(ev)
            if vm and cat in ("frontend", "lang", "server"):
                version = vm.group(1)
        key = (cat, (label or "").lower())
        if key in seen:
            continue
        seen.add(key)
        tech.append({
            "category": cat, "name": label, "version": version,
            "confidence": conf, "evidence": re.sub(r"\s+", " ", ev)[:120],
            # честно по разделу 3: CVE — отдельный слой, не здесь
            "cve_note": "версия→CVE это КАНДИДАТ, нужна проверка контекста" if version else None,
        })
    tech.sort(key=lambda t: -t["confidence"])
    return {"base": base, "status": st, "count": len(tech), "tech": tech}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base", metavar="URL")
    ap.add_argument("--allow", action="append", default=[])
    args = ap.parse_args()
    if not args.allow:
        raise SystemExit("нужен --allow hostname")
    webaudit.host_ok(args.base, args.allow)
    if webaudit.PAYLOAD_RE.search(args.base):
        raise SystemExit("URL похож на payload")
    # подмешать пути бандлов из webmap для jsref-сигнатур
    jsrefs = []
    try:
        import webmap
        m = webmap.crawl(args.base, args.allow, max_js=0)
        jsrefs = [a["url"] for a in m["assets"]]
    except Exception:
        pass
    print(json.dumps(fingerprint(args.base, args.allow, jsrefs),
                     ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
