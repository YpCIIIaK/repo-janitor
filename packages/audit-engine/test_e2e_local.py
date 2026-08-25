# -*- coding: utf-8 -*-
"""Сквозной ПОЗИТИВНЫЙ тест: движки детекта против локального уязвимого стенда.

Доказывает, что сканер НАХОДИТ реальные дыры (не только «не выдумывает»).
Полностью локально (127.0.0.1), наш код — разрешение полное. Поднимает стенд
в потоке, гоняет движки, глушит. Запуск: python test_e2e_local.py
"""
import json
import threading
import time
from http.server import ThreadingHTTPServer

import local_vuln_app
import webaudit
import webauthz
import webcors
import webredirect
import webssrf
import webstored

PORT = 8912
BASE = f"http://127.0.0.1:{PORT}"


def _serve():
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), local_vuln_app.H)
    _serve.srv = srv
    srv.serve_forever()


def setup_module(module=None):
    t = threading.Thread(target=_serve, daemon=True)
    t.start()
    for _ in range(50):
        try:
            webaudit.fetch(BASE + "/")
            return
        except Exception:
            time.sleep(0.1)
    raise RuntimeError("стенд не поднялся")


def teardown_module(module=None):
    srv = getattr(_serve, "srv", None)
    if srv:
        srv.shutdown()


def test_detects_exposed_env():
    st, h, body, _ = webaudit.fetch(BASE + "/.env")
    res = webaudit.classify_file("env-secrets", st, body, h.get("content-type", ""),
                                 ("text/plain", "application/octet"),
                                 r"^\s*[A-Z][A-Z0-9_]+\s*=", webaudit._baseline(BASE))
    assert res and res["impact"] == "secret"


def test_detects_reflected_canary():
    c = webaudit.canary()
    st, h, body, _ = webaudit.fetch(f"{BASE}/?q={c}")
    hit = webaudit.find_canary(c, body, h, f"{BASE}/?q={c}")
    assert hit["reflected"] and hit["where"] == "text"


def test_detects_weak_session_cookie():
    _, _, _, cookies = webaudit.fetch(BASE + "/")
    weak = webaudit.weak_cookies(webaudit.audit_cookies(cookies))
    assert any("sessionid" in w for w in weak)


def test_detects_missing_headers():
    _, h, _, _ = webaudit.fetch(BASE + "/")
    assert len(webaudit.audit_headers(h)["missing"]) >= 3


def test_detects_cors_reflect_creds():
    res = webcors.audit_cors(BASE + "/api/me")
    assert res.get("ok") and res.get("severity") == "high"


def test_detects_bola():
    o = webaudit.fetch(BASE + "/api/orders/1001")
    owner = {"status": o[0], "body": o[2]}
    nf = webaudit.fetch(BASE + "/api/orders/999999")
    v = webauthz.bola_verdict(owner, owner, notfound={"status": nf[0], "body": nf[2]})
    assert v["ok"]


def test_detects_open_redirect():
    res = webredirect.audit_redirect(BASE + "/go", param="next")
    assert res.get("ok") and res.get("severity") == "medium"


def test_detects_ssrf():
    marker = BASE + "/internal-secret"
    res = webssrf.audit_ssrf(BASE + "/fetch", marker,
                             local_vuln_app.INTERNAL_TOKEN, param="url")
    assert res.get("ok") and res.get("severity") == "high"


def test_detects_stored_xss():
    res = webstored.audit_stored(BASE + "/comment", "text", BASE + "/comments")
    assert res.get("ok") and res.get("severity") == "high"


def test_clean_endpoint_no_false_bola():
    # bob'ов заказ 1002 отличается от alice 1001 -> НЕ кросс-доступ (контроль)
    a = webaudit.fetch(BASE + "/api/orders/1001")
    b = webaudit.fetch(BASE + "/api/orders/1002")
    v = webauthz.bola_verdict({"status": a[0], "body": a[2]},
                              {"status": b[0], "body": b[2]})
    assert not v["ok"]


if __name__ == "__main__":
    setup_module()
    try:
        fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
        for fn in fns:
            fn()
            print("ok:", fn.__name__)
        print("ВСЕ", len(fns), "e2e-проверок прошли")
    finally:
        teardown_module()
