# -*- coding: utf-8 -*-
"""Веб-аудит: безопасные ПАССИВНЫЕ блоки. Не XSS-эксплуатация, не SQLi, не DoS.

Блоки (каждый только GET/OPTIONS, marker-only, ничего не меняет на сервере):

    --surface  URL   заголовки безопасности + cookie-флаги + сервер (контекст severity)
    --tls      URL   сертификат: цепочка, срок, SAN, протокол
    --methods  URL   OPTIONS → Allow, «опасные» методы
    --files    URL   probe известных забытых файлов (.git, .env, swagger, sourcemap...)
    --check    URL   отражение канарейки (--param), контекст: text/attr/script/header/url

Всегда: только https, хост обязан быть в --allow, payload-подобные URL/параметры
отбиваются (маркер ставит инструмент, не человек). Вывод — JSON, честный: пусто
если пусто. Отчёт нести на портал программы, не в паблик.

    python webaudit.py --surface https://in-scope.example/ --allow in-scope.example
    python webaudit.py --files   https://in-scope.example/  --allow in-scope.example
    python webaudit.py --check   https://in-scope.example/search --allow in-scope.example --param q
"""
from __future__ import annotations

import argparse
import json
import re
import secrets
import socket
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

UA = "auditscout-web/0.2 (authorized-scope research; marker only)"
PAYLOAD_RE = re.compile(r"[<>'\"`;\\]|--|%3c|%3e|%27|%22", re.I)

# Заголовки безопасности: имя → (человеческое, «мягкая» ли нехватка).
# soft=True означает «часто переоценивают» (см. STATE раздел 17): фиксируем,
# но не как high без подтверждённого влияния.
SEC_HEADERS = {
    "strict-transport-security": ("HSTS", False),
    "content-security-policy": ("CSP", False),
    "x-content-type-options": ("nosniff", True),
    "referrer-policy": ("Referrer-Policy", True),
    "permissions-policy": ("Permissions-Policy", True),
    "x-frame-options": ("X-Frame-Options", True),  # мягко, если в CSP есть frame-ancestors
}

# Забытые файлы: путь → (что это, чем ДОЛЖЕН быть настоящий ответ).
# ct — подстроки допустимого content-type; body_re — маркер настоящего файла.
# SPA-заглушка отдаёт 200 text/html index.html на ЛЮБОЙ путь — такое не находка,
# поэтому требуем и правильный content-type, И маркер содержимого.
KNOWN_FILES = {
    "/.git/HEAD": ("git-repo", ("text/plain", "application/"), r"^ref:\s|^[0-9a-f]{40}"),
    "/.git/config": ("git-config", ("text/plain", "application/"), r"\[core\]|repositoryformatversion"),
    "/.env": ("env-secrets", ("text/plain", "application/octet"), r"^\s*[A-Z][A-Z0-9_]+\s*="),
    "/.svn/entries": ("svn-repo", ("text/plain", "application/"), r"^\d+\s*$|svn://|dir"),
    "/robots.txt": ("robots", ("text/plain",), r"(?i)user-agent:|disallow:"),
    "/sitemap.xml": ("sitemap", ("xml",), r"<urlset|<sitemapindex"),
    "/.well-known/security.txt": ("security-txt", ("text/plain",), r"(?i)contact:"),
    "/swagger.json": ("openapi", ("json",), r'"swagger"|"openapi"'),
    "/openapi.json": ("openapi", ("json",), r'"swagger"|"openapi"'),
    "/.DS_Store": ("ds-store", ("application/octet",), r"Bud1"),
    "/phpinfo.php": ("phpinfo", ("text/html",), r"phpinfo\(\)|PHP Version"),
    "/server-status": ("apache-status", ("text/html",), r"Apache Server Status"),
    "/actuator/health": ("spring-actuator", ("json",), r'"status"\s*:\s*"(UP|DOWN)"'),
    "/metrics": ("metrics", ("text/plain",), r"(?m)^# (HELP|TYPE) "),
    "/config.json": ("config", ("json",), r"[{[]"),
    "/backup.zip": ("backup", ("application/zip", "application/octet"), r"^PK\x03\x04"),
    "/.gitlab-ci.yml": ("ci-config", ("text/plain", "yaml"), r"(?m)^(stages|script|image):"),
}

