# -*- coding: utf-8 -*-
import webaudit


def test_find_canary_text():
    c = "asctdeadbeef12"
    body = "<p>hello asctdeadbeef12 world</p>"
    hit = webaudit.find_canary(c, body, {}, "https://x.test/")
    assert hit["reflected"] and hit["where"] == "text" and hit["count"] == 1


def test_find_canary_attribute_and_script():
    c = "asctc0ffee0001"
    attr = webaudit.find_canary(c, f'<input value="{c}">', {}, "https://x.test/")
    assert attr["where"] == "attribute"
    scr = webaudit.find_canary(c, f'<script>var x="{c}"</script>', {}, "https://x.test/")
    assert scr["where"] in ("script", "attribute")  # внутри script-тега


def test_query_string_is_not_reflection():
    c = "asctdeadbeef12"
    hit = webaudit.find_canary(c, "<html>ok</html>", {}, f"https://web.max.ru/?q={c}")
    assert not hit["reflected"]
    hit = webaudit.find_canary("asctdeadbeef12", "<p>nope</p>", {}, "https://x.test/")
    assert not hit["reflected"]


def test_form_action_echo_is_not_reflection():
    c = "asctdeadbeef12"
    url = f"https://factum.agency/?q={c}"
    body = f'<form action="/?q={c}#wpcf7-f294-o1" method="post">'
    hit = webaudit.find_canary(c, body, {}, url)
    assert not hit["reflected"]


def test_payload_re_blocks():
    assert webaudit.PAYLOAD_RE.search("<script>")
    assert webaudit.PAYLOAD_RE.search("' or")
    assert not webaudit.PAYLOAD_RE.search("https://app.example/search")


def test_cookie_flags():
    parsed = webaudit.audit_cookies([
        "sid=abc; Path=/; Secure; HttpOnly; SameSite=Lax",
        "sessionid=xyz; Path=/",              # сессионная, без флагов → слабая
        "_ga=GA1.2; Path=/",                  # аналитика → НЕ флажим
    ])
    assert parsed[0]["secure"] and parsed[0]["httponly"] and parsed[0]["samesite"] == "lax"
    weak = webaudit.weak_cookies(parsed)
    assert any("sessionid" in w for w in weak)      # сессионная без флагов — слабая
    assert not any("sid=" in w or w.startswith("sid:") for w in weak)  # защищённая sid ок
    # аналитику _ga не флажим — это было ложное на реальных сайтах
    assert not any("_ga" in w for w in weak)


def test_csp_weak_only_script_src():
    # unsafe-inline в style-src — НЕ находка (массово, низкий риск)
    style_only = {"content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'self'"}
    assert webaudit.audit_headers(style_only)["csp_weak"] is None
    # unsafe-inline в script-src — находка
    script_bad = {"content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'"}
    assert webaudit.audit_headers(script_bad)["csp_weak"]


def test_headers_frame_ancestors_suppresses_xfo():
    hdr = {"content-security-policy": "default-src 'self'; frame-ancestors 'none'"}
    res = webaudit.audit_headers(hdr)
    labels = [f["header"] for f in res["missing"]]
    assert "X-Frame-Options" not in labels  # покрыт frame-ancestors
    assert "HSTS" in labels


def test_headers_weak_csp():
    hdr = {"content-security-policy": "default-src 'self' 'unsafe-inline'"}
    assert webaudit.audit_headers(hdr)["csp_weak"]


ENV = ("text/plain", "application/octet")
GIT = ("text/plain", "application/")
JSON = ("json",)


def test_classify_spa_index_is_not_finding():
    # SPA отдаёт index.html на .env → неверный content-type → не находка
    assert webaudit.classify_file("env-secrets", 200,
                                  "<!DOCTYPE html><html></html>", "text/html",
                                  ENV, r"^\s*[A-Z][A-Z0-9_]+\s*=") is None


def test_classify_swagger_html_stub_is_not_finding():
    # /swagger.json отдаёт html-заглушку → не openapi
    assert webaudit.classify_file("openapi", 200, "<!doctype html><html></html>",
                                  "text/html", JSON, r'"swagger"|"openapi"') is None


def test_classify_env_secret():
    res = webaudit.classify_file("env-secrets", 200,
                                 "DB_PASSWORD=hunter2\nAPI_KEY=xyz", "text/plain",
                                 ENV, r"^\s*[A-Z][A-Z0-9_]+\s*=")
    assert res and res["impact"] == "secret" and res["has_secret"]


def test_classify_git_structure_leak():
    res = webaudit.classify_file("git-repo", 200, "ref: refs/heads/main",
                                 "text/plain", GIT, r"^ref:\s|^[0-9a-f]{40}")
    assert res and res["impact"] == "structure-leak"


def test_classify_baseline_stub_suppressed():
    # правильный content-type и маркер, но длина == baseline → SPA-заглушка
    body = '{"openapi":"3.0"}'
    base = {"status": 200, "len": len(body)}
    assert webaudit.classify_file("openapi", 200, body, "application/json",
                                  JSON, r'"swagger"|"openapi"', base) is None


def test_classify_404_is_none():
    assert webaudit.classify_file("backup", 404, "not found", "text/html",
                                  ("application/zip",), r"^PK") is None


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
    print("ok")
