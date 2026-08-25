# -*- coding: utf-8 -*-
"""Локальный НАРОЧНО уязвимый стенд для проверки сканера. Наш код, наш хост —
полное разрешение. Специально содержит дыры, чтобы убедиться, что движки
детекта их ЛОВЯТ (позитивная проверка; web.max.ru чист и такого не даёт).

    python local_vuln_app.py 8899   # поднять на 127.0.0.1:8899

Дыры:
  * GET /.env              -> отдаёт секреты (exposed_file: secret)
  * GET /api/orders/{id}   -> чужой заказ без auth (BOLA/IDOR)
  * GET /?q=...            -> отражает q в HTML без экранизации (reflected XSS)
  * GET /api/me + Origin   -> ACAO отражает Origin + ACAC=true (CORS кража)
  * нет security-заголовков; сессионная cookie без флагов
НИЧЕГО не слушает извне (127.0.0.1), поднимать только на время теста.
"""
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ORDERS = {  # id -> (владелец, данные)
    "1001": {"order": 1001, "user": "alice", "total": 500, "card": "**** 4242"},
    "1002": {"order": 1002, "user": "bob", "total": 999, "card": "**** 7777"},
}
COMMENTS = []  # хранилище для stored-XSS
INTERNAL_TOKEN = "INTERNAL-SECRET-a1b2c3"  # «внутренний» ресурс для SSRF-пробы


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass  # тихо

    def _send(self, code, body, ctype="text/html; charset=utf-8", extra=None):
        b = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(b)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        u = urlparse(self.path)
        path, qs = u.path, parse_qs(u.query)
        origin = self.headers.get("Origin")

        if path == "/.env":  # exposed secret
            return self._send(200, "DB_PASSWORD=hunter2\nAPI_KEY=sk_live_abc123\n",
                              "text/plain; charset=utf-8")

        if path.startswith("/api/orders/"):  # BOLA: без auth отдаёт любой заказ
            oid = path.rsplit("/", 1)[-1]
            if oid in ORDERS:
                import json
                return self._send(200, json.dumps(ORDERS[oid]), "application/json")
            return self._send(404, '{"error":"not found"}', "application/json")

        if path == "/api/me":  # CORS misconfig: отражает Origin + credentials
            extra = {}
            if origin:
                extra["Access-Control-Allow-Origin"] = origin
                extra["Access-Control-Allow-Credentials"] = "true"
            import json
            return self._send(200, json.dumps({"user": "alice", "email": "a@x.tld"}),
                              "application/json", extra)

        if path == "/go":  # open redirect: next= уходит в Location без проверки
            nxt = (qs.get("next") or ["/"])[0]
            return self._send(302, "", extra={"Location": nxt})

        if path == "/fetch":  # SSRF: сервер тянет любой url и отдаёт тело
            target = (qs.get("url") or [""])[0]
            if not target:
                return self._send(400, "url required", "text/plain")
            try:
                import urllib.request as _u
                with _u.urlopen(target, timeout=5) as rr:
                    return self._send(200, rr.read(20000), "text/plain")
            except Exception as e:
                return self._send(502, f"fetch error: {e}", "text/plain")

        if path == "/internal-secret":  # «внутренний» ресурс, цель SSRF
            return self._send(200, INTERNAL_TOKEN, "text/plain")

        if path == "/comments":  # stored-XSS: показывает сохранённое без экранизации
            items = "".join(f"<li>{c}</li>" for c in COMMENTS)
            return self._send(200, f"<!doctype html><ul>{items}</ul>")

        if path == "/":  # reflected: печатает q без экранизации + слабая cookie
            q = (qs.get("q") or [""])[0]
            html = f"<!doctype html><html><body><h1>Search</h1><p>You searched: {q}</p></body></html>"
            return self._send(200, html, extra={"Set-Cookie": "sessionid=abc123; Path=/"})

        return self._send(404, "<h1>404</h1>")

    def do_POST(self):
        u = urlparse(self.path)
        if u.path == "/comment":  # сохранить комментарий (для stored-XSS)
            n = int(self.headers.get("Content-Length", 0) or 0)
            raw = self.rfile.read(n).decode("utf-8", "replace")
            text = parse_qs(raw).get("text", [""])[0]
            COMMENTS.append(text)
            return self._send(200, '{"ok":true}', "application/json")
        return self._send(404, "<h1>404</h1>")


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8899
    srv = ThreadingHTTPServer(("127.0.0.1", port), H)
    print(f"vuln-app на http://127.0.0.1:{port}  (Ctrl+C чтобы остановить)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