DANGER_METHODS = {"PUT", "DELETE", "TRACE", "CONNECT", "PATCH"}

# признаки, что файл действительно содержит СЕКРЕТ (а не только структуру)
SECRET_RE = re.compile(
    r"(?i)(secret|password|passwd|api[_-]?key|token|private[_-]?key|"
    r"aws_access_key_id|-----BEGIN [A-Z ]*PRIVATE KEY)")


# WAF/бот-защита: когда edge (Cloudflare и пр.) отдаёт страницу блокировки,
# любой разбор относится К НЕЙ, а не к приложению. «Missing headers» на 403
# Cloudflare — ложный сигнал. Такой ответ помечаем blocked и глушим находки.
BLOCK_STATUSES = {401, 403, 406, 429, 503}
WAF_MARKERS = re.compile(
    r"(?i)(cloudflare|just a moment|attention required|cf-mitigated|"
    r"access denied|akamai|incapsula|please enable (cookies|javascript)|"
    r"ddos|bot detection|challenge-platform)")


def detect_block(status: int, headers: dict[str, str], body: str) -> str | None:
    """Вернуть причину, если ответ — страница блокировки WAF/бота, иначе None."""
    server = (headers.get("server") or "").lower()
    if "cf-ray" in headers or "cf-mitigated" in headers:
        waf = "cloudflare"
    elif any(w in server for w in ("cloudflare", "akamai", "incapsula")):
        waf = server
    else:
        waf = None
    challenged = status in BLOCK_STATUSES or bool(WAF_MARKERS.search(body[:2000]))
    if waf and challenged:
        return f"{waf} блокирует (status {status})"
    if status in (403, 429, 503) and WAF_MARKERS.search(body[:2000]):
        return f"WAF/бот-защита (status {status})"
    return None


def canary():
    return "asct" + secrets.token_hex(6)


def host_ok(url: str, allow: list[str]) -> str:
    u = urllib.parse.urlparse(url)
    if u.scheme != "https":
        raise SystemExit("только https")
    h = (u.hostname or "").lower()
    ok = any(h == a.lower() or h.endswith("." + a.lower().lstrip("*.")) for a in allow)
    if not ok:
        raise SystemExit("хост вне --allow")
    return h


def fetch(url: str, data: bytes | None = None,
          method: str | None = None) -> tuple[int, dict[str, str], str, list[str]]:
    m = method or ("POST" if data else "GET")
    req = urllib.request.Request(url, data=data, method=m,
                                 headers={"User-Agent": UA, "Accept": "text/html,*/*;q=0.1"})
    if data:
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=15, context=ctx) as r:
            body = r.read(400_000).decode("utf-8", "replace")
            hdr = {k.lower(): v for k, v in r.headers.items()}
            cookies = r.headers.get_all("Set-Cookie") or []
            return r.status, hdr, body, cookies
    except urllib.error.HTTPError as e:
        body = e.read(400_000).decode("utf-8", "replace")
        hdr = {k.lower(): v for k, v in e.headers.items()}
        cookies = e.headers.get_all("Set-Cookie") or []
        return e.code, hdr, body, cookies


# ── блок: cookie-флаги ─────────────────────────────────────────────────────
def audit_cookies(cookies: list[str]) -> list[dict]:
    out = []
    for c in cookies:
        name = c.split("=", 1)[0].strip()
        low = c.lower()
        sm = re.search(r"samesite=(\w+)", low)
        out.append({
            "name": name,
            "secure": "secure" in low,
            "httponly": "httponly" in low,
            "samesite": sm.group(1) if sm else None,
        })
    return out


