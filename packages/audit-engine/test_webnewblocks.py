# -*- coding: utf-8 -*-
"""Юнит-тесты чистых ядер новых блоков (без сети)."""
import webredirect, webssrf, webstored

# --- open redirect ---
def test_redirect_external_marker():
    v = webredirect.redirect_verdict(webredirect.MARKER_URL, "app.example")
    assert v["ok"] and v["severity"]=="medium"
def test_redirect_self_host_ok():
    v = webredirect.redirect_verdict("/dashboard", "app.example")
    assert not v["ok"]
def test_redirect_none():
    assert not webredirect.redirect_verdict(None, "app.example")["ok"]
def test_redirect_other_host_manual():
    v = webredirect.redirect_verdict("https://other.com/x", "app.example")
    assert not v["ok"] and "вручную" in v["detail"]

# --- ssrf ---
def test_ssrf_token_returned():
    v = webssrf.ssrf_verdict("prefix INTERNAL-SECRET-a1b2c3 suffix", "INTERNAL-SECRET-a1b2c3")
    assert v["ok"] and v["severity"]=="high"
def test_ssrf_no_token():
    assert not webssrf.ssrf_verdict("nothing here", "TOK")["ok"]

# --- stored ---
def test_stored_reflected_text():
    c="asctdead01"
    v=webstored.stored_verdict(c, f"<ul><li>{c}</li></ul>", {}, "https://x/comments")
    assert v["ok"] and v["severity"]=="high"
def test_stored_not_present():
    assert not webstored.stored_verdict("asctdead01","<ul></ul>",{},"https://x/comments")["ok"]

if __name__=="__main__":
    for k,v in sorted(globals().items()):
        if k.startswith("test_"): v()
    print("ok")
