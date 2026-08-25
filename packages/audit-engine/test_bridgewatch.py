# -*- coding: utf-8 -*-
"""Ядро bridgewatch: mutual-peer сверяется с ФАКТИЧЕСКИМ адресом другой стороны.

Из чего родился. xchain сравнивал A.peers(eidB) с B.peers(eidA) на равенство —
семантически неверно (это адреса РАЗНЫХ контрактов, всегда «разъезд»). Верно:
A.peers(eidB) обязан равняться адресу B, B.peers(eidA) — адресу A. Тест запирает:
согласованный мост -> тихо; стухший peer (A доверяет СТАРОМУ адресу B) -> окно.

    python -m unittest test_bridgewatch -v
"""
import unittest

import bridgewatch as BW
import evmabi as E
import xchain as X


def _peers_stub(mapping):
    """mapping: (rpc_marker, eid) -> адрес, который вернёт peers(uint32)."""
    sel = E.calldata("peers(uint32)", [("uint32", 0)])[:10]

    def rpc(url, method, params):
        data = params[0]["data"]
        if data[:10] != sel:
            return "0x"
        eid = int(data[10:], 16)
        for (mark, e), addr in mapping.items():
            if mark in url and e == eid:
                return "0x" + addr.lower().replace("0x", "").rjust(64, "0")
        return "0x" + "0" * 64
    return rpc


class PeerCheck(unittest.TestCase):
    A = {"rpc": "chainA", "addr": "0x" + "aa" * 20, "chain": 1, "eid": 111}
    B = {"rpc": "chainB", "addr": "0x" + "bb" * 20, "chain": 2, "eid": 222}

    def _run(self, mapping):
        X.D.rpc = _peers_stub(mapping)
        rows = BW.peer_check({"a": self.A, "b": self.B})
        return {r["label"]: r["diverged"] for r in rows}

    def test_согласованный_мост_тихо(self):
        # A доверяет РЕАЛЬНОМУ B (на eidB=222), B доверяет реальному A (eidA=111)
        d = self._run({("chainA", 222): self.B["addr"],
                       ("chainB", 111): self.A["addr"]})
        self.assertFalse(any(d.values()), "согласованный мост не должен звенеть")

    def test_стухший_peer_A_даёт_окно(self):
        # A доверяет СТАРОМУ адресу B (0xcc..), B — реальному A -> окно на стороне A
        d = self._run({("chainA", 222): "0x" + "cc" * 20,
                       ("chainB", 111): self.A["addr"]})
        self.assertTrue(d["peer A->B (A доверяет B?)"], "стухший peer = окно")
        self.assertFalse(d["peer B->A (B доверяет A?)"])

    def test_нормализация_адреса_из_bytes32(self):
        # peers возвращает bytes32 с ведущими нулями — сверка по младшим 20 байтам
        self.assertEqual(BW._as_bytes32_addr("0x" + "00" * 12 + "ab" * 20),
                         "0x" + "ab" * 20)

    def test_адрес_без_кода_звенит_а_не_молчит(self):
        # Молчаливый провал: у пустого адреса ВСЕ eth_call -> 0x -> «нет функции»
        # -> ни строки -> ложное «синхронно». Гейт has_code обязан дать ОКНО.
        def rpc(url, method, params):
            if method == "eth_getCode":
                return "0x" if "chainB" in params[0] or params[0] == \
                    self.B["addr"] else "0x60"
            return "0x"
        X.D.rpc = rpc
        rows, alarms = BW.run_entry({"a": self.A, "b": self.B})
        self.assertTrue(alarms, "адрес без кода должен звенеть, не молчать")
        self.assertIn("НЕТ КОДА", alarms[0]["label"])


if __name__ == "__main__":
    unittest.main()