# Cookie, для которых флаги реально важны — сессия/аутентификация. Аналитику
# (_ga, __cf_bm, GeoIP, _octo…) НЕ трогаем: она намеренно доступна JS и не
# сессионная — флажить её «нет HttpOnly» это ложное (проверено на 10 сайтах).
# «access»/«refresh» без «token» намеренно НЕ включены: ловят трекинг-cookie
# вроде WMF-Last-Access (ложное на wikipedia). Только явные сессия/auth-термины.
SESSION_COOKIE_RE = re.compile(
    r"(?i)(sess|sid|auth|token|jwt|login|remember|csrf|xsrf|id_token)")


def weak_cookies(parsed: list[dict]) -> list[str]:
    weak = []
    for c in parsed:
        if not SESSION_COOKIE_RE.search(c["name"]):
            continue  # несессионная (аналитика и пр.) — не предмет флагов
        miss = [f for f in ("secure", "httponly") if not c[f]]
        if c["samesite"] in (None, "none"):
            miss.append("samesite")
        if miss:
            weak.append(f"{c['name']}: нет {', '.join(miss)}")
    return weak


# ── блок: разбор security-заголовков с контекстом ──────────────────────────
def audit_headers(hdr: dict[str, str]) -> dict:
    csp = hdr.get("content-security-policy", "")
    has_frame_ancestors = "frame-ancestors" in csp.lower()
    findings = []
    for h, (label, soft) in SEC_HEADERS.items():
        if h in hdr:
            continue
        # X-Frame-Options не нужен, если CSP уже задаёт frame-ancestors
        if h == "x-frame-options" and has_frame_ancestors:
            continue
        findings.append({"header": label, "severity": "info" if soft else "medium"})
    csp_weak = None
    if csp:
        low = csp.lower()
        # unsafe-inline/eval важны ТОЛЬКО в script-src (или default-src, если
        # script-src нет). В style-src они массовы и низкориски — не флажим,
        # иначе ложное почти на каждом сайте (проверено на 10).
        directive = None
        for d in low.split(";"):
            d = d.strip()
            if d.startswith("script-src ") or d == "script-src":
                directive = d
                break
        if directive is None:
            for d in low.split(";"):
                d = d.strip()
                if d.startswith("default-src"):
                    directive = d
                    break
        if directive and ("unsafe-inline" in directive or "unsafe-eval" in directive):
            csp_weak = "script-src допускает unsafe-inline/unsafe-eval"
        elif "default-src" not in low and "script-src" not in low:
            csp_weak = "CSP без default-src/script-src"
    return {"missing": findings, "csp_weak": csp_weak}


# ── блок: отражение канарейки ──────────────────────────────────────────────
def find_canary(c: str, body: str, headers: dict[str, str], final: str) -> dict:
    hay = body
    try:
        u = urllib.parse.urlparse(final)
        for v in (final, (u.path or "") + (u.query and "?" + u.query or ""),
                  ("?" + u.query) if u.query else "", u.query or ""):
            if v and len(v) >= 6:
                hay = hay.replace(v, "")
    except Exception:
        hay = body
    n = hay.count(c)
    if n:
        i = hay.find(c)
        before = hay[max(0, i - 200):i].lower()
        where = "text"
        if re.search(r"<script[^>]*>[^<]*$", before):
            where = "script"
        elif re.search(r"\s[a-z0-9:-]+=[\"'][^\"']*$", before):
            where = "attribute"
        snippet = re.sub(r"\s+", " ", hay[max(0, i - 40): i + len(c) + 40])
        return {"reflected": True, "where": where, "count": n, "snippet": snippet}
    for k, v in headers.items():
        if k.lower() == "location":
            continue
        if c in v:
            return {"reflected": True, "where": "header", "count": 1, "snippet": f"{k}: {v[:160]}"}
    u = urllib.parse.urlparse(final)
    extra = (u.hostname or "") + (u.path or "") + (u.fragment or "")
    if c in extra:
        return {"reflected": True, "where": "url", "count": 1, "snippet": final[:200]}
    return {"reflected": False, "where": "none", "count": 0, "snippet": ""}


