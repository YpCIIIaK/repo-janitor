# -*- coding: utf-8 -*-
"""Блок discovery: пассивная карта приложения (endpoint map).

Отвечает НЕ на «уязвим ли endpoint», а на «какие endpoint вообще есть» —
первый слой сканера (WSTG asset discovery, раздел 17 «Endpoint Normalizer»).
Только GET по --allow, ничего не меняет. Каждый актив с provenance и
confidence, как в модели раздела 2:

    {"url": ".../api/v1/x", "source": "js-mined", "confidence": 0.5, ...}

Источники:
    link       <a href>, <link href>          — прямо в HTML, conf 0.9
    script     <script src>                    — прямо в HTML, conf 0.9
    form       <form action>                   — прямо в HTML, conf 0.85
    js-mined   fetch()/axios/строки-пути в JS  — догадка,     conf 0.5

    python webmap.py https://in-scope.example/ --allow in-scope.example
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.parse

import webaudit  # переиспользуем host_ok / fetch / PAYLOAD_RE

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# --- извлечение из HTML ----------------------------------------------------
HREF_RE = re.compile(r"""<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["']""", re.I)
LINK_RE = re.compile(r"""<link\b[^>]*?\bhref\s*=\s*["']([^"']+)["']""", re.I)
SCRIPT_RE = re.compile(r"""<script\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']""", re.I)
FORM_RE = re.compile(r"""<form\b[^>]*?\baction\s*=\s*["']([^"']+)["']""", re.I)

# --- добыча из JS ----------------------------------------------------------
# 1) явные HTTP-вызовы. НАМЕРЕННО без generic .get/.post — в минифицированном
#    коде это Map.get/массивы, а не сеть (главный источник false-positive).
CALL_RE = re.compile(
    r"""(?:fetch|axios(?:\.(?:get|post|put|patch|delete|request))?|\$http)\s*\(\s*["'`]([^"'`]{2,120})["'`]""",
    re.I)
# 2) строки-пути, где ключевое слово — ЦЕЛЫЙ сегмент (не префикс слова):
#    "/api/...", "/v1/...", "/graphql". "/userId" сюда НЕ попадёт.
PATH_RE = re.compile(
    r"""["'`](/(?:api|v\d+|graphql|rest|internal|auth|oauth)(?:/[A-Za-z0-9_\-./{}:]{0,80})?)(?:["'`?])""",
    re.I)

SKIP_EXT = (".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico",
            ".woff", ".woff2", ".ttf", ".eot", ".css", ".mp4", ".webm")


def _norm(base: str, ref: str) -> str | None:
    ref = ref.strip()
    if not ref or ref.startswith(("data:", "mailto:", "tel:", "javascript:", "blob:")):
        return None
    try:
        u = urllib.parse.urljoin(base, ref)
    except Exception:
        return None
    u = urllib.parse.urldefrag(u)[0]
    if not u.startswith("http"):
        return None
    return u


def extract_html(body: str, base: str) -> dict[str, set[str]]:
    """Прямые ссылки из HTML по типам источника."""
    out = {"link": set(), "script": set(), "form": set()}
    for ref in HREF_RE.findall(body) + LINK_RE.findall(body):
        u = _norm(base, ref)
        if u:
            out["link"].add(u)
    for ref in SCRIPT_RE.findall(body):
        u = _norm(base, ref)
        if u:
            out["script"].add(u)
    for ref in FORM_RE.findall(body):
        u = _norm(base, ref)
        if u:
            out["form"].add(u)
    return out


ABS_URL_RE = re.compile(r"""["'`](https://[a-z0-9.\-]+(?:/[A-Za-z0-9_\-./{}:]*)?)["'`]""", re.I)


def mine_js(text: str, base: str) -> set[str]:
    """Пути/URL, добытые из тела JS. Догадки — низкая confidence."""
    found = set()
    for m in CALL_RE.findall(text):
        u = _norm(base, m)
        if u:
            found.add(u)
    for m in PATH_RE.findall(text):
        u = _norm(base, m)
        if u:
            found.add(u)
    # абсолютные URL — чтобы всплыли внешние хосты (API-base и пр.)
    for m in ABS_URL_RE.findall(text):
        found.add(m)
    return found


def _same_host(url: str, allow: list[str]) -> bool:
    h = (urllib.parse.urlparse(url).hostname or "").lower()
    return any(h == a.lower() or h.endswith("." + a.lower().lstrip("*."))
               for a in allow)


CONF = {"link": 0.9, "script": 0.9, "form": 0.85, "js-mined": 0.5}


def crawl(base: str, allow: list[str], max_js: int = 6) -> dict:
    """Один проход: базовая страница + добыча из её JS-бандлов. Пассивно,
    GET-only, в пределах allow. Возвращает структуру карты."""
    assets: dict[str, dict] = {}
    referenced: dict[str, int] = {}  # внешние хосты из JS (кандидаты в API-base)

    def add(url: str, source: str):
        if webaudit.PAYLOAD_RE.search(url):
            return
        if not _same_host(url, allow):
            # чужой хост НЕ сканируем, но ЗАПОМИНАЕМ: там часто живёт API-base,
            # к которому склеиваются /v1-пути (иначе теряем главную поверхность)
            h = (urllib.parse.urlparse(url).hostname or "").lower()
            if h and "." in h:
                referenced[h] = referenced.get(h, 0) + 1
            return
        cur = assets.get(url)
        conf = CONF.get(source, 0.5)
        if not cur or conf > cur["confidence"]:
            assets[url] = {"url": url, "source": source, "confidence": conf}

    st, hdr, body, _ = webaudit.fetch(base)
    html = extract_html(body, base)
    for kind, urls in html.items():
        for u in urls:
            add(u, kind)

    # JS-бандлы: и <script src>, и <link href=...js> (modulepreload у SvelteKit/
    # Vite — именно так подключают чанки). Только свой хост, только .js.
    js_candidates = [u for u in (html["script"] | html["link"])
                     if _same_host(u, allow) and u.split("?")[0].lower().endswith(".js")]
    scripts = sorted(set(js_candidates))[:max_js]
    js_mined = 0
    for js_url in scripts:
        try:
            _, jh, jbody, _ = webaudit.fetch(js_url)
        except Exception:
            continue
        if "javascript" not in jh.get("content-type", "") and \
                not js_url.lower().endswith(".js"):
            continue
        for u in mine_js(jbody, base):
            add(u, "js-mined")
            js_mined += 1

    rows = sorted(assets.values(),
                  key=lambda r: (-r["confidence"], r["url"]))
    # разложить эндпоинты по пути для читаемости
    for r in rows:
        p = urllib.parse.urlparse(r["url"])
        r["path"] = p.path or "/"
    ref_sorted = sorted(referenced.items(), key=lambda kv: -kv[1])
    return {"base": base, "status": st, "allow": allow,
            "scripts_scanned": len(scripts), "js_hits": js_mined,
            "count": len(rows), "assets": rows,
            "referenced_hosts": [{"host": h, "hits": n} for h, n in ref_sorted]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("base", metavar="URL")
    ap.add_argument("--allow", action="append", default=[])
    ap.add_argument("--max-js", type=int, default=6)
    args = ap.parse_args()
    if not args.allow:
        raise SystemExit("нужен --allow hostname")
    webaudit.host_ok(args.base, args.allow)
    if webaudit.PAYLOAD_RE.search(args.base):
        raise SystemExit("URL похож на payload")
    print(json.dumps(crawl(args.base, args.allow, args.max_js),
                     ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
