# -*- coding: utf-8 -*-
import webcors

O = webcors.PROBE_ORIGIN


# --- опасное = кандидат ----------------------------------------------------
def test_reflected_with_creds_high():
    v = webcors.cors_verdict(O, O, "true")
    assert v["ok"] and v["severity"] == "high"

def test_null_with_creds_high():
    v = webcors.cors_verdict(O, "null", "true")
    assert v["ok"] and v["severity"] == "high"

def test_reflected_without_creds_medium():
    v = webcors.cors_verdict(O, O, None)
    assert v["ok"] and v["severity"] == "medium"


# --- ЛОЖНЫЕ: чего быть не должно -------------------------------------------
def test_no_acao_not_finding():
    v = webcors.cors_verdict(O, None, None)
    assert not v["ok"]

def test_wildcard_not_exploitable():
    # * с credentials браузер запрещает → не кража
    v = webcors.cors_verdict(O, "*", "true")
    assert not v["ok"] and v["severity"] == "info"

def test_fixed_trusted_origin_ok():
    # сервер вернул СВОЙ домен, не наш зонд → корректно
    v = webcors.cors_verdict(O, "https://app.example.com", "true")
    assert not v["ok"] and v["severity"] is None

def test_null_without_creds_low():
    v = webcors.cors_verdict(O, "null", None)
    assert not v["ok"] and v["severity"] == "info"


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
    print("ok")
