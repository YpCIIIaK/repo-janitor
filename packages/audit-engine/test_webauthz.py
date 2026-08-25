# -*- coding: utf-8 -*-
"""Тесты BOLA-ядра с упором на ложные (чтобы не звать публичный/защищённый BOLA'ой)."""
import webauthz

OWNER = {"status": 200, "body": '{"order":1001,"user":"A","total":500,"items":[1,2,3]}'}


# --- ИСТИННЫЙ BOLA ---------------------------------------------------------
def test_true_bola():
    other = {"status": 200, "body": '{"order":1001,"user":"A","total":500,"items":[1,2,3]}'}
    v = webauthz.bola_verdict(OWNER, other)
    assert v["ok"] and "совпали" in v["detail"]


# --- ЛОЖНЫЕ: чего быть НЕ должно -------------------------------------------
def test_protected_403_not_bola():
    v = webauthz.bola_verdict(OWNER, {"status": 403, "body": "forbidden"})
    assert not v["ok"] and "защищено" in v["detail"]

def test_protected_401_not_bola():
    v = webauthz.bola_verdict(OWNER, {"status": 401, "body": ""})
    assert not v["ok"]

def test_public_endpoint_not_bola():
    # случайный id отдаёт то же самое → публичный/заглушка
    body = '{"order":1001,"user":"A","total":500,"items":[1,2,3]}'
    other = {"status": 200, "body": body}
    notfound = {"status": 200, "body": body}
    v = webauthz.bola_verdict(OWNER, other, notfound=notfound)
    assert not v["ok"] and ("публичный" in v["detail"] or "заглушк" in v["detail"])

def test_other_gets_own_object_not_bola():
    # B получает СВОЙ объект (иные данные) → не кросс-доступ
    other = {"status": 200, "body": '{"order":2002,"user":"B","total":10,"items":[9]}'}
    v = webauthz.bola_verdict(OWNER, other)
    assert not v["ok"]

def test_owner_cannot_access_not_bola():
    v = webauthz.bola_verdict({"status": 404, "body": ""}, {"status": 200, "body": "x" * 50})
    assert not v["ok"] and "конфиг" in v["detail"].lower() or "владелец" in v["detail"]

def test_tiny_body_not_bola():
    v = webauthz.bola_verdict(OWNER, {"status": 200, "body": "ok"})
    assert not v["ok"]

def test_uniform_endpoint_not_bola():
    # всем отдаёт одно и то же (owner==other_own) → не разграничение
    same = {"status": 200, "body": "X" * 100}
    v = webauthz.bola_verdict({"status": 200, "body": "X" * 100},
                              same, other_own={"status": 200, "body": "X" * 100})
    assert not v["ok"] and "одно всем" in v["detail"]


# --- раннер без конфига честно молчит --------------------------------------
def test_run_config_empty():
    r = webauthz.run_config({"identities": {}, "objects": []})
    assert r["candidates"] == [] and "не настроены" in r["note"]


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
    print("ok")
