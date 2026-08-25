# -*- coding: utf-8 -*-
"""Ворота против выдумки для веб-петли. Аналог verify.py, но исходника нет —
поэтому кандидат сверяется ПОВТОРНЫМ ЖИВЫМ ЗАПРОСОМ на ту же мишень.

Модель регистрирует кандидата с типом и уликой; check() заново гоняет нужный
блок webaudit и подтверждает/отклоняет. Выдумать нельзя: перепроверка бьёт по
живой мишени, а не по прозе модели. Хост обязан быть в allow (гейт петли).

Типы:
    missing_header  {url, header}     — заголовок реально отсутствует
    weak_cookie     {url, cookie}     — cookie без Secure/HttpOnly/SameSite
    reflection      {url, param}       — канарейка отразилась (не эксплуатация)
    exposed_file    {url, path}        — файл настоящий (content-type+маркер)
    dangerous_method{url, method}      — метод в Allow (OPTIONS)
    tls             {url}              — сертификат: скорый конец/слабый протокол
"""
from __future__ import annotations

import urllib.parse

import webaudit

KINDS = ("missing_header", "weak_cookie", "reflection",
         "exposed_file", "dangerous_method", "tls", "cors")


def _root(url: str) -> str:
    u = urllib.parse.urlparse(url)
    return f"{u.scheme}://{u.netloc}"


def check(allow: list[str], kind: str, args: dict) -> dict:
    """Вернуть {ok: bool, detail: str}. ok=True только если живая
    перепроверка подтвердила улику."""
    url = args.get("url") or ""
    try:
        host = webaudit.host_ok(url, allow)
    except SystemExit as e:
        return {"ok": False, "detail": f"хост вне allow: {e}"}
    if webaudit.PAYLOAD_RE.search(url):
        return {"ok": False, "detail": "URL похож на payload — отклонено"}

    if kind == "missing_header":
        want = (args.get("header") or "").strip().lower()
        if not want:
            return {"ok": False, "detail": "не указан header"}
        st, hdr, body, _ = webaudit.fetch(url)
        blocked = webaudit.detect_block(st, hdr, body)
        if blocked:
            return {"ok": False, "detail": f"мишень блокирует ({blocked}) — заголовки страницы блока не находка"}
        present = want in hdr
        soft = webaudit.SEC_HEADERS.get(want, (None, True))[1]
        if present:
            return {"ok": False, "detail": f"{want} ПРИСУТСТВУЕТ — не находка"}
        # frame-ancestors в CSP покрывает X-Frame-Options
        if want == "x-frame-options" and "frame-ancestors" in \
                hdr.get("content-security-policy", "").lower():
            return {"ok": False, "detail": "покрыт CSP frame-ancestors — не находка"}
        sev = "info" if soft else "medium"
        return {"ok": True, "detail": f"{want} отсутствует (severity {sev})"}

    if kind == "weak_cookie":
        name = (args.get("cookie") or "").strip()
        _, _, _, cookies = webaudit.fetch(url)
        weak = webaudit.weak_cookies(webaudit.audit_cookies(cookies))
        hit = [w for w in weak if w.split(":")[0] == name]
        if hit:
            return {"ok": True, "detail": hit[0]}
        return {"ok": False, "detail": f"cookie {name!r} не слабый или отсутствует"}

    if kind == "reflection":
        param = args.get("param") or "q"
        if not webaudit.re.match(r"^[A-Za-z_][A-Za-z0-9_.-]{0,40}$", param):
            return {"ok": False, "detail": "плохое имя параметра"}
        c = webaudit.canary()
        u = urllib.parse.urlparse(url)
        q = dict(urllib.parse.parse_qsl(u.query, keep_blank_values=True))
        q[param] = c
        full = urllib.parse.urlunparse(u._replace(query=urllib.parse.urlencode(q)))
        _, hdr, body, _ = webaudit.fetch(full)
        hit = webaudit.find_canary(c, body, hdr, full)
        if hit["reflected"]:
            return {"ok": True, "detail": f"отразилась в {hit['where']}: {hit['snippet'][:120]}"}
        return {"ok": False, "detail": "канарейка не отразилась"}

    if kind == "exposed_file":
        path = args.get("path") or ""
        spec = webaudit.KNOWN_FILES.get(path)
        root = _root(url)
        base = webaudit._baseline(root)
        st, hdr, body, _ = webaudit.fetch(root + path)
        if spec:
            _, ct_allow, body_re = spec
        else:
            ct_allow, body_re = (), r"."
        res = webaudit.classify_file(spec[0] if spec else "unknown", st, body,
                                     hdr.get("content-type", ""), ct_allow,
                                     body_re, base)
        if res and res["impact"] in ("secret", "structure-leak", "info-exposure"):
            return {"ok": True, "detail": f"{path}: {res['impact']} ({res['ctype']})"}
        return {"ok": False, "detail": f"{path}: не настоящий файл/заглушка"}

    if kind == "dangerous_method":
        method = (args.get("method") or "").strip().upper()
        res = webaudit.audit_methods(url)
        if method in res.get("dangerous", []):
            return {"ok": True, "detail": f"{method} в Allow: {res['allow']}"}
        return {"ok": False, "detail": f"{method} не в Allow ({res.get('allow')})"}

    if kind == "cors":
        import webcors
        res = webcors.audit_cors(url)
        if res.get("ok"):
            return {"ok": True, "detail": res["detail"]}
        return {"ok": False, "detail": res.get("detail") or res.get("error", "CORS не открыт")}

    if kind == "tls":
        res = webaudit.audit_tls(host)
        why = []
        if res["expiring_soon"]:
            # точная дата и остаток — из сертификата, не из прозы модели
            why.append(f"истекает {res['not_after']} (через {res['days_left']}д)")
        if res["weak_protocol"]:
            why.append(f"слабый протокол {res['protocol']}")
        if why:
            return {"ok": True, "detail": "; ".join(why)}
        return {"ok": False, "detail": f"TLS в норме ({res['protocol']}, {res['days_left']}д)"}

    return {"ok": False, "detail": f"неизвестный тип кандидата: {kind}"}