# ── блок: TLS-сертификат ───────────────────────────────────────────────────
def audit_tls(host: str, port: int = 443) -> dict:
    ctx = ssl.create_default_context()
    with socket.create_connection((host, port), timeout=15) as sock:
        with ctx.wrap_socket(sock, server_hostname=host) as ss:
            cert = ss.getpeercert()
            proto = ss.version()
    not_after = cert.get("notAfter")
    days_left = None
    if not_after:
        exp = datetime.strptime(not_after, "%b %d %H:%M:%S %Y %Z").replace(tzinfo=timezone.utc)
        days_left = (exp - datetime.now(timezone.utc)).days
    san = [v for (k, v) in cert.get("subjectAltName", []) if k == "DNS"]
    issuer = dict(x[0] for x in cert.get("issuer", []))
    return {
        "protocol": proto,
        "issuer": issuer.get("organizationName") or issuer.get("commonName"),
        "not_after": not_after,
        "days_left": days_left,
        "san_count": len(san),
        "san_sample": san[:8],
        "expiring_soon": (days_left is not None and days_left < 21),
        "weak_protocol": proto in ("TLSv1", "TLSv1.1", "SSLv3"),
    }


# ── блок: методы ───────────────────────────────────────────────────────────
def audit_methods(url: str) -> dict:
    try:
        st, hdr, _, _ = fetch(url, method="OPTIONS")
    except Exception as e:
        return {"error": str(e)[:120]}
    allow = hdr.get("allow", "")
    methods = [m.strip().upper() for m in allow.split(",") if m.strip()]
    return {"status": st, "allow": methods,
            "dangerous": sorted(set(methods) & DANGER_METHODS)}


# ── блок: забытые файлы ────────────────────────────────────────────────────
def classify_file(kind: str, status: int, body: str, ctype: str,
                  ct_allow: tuple[str, ...], body_re: str,
                  baseline: dict | None = None) -> dict | None:
    """Настоящий файл ИЛИ ничего. Требует и подходящий content-type, И маркер
    содержимого. Всё, что похоже на SPA-заглушку (200 html на любой путь),
    отбрасывается — это главный источник ложных «находок»."""
    if status >= 400:
        return None
    ct = ctype.lower()
    # content-type должен соответствовать настоящему файлу этого типа
    if ct_allow and not any(a in ct for a in ct_allow):
        return None
    # маркер настоящего содержимого (не index.html)
    if not re.search(body_re, body[:8000], re.M):
        return None
    # SPA-заглушка: тот же статус и почти та же длина, что у случайного пути
    if baseline and baseline.get("status") == status \
            and abs(len(body) - baseline.get("len", -1)) < 64:
        return None
    has_secret = bool(SECRET_RE.search(body[:8000]))
    if kind in ("env-secrets", "git-config", "backup", "config") and has_secret:
        impact = "secret"
    elif kind in ("git-repo", "git-config", "svn-repo", "ds-store", "ci-config"):
        impact = "structure-leak"
    elif kind in ("openapi", "graphql", "metrics", "spring-actuator",
                  "phpinfo", "apache-status"):
        impact = "info-exposure"
    elif kind in ("robots", "sitemap", "security-txt"):
        impact = "benign"
    else:
        impact = "secret" if has_secret else "present"
    return {"kind": kind, "status": status, "impact": impact,
            "has_secret": has_secret, "ctype": ctype.split(";")[0]}


def _baseline(root: str) -> dict:
    """Замер поведения на заведомо несуществующем пути: если сайт отдаёт
    200-заглушку на всё, узнаём её длину, чтобы отсеять ложные срабатывания."""
    probe = root + "/asct-" + secrets.token_hex(8) + "-nope"
    try:
        st, _, body, _ = fetch(probe)
        return {"status": st, "len": len(body)}
    except Exception:
        return {}


