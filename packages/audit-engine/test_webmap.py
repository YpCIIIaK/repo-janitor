# -*- coding: utf-8 -*-
import webmap

BASE = "https://web.max.ru/"


def test_extract_html_types():
    body = ('<a href="/about">a</a><a href="https://web.max.ru/x#frag">b</a>'
            '<script src="/static/app.js"></script>'
            '<form action="/login" method="post"></form>'
            '<a href="mailto:x@y.z">skip</a><a href="javascript:void(0)">skip</a>')
    out = webmap.extract_html(body, BASE)
    assert "https://web.max.ru/about" in out["link"]
    assert "https://web.max.ru/x" in out["link"]  # фрагмент срезан
    assert "https://web.max.ru/static/app.js" in out["script"]
    assert "https://web.max.ru/login" in out["form"]
    # mailto/javascript отброшены
    assert all("mailto" not in u and "javascript" not in u for u in out["link"])


def test_mine_js_calls_and_paths():
    js = '''
      fetch("/api/v1/users");
      axios.get('/api/orders/123');
      const g = "/graphql";
      x.post(`/auth/login`);
      const img = "/logo.png";  // не путь API
    '''
    found = webmap.mine_js(js, BASE)
    assert "https://web.max.ru/api/v1/users" in found
    assert "https://web.max.ru/api/orders/123" in found
    assert "https://web.max.ru/graphql" in found
    assert "https://web.max.ru/auth/login" in found


def test_confidence_ranking():
    # прямой script важнее добытого из JS
    assert webmap.CONF["script"] > webmap.CONF["js-mined"]
    assert webmap.CONF["link"] > webmap.CONF["js-mined"]


def test_same_host_gate():
    assert webmap._same_host("https://web.max.ru/x", ["web.max.ru"])
    assert webmap._same_host("https://a.max.ru/x", ["max.ru"])
    assert not webmap._same_host("https://evil.example/x", ["web.max.ru"])


def test_norm_drops_bad_schemes():
    assert webmap._norm(BASE, "data:image/png;base64,AAAA") is None
    assert webmap._norm(BASE, "  ") is None
    assert webmap._norm(BASE, "/ok") == "https://web.max.ru/ok"


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
    print("ok")
