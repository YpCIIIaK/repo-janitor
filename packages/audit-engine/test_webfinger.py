# -*- coding: utf-8 -*-
import webaudit
import webfinger

BASE = "https://web.max.ru/"


def test_server_header_named():
    webaudit.fetch = lambda *a, **k: (200, {"server": "kittenx"}, "<html></html>", [])
    r = webfinger.fingerprint(BASE, ["web.max.ru"])
    srv = [t for t in r["tech"] if t["category"] == "server"]
    assert srv and srv[0]["name"] == "kittenx"


def test_sveltekit_from_jsref():
    webaudit.fetch = lambda *a, **k: (200, {}, "<html></html>", [])
    r = webfinger.fingerprint(BASE, ["web.max.ru"],
                              jsrefs=["https://web.max.ru/_app/immutable/chunks/x.js"])
    fe = [t for t in r["tech"] if t["name"] == "SvelteKit"]
    assert fe and fe[0]["confidence"] >= 0.9


def test_php_version_and_cve_note():
    webaudit.fetch = lambda *a, **k: (200, {"x-powered-by": "PHP/7.4.3"}, "", [])
    r = webfinger.fingerprint(BASE, ["web.max.ru"])
    php = [t for t in r["tech"] if t["name"] == "PHP"][0]
    assert php["version"] == "7.4.3"
    assert php["cve_note"] and "КАНДИДАТ" in php["cve_note"]


def test_cookie_session_signature():
    webaudit.fetch = lambda *a, **k: (200, {}, "", ["JSESSIONID=abc; Path=/"])
    r = webfinger.fingerprint(BASE, ["web.max.ru"])
    assert any(t["name"] == "Java session" for t in r["tech"])


def test_wordpress_html():
    webaudit.fetch = lambda *a, **k: (200, {}, "<link href='/wp-content/x.css'>", [])
    r = webfinger.fingerprint(BASE, ["web.max.ru"])
    assert any(t["name"] == "WordPress" for t in r["tech"])


def test_no_version_no_cve_note():
    webaudit.fetch = lambda *a, **k: (200, {"server": "kittenx"}, "", [])
    r = webfinger.fingerprint(BASE, ["web.max.ru"])
    srv = [t for t in r["tech"] if t["category"] == "server"][0]
    assert srv["cve_note"] is None  # без версии CVE-заметки нет


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
    print("ok")
