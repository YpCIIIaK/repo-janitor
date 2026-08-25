# -*- coding: utf-8 -*-
"""Проверки механической дефляции severity у judge на известном ответе.

Из чего родился. Модель систематически завышала severity класса «произвольный
вызов + user-controlled target» до high/med, НЕ видя, что средства тянутся из
msg.sender и сметаются обратно (self-funded транзит — импакт ограничен самим
вызывающим, класс takeOrder, доказанный dust на форке). Замерено на enzyme
DepositWrapper.exchange*/SharesSplitterLib.redeemShares. Тест запирает: транзит +
transferFrom(msg.sender) -> low; кастодиан НЕ трогаем; from жертвы (не msg.sender)
-> остаётся high (настоящий drain прятать нельзя).

    python -m unittest test_judge -v
"""
import unittest

import judge


class DeflateTests(unittest.TestCase):
    def test_транзит_self_funded_понижается(self):
        r = {"fundflow": {"custodial": False, "kind": "transient"},
             "code": "x.safeTransferFrom(msg.sender, address(this), amt); ex.call(data);"}
        out = judge._deflate_selffunded("severity: high — arbitrary call", r)
        self.assertIn("severity: low", out)
        self.assertIn("понижено с high", out)

    def test_кастодиан_НЕ_понижается(self):
        r = {"fundflow": {"custodial": True},
             "code": "balances[msg.sender]-=a; token.transferFrom(msg.sender,address(this),a);"}
        out = judge._deflate_selffunded("severity: high — drains vault", r)
        self.assertIn("severity: high", out)

    def test_from_жертвы_не_msg_sender_остаётся_high(self):
        # transferFrom(victim,...) — НЕ self-funded, настоящий drain не прячем
        r = {"fundflow": {"custodial": False},
             "code": "token.transferFrom(victim, attacker, amt);"}
        out = judge._deflate_selffunded("severity: high — victim drain", r)
        self.assertIn("severity: high", out)

    def test_SafeERC20_arg2_from_и_алиас_sender(self):
        # SafeERC20.safeTransferFrom(token, FROM, to, amt): from во 2-м аргументе,
        # плюс локальный алиас sender=msg.sender (strata sNUSDSwapAdapter)
        r = {"fundflow": {"custodial": False, "kind": "transient"},
             "code": "address sender=msg.sender; SafeERC20.safeTransferFrom("
                     "IERC20(params.tokenIn), sender, address(this), amt); router.mint(x);"}
        out = judge._deflate_selffunded("severity: high — router from params", r)
        self.assertIn("severity: low", out)

    def test_safe_victim_drain_остаётся_high(self):
        # safeTransferFrom(token, VICTIM, attacker) — from жертвы, НЕ self-funded
        r = {"fundflow": {"custodial": False},
             "code": "SafeERC20.safeTransferFrom(token, victim, attacker, amt);"}
        out = judge._deflate_selffunded("severity: high — victim drain", r)
        self.assertIn("severity: high", out)

    def test_без_fundflow_не_трогаем(self):
        r = {"fundflow": None, "code": "token.transferFrom(msg.sender, address(this), a);"}
        out = judge._deflate_selffunded("severity: high — x", r)
        self.assertIn("severity: high", out)


if __name__ == "__main__":
    unittest.main()
