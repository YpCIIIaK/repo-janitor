# -*- coding: utf-8 -*-
"""Блок IDOR/BOLA: дифференциальная проверка авторизации на объектах (раздел 5).

Метод: A владеет объектом → B просит ТОТ ЖЕ объект. Если B его получает —
кандидат на BOLA/IDOR. Активные запросы, поэтому нужен КОНФИГ личностей и
объектов (свои тестовые аккаунты, свои id) — без него блок честно молчит.
Никаких payload'ов, только смена идентичности на своих же тестовых данных.

Ядро анти-ложных (bola_verdict) — чистая функция, юнит-тестируется:
  * владелец не открыл свой объект → это не BOLA, а сломанный/неверный конфиг;
  * B получил 401/403 → корректно защищено;
  * endpoint отдаёт то же всем (публичный/SPA-заглушка на любой id) → не BOLA;
  * B получил ответ, СОВПАДАЮЩИЙ с ответом владельца и содержательный → кандидат.

Конфиг (JSON):
  {"allow":["app.example"],
   "identities":{"A":{"headers":{"Authorization":"Bearer .."}},
                 "B":{"headers":{"Authorization":"Bearer .."}}},
   "objects":[{"endpoint":"https://app.example/api/orders/{id}",
               "owner":"A","id":"1001","method":"GET"}]}

    python webauthz.py --config authz.json
"""
from __future__ import annotations

import argparse
import json
import sys

import webaudit

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

MIN_BODY = 24          # ниже — ответ слишком мал, чтобы судить о «данных»


def _similar(a: str, b: str) -> bool:
    """Совпадение тел по СОДЕРЖИМОМУ, не по длине: два разных объекта близкой
    длины НЕ должны считаться одинаковыми (источник ложных BOLA). Порог 0.9 по
    посимвольному сходству; сравниваем начало (перф)."""
    import difflib
    if not a or not b:
        return False
    if len(a) < MIN_BODY or len(b) < MIN_BODY:
        return a == b
    return difflib.SequenceMatcher(None, a[:4000], b[:4000]).ratio() >= 0.9


def _ok2xx(status: int) -> bool:
    return 200 <= status < 300


def bola_verdict(owner: dict, other: dict, notfound: dict | None = None,
                 other_own: dict | None = None) -> dict:
    """Чистое ядро. owner/other/other_own/notfound = {status, body}.
    owner  — владелец открывает СВОЙ объект;
    other  — другая личность открывает объект владельца;
    notfound — любая личность открывает СЛУЧАЙНЫЙ id (детектор публичного/SPA);
    other_own — other открывает СВОЙ объект (доказывает, что данные различны)."""
    if not _ok2xx(owner.get("status", 0)):
        return {"ok": False, "detail": "владелец не открыл свой объект — конфиг/эндпоинт, не BOLA"}
    ostatus = other.get("status", 0)
    if ostatus in (401, 403):
        return {"ok": False, "detail": f"B получил {ostatus} — корректно защищено"}
    if not _ok2xx(ostatus):
        return {"ok": False, "detail": f"B получил {ostatus} — доступа нет"}
    obody = other.get("body", "") or ""
    if len(obody) < MIN_BODY:
        return {"ok": False, "detail": "ответ B слишком мал/пуст — не данные объекта"}
    # публичный эндпоинт или SPA-заглушка: случайный id отдаёт то же самое
    if notfound and _ok2xx(notfound.get("status", 0)) and _similar(obody, notfound.get("body", "")):
        return {"ok": False, "detail": "эндпоинт отдаёт то же на случайный id — публичный/заглушка, не BOLA"}
    # эндпоинт всем отдаёт одно и то же (у B свой объект = объекту владельца)?
    if other_own and _similar(obody, other_own.get("body", "")) and \
            _similar(owner.get("body", ""), other_own.get("body", "")):
        return {"ok": False, "detail": "эндпоинт возвращает одно всем — не разграничение объектов"}
    # ключевое: B получил ответ, совпадающий с ответом владельца
    if _similar(obody, owner.get("body", "")):
        return {"ok": True, "detail": f"B ({ostatus}) прочитал объект владельца — тела совпали ({len(obody)}б)"}
    return {"ok": False, "detail": "ответ B не совпал с объектом владельца — вероятно свой/иной ресурс"}


# --- живой раннер по конфигу -----------------------------------------------
def _fetch_as(url: str, ident: dict, method: str = "GET") -> dict:
    import urllib.request
    headers = {"User-Agent": webaudit.UA, "Accept": "*/*"}
    headers.update(ident.get("headers") or {})
    if ident.get("cookies"):
        headers["Cookie"] = ident["cookies"]
    req = urllib.request.Request(url, method=method, headers=headers)
    import ssl
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=15, context=ctx) as r:
            return {"status": r.status, "body": r.read(200_000).decode("utf-8", "replace")}
    except urllib.error.HTTPError as e:
        return {"status": e.code, "body": e.read(200_000).decode("utf-8", "replace")}
    except Exception as e:
        return {"status": 0, "body": "", "error": str(e)[:120]}


def run_config(cfg: dict) -> dict:
    allow = cfg.get("allow") or []
    idents = cfg.get("identities") or {}
    objects = cfg.get("objects") or []
    if not idents or not objects:
        return {"note": "роли/объекты не настроены — BOLA-проверка пропущена", "candidates": []}
    candidates, checks = [], []
    for obj in objects:
        ep, owner_name = obj.get("endpoint", ""), obj.get("owner")
        oid, method = str(obj.get("id", "")), obj.get("method", "GET")
        if not allow:
            return {"error": "нет allow в конфиге — не бьём вне скоупа", "candidates": []}
        webaudit.host_ok(ep, allow)  # бросит, если вне скоупа
        if webaudit.PAYLOAD_RE.search(ep + oid):
            checks.append({"endpoint": ep, "skip": "id/URL похож на payload"})
            continue
        owner_id = idents.get(owner_name)
        if not owner_id:
            continue
        url = ep.replace("{id}", oid)
        owner_resp = _fetch_as(url, owner_id, method)
        nf_url = ep.replace("{id}", oid + "000999")
        notfound = _fetch_as(nf_url, owner_id, method)
        for name, ident in idents.items():
            if name == owner_name:
                continue
            other = _fetch_as(url, ident, method)
            v = bola_verdict(owner_resp, other, notfound)
            checks.append({"endpoint": ep, "owner": owner_name, "as": name,
                           "verdict": v["detail"], "hit": v["ok"]})
            if v["ok"]:
                candidates.append({"kind": "bola", "endpoint": ep, "id": oid,
                                   "owner": owner_name, "accessed_by": name,
                                   "detail": v["detail"], "status": "candidate"})
    return {"candidates": candidates, "checks": checks,
            "candidate_count": len(candidates)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", help="JSON с identities/objects/allow")
    args = ap.parse_args()
    if not args.config:
        raise SystemExit("нужен --config authz.json (без него BOLA не проверить)")
    with open(args.config, "r", encoding="utf-8") as fh:
        cfg = json.load(fh)
    print(json.dumps(run_config(cfg), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
