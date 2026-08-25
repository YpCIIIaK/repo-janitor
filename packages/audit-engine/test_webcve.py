# -*- coding: utf-8 -*-
"""Тесты CVE-слоя с упором на ЛОЖНЫЕ срабатывания (закрываем дыры)."""
import io
import json

import webcve


class FakeResp:
    def __init__(self, payload):
        self._b = json.dumps(payload).encode()
    def read(self):
        return self._b
    def __enter__(self):
        return self
    def __exit__(self, *a):
        return False


def opener_ok(vulns):
    def _op(req, timeout=0):
        return FakeResp({"vulns": vulns})
    return _op


def opener_fail(req, timeout=0):
    raise OSError("network down")


# --- ЛОЖНЫЕ: чего быть НЕ должно ------------------------------------------

def test_no_version_no_query():
    # баннер без версии (kittenx, nginx без номера) → НЕ кандидат
    r = webcve.correlate([{"name": "kittenx", "version": None}], opener=opener_ok([{"id": "X"}]))
    assert r["candidate_count"] == 0
    assert any("нет версии" in s["why"] for s in r["skipped"])


def test_unknown_name_not_guessed():
    # незнакомое имя со версией → НЕ гадаем экосистему, пропуск
    r = webcve.correlate([{"name": "kittenx", "version": "1.2.3"}], opener=opener_ok([{"id": "X"}]))
    assert r["candidate_count"] == 0
    assert any("маппинг" in s["why"] for s in r["skipped"])


def test_network_fail_is_unknown_not_clean():
    # сеть упала → 'unknown', НЕ пустой «безопасно»
    r = webcve.correlate([{"name": "express", "version": "4.17.1"}], opener=opener_fail)
    assert r["candidate_count"] == 0
    assert r["unknown"] and "network" in r["unknown"][0]["error"]


def test_osv_empty_no_candidate():
    # известный пакет, но OSV чист → кандидатов нет и не выдумываем
    r = webcve.correlate([{"name": "express", "version": "99.0.0"}], opener=opener_ok([]))
    assert r["candidate_count"] == 0
    assert not r["unknown"]


# --- ИСТИННЫЕ: что должно проходить ---------------------------------------

def test_known_vuln_becomes_candidate():
    vulns = [{"id": "GHSA-xxxx", "aliases": ["CVE-2021-1234"],
              "summary": "proto pollution",
              "severity": [{"type": "CVSS_V3", "score": "7.5"}]}]
    r = webcve.correlate([{"name": "express", "version": "4.17.1"}], opener=opener_ok(vulns))
    assert r["candidate_count"] == 1
    c = r["candidates"][0]
    assert c["id"] == "CVE-2021-1234"      # предпочитаем CVE из aliases
    assert c["status"] == "candidate"       # НИКОГДА не 'подтверждено'
    assert c["confidence"] < 0.6 and "кандидат" in c["note"]


def test_severity_extracted():
    vulns = [{"id": "CVE-2020-1", "database_specific": {"severity": "HIGH"}}]
    r = webcve.correlate([{"name": "next.js", "version": "9.0.0"}], opener=opener_ok(vulns))
    assert r["candidates"][0]["severity"] == "HIGH"


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
    print("ok")
