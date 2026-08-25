# -*- coding: utf-8 -*-
"""Гейт webverify: без сети, живой fetch/blocks замокан."""
import webaudit
import webverify

ALLOW = ["web.max.ru"]
URL = "https://web.max.ru/"


def test_host_gate_rejects_out_of_scope():
    r = webverify.check(ALLOW, "tls", {"url": "https://evil.example/"})
    assert not r["ok"] and "allow" in r["detail"].lower()


def test_payload_url_rejected():
    r = webverify.check(ALLOW, "reflection", {"url": "https://web.max.ru/?x=<script>"})
    assert not r["ok"]


def test_missing_header_present_is_not_finding(monkeypatch=None):
    webaudit.fetch = lambda *a, **k: (200, {"strict-transport-security": "x"}, "", [])
    r = webverify.check(ALLOW, "missing_header", {"url": URL, "header": "Strict-Transport-Security"})
    assert not r["ok"]


def test_missing_header_absent_is_finding():
    webaudit.fetch = lambda *a, **k: (200, {}, "", [])
    r = webverify.check(ALLOW, "missing_header", {"url": URL, "header": "Content-Security-Policy"})
    assert r["ok"] and "medium" in r["detail"]


def test_xfo_covered_by_frame_ancestors():
    webaudit.fetch = lambda *a, **k: (200, {"content-security-policy": "frame-ancestors 'none'"}, "", [])
    r = webverify.check(ALLOW, "missing_header", {"url": URL, "header": "X-Frame-Options"})
    assert not r["ok"]


def test_weak_cookie_confirmed():
    # сессионная cookie без флагов — слабая (аналитику мы теперь не флажим)
    webaudit.fetch = lambda *a, **k: (200, {}, "", ["sessionid=1; Path=/"])
    r = webverify.check(ALLOW, "weak_cookie", {"url": URL, "cookie": "sessionid"})
    assert r["ok"]


def test_reflection_confirmed():
    def fake(url, *a, **k):
        # эхнём канарейку из query в тело
        q = webaudit.urllib.parse.parse_qs(webaudit.urllib.parse.urlparse(url).query)
        c = q.get("q", [""])[0]
        return (200, {}, f"<p>{c}</p>", [])
    webaudit.fetch = fake
    r = webverify.check(ALLOW, "reflection", {"url": URL, "param": "q"})
    assert r["ok"] and "text" in r["detail"]


def test_reflection_absent():
    webaudit.fetch = lambda *a, **k: (200, {}, "<p>nope</p>", [])
    r = webverify.check(ALLOW, "reflection", {"url": URL, "param": "q"})
    assert not r["ok"]


def test_dangerous_method_confirmed():
    webaudit.fetch = lambda *a, **k: (200, {"allow": "GET, PUT, DELETE"}, "", [])
    r = webverify.check(ALLOW, "dangerous_method", {"url": URL, "method": "delete"})
    assert r["ok"] and "DELETE" in r["detail"]


def test_tls_expiring():
    webaudit.audit_tls = lambda *a, **k: {"expiring_soon": True, "days_left": 5,
                                          "weak_protocol": False, "protocol": "TLSv1.3",
                                          "not_after": "Sep  4 07:27:44 2026 GMT"}
    r = webverify.check(ALLOW, "tls", {"url": URL})
    # факт (дата и остаток) приходит из сертификата, а не из прозы модели
    assert r["ok"] and "5" in r["detail"] and "2026" in r["detail"]


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
    print("ok")