def scan_files(base: str, allow: list[str]) -> list[dict]:
    u = urllib.parse.urlparse(base)
    root = f"{u.scheme}://{u.netloc}"
    baseline = _baseline(root)
    out = []
    for path, (kind, ct_allow, body_re) in KNOWN_FILES.items():
        url = root + path
        try:
            st, hdr, body, _ = fetch(url)
        except Exception:
            continue
        res = classify_file(kind, st, body, hdr.get("content-type", ""),
                            ct_allow, body_re, baseline)
        if res:
            res["path"] = path
            out.append(res)
    order = {"secret": 0, "structure-leak": 1, "info-exposure": 2, "present": 3,
             "benign": 4}
    out.sort(key=lambda r: order.get(r["impact"], 9))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--allow", action="append", default=[], help="хост скоупа, можно несколько")
    ap.add_argument("--surface", metavar="URL")
    ap.add_argument("--tls", metavar="URL")
    ap.add_argument("--methods", metavar="URL")
    ap.add_argument("--files", metavar="URL")
    ap.add_argument("--check", metavar="URL")
    ap.add_argument("--param", default="q")
    ap.add_argument("--post", action="store_true")
    args = ap.parse_args()
    if not args.allow:
        raise SystemExit("нужен --allow hostname")

    if args.surface:
        host_ok(args.surface, args.allow)
        if PAYLOAD_RE.search(args.surface):
            raise SystemExit("URL похож на payload")
        st, hdr, body, cookies = fetch(args.surface)
        blocked = detect_block(st, hdr, body)
        if blocked:
            # разбирать нечего: это страница блокировки, а не приложение
            print(json.dumps({
                "status": st, "server": hdr.get("server", ""),
                "blocked": blocked,
                "note": "ответ — страница WAF/бот-защиты, не приложение; "
                        "заголовки/cookie тут НЕ находки. Нужен браузер (ручной доступ).",
            }, ensure_ascii=False, indent=1))
            return
        hres = audit_headers(hdr)
        parsed = audit_cookies(cookies)
        print(json.dumps({
            "status": st, "server": hdr.get("server", ""),
            "headers": hres, "cookies": parsed,
            "weak_cookies": weak_cookies(parsed),
        }, ensure_ascii=False, indent=1))
        return

    if args.tls:
        h = host_ok(args.tls, args.allow)
        print(json.dumps(audit_tls(h), ensure_ascii=False, indent=1))
        return

    if args.methods:
        host_ok(args.methods, args.allow)
        if PAYLOAD_RE.search(args.methods):
            raise SystemExit("URL похож на payload")
        print(json.dumps(audit_methods(args.methods), ensure_ascii=False, indent=1))
        return

    if args.files:
        host_ok(args.files, args.allow)
        if PAYLOAD_RE.search(args.files):
            raise SystemExit("URL похож на payload")
        res = scan_files(args.files, args.allow)
        print(json.dumps({"found": res, "count": len(res)}, ensure_ascii=False, indent=1))
        if any(r["impact"] in ("secret", "structure-leak") for r in res):
            print("\n# есть утечка структуры/секрета — проверить вручную, отчёт на портал программы.")
        return

    if args.check:
        if PAYLOAD_RE.search(args.check + args.param):
            raise SystemExit("URL/param похож на payload — маркер ставит инструмент")
        if not re.match(r"^[A-Za-z_][A-Za-z0-9_.-]{0,40}$", args.param):
            raise SystemExit("плохое имя параметра")
        host_ok(args.check, args.allow)
        c = canary()
        if args.post:
            data = urllib.parse.urlencode({args.param: c}).encode()
            st, hdr, body, _ = fetch(args.check, data)
            final = args.check
        else:
            u = urllib.parse.urlparse(args.check)
            q = dict(urllib.parse.parse_qsl(u.query, keep_blank_values=True))
            q[args.param] = c
            url = urllib.parse.urlunparse(u._replace(query=urllib.parse.urlencode(q)))
            st, hdr, body, _ = fetch(url)
            final = url
        hit = find_canary(c, body, hdr, final)
        print(json.dumps({"status": st, "canary": c, **hit}, ensure_ascii=False, indent=1))
        if hit["reflected"]:
            print("\n# отразилось — можно писать отчёт без payload. портал программы, не паблик.")
        return

    ap.print_help()


if __name__ == "__main__":
    main()
