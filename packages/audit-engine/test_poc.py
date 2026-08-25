# -*- coding: utf-8 -*-
"""Проверки экономического оракула (итерация 2) на известном ответе.

Из чего родился. v1 звал green по направлению (атакующий +, цель −), и my2Wei
(2 wei) проходил как green — ложный. Итерация 2 считает net = добыча−газ и метит
пыль. Тест запирает порог на NATIVE-активе (ETH/WETH: 1:1, БЕЗ сети — цену не
дёргаем): крупная добыча -> profit, копейки -> dust. Токенный путь (DefiLlama+
decimals) сетевой, тут не тестируется.

    python -m unittest test_poc -v
"""
import unittest

import poc

GAS = 100000
BASEFEE = 20 * 10 ** 9   # 20 gwei


class EconomicsTests(unittest.TestCase):
    def test_крупная_native_добыча_profit(self):
        e = poc.economics(poc.WETH, 10 ** 18, GAS, BASEFEE)   # 1 ETH
        self.assertEqual(e["verdict"], "profit")
        self.assertGreater(e["net_wei"], 0)

    def test_копейки_native_это_dust(self):
        e = poc.economics(poc.WETH, 1000, GAS, BASEFEE)       # 1000 wei
        self.assertEqual(e["verdict"], "dust")
        self.assertLess(e["net_wei"], 0)

    def test_добыча_чуть_ниже_порога_dust(self):
        # gas_wei = 100000*(20gwei+1gwei) ~= 0.0021 ETH; добыча ниже порога 0.005
        e = poc.economics(poc.WETH, 3 * 10 ** 15, GAS, BASEFEE)  # 0.003 ETH
        self.assertEqual(e["verdict"], "dust")

    def test_газ_учтён_в_net(self):
        e = poc.economics(poc.WETH, 10 ** 18, GAS, BASEFEE)
        self.assertEqual(e["gas_wei"], GAS * (BASEFEE + 10 ** 9))
        self.assertEqual(e["net_wei"], e["gain_wei"] - e["gas_wei"])


if __name__ == "__main__":
    unittest.main()
