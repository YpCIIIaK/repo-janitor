# -*- coding: utf-8 -*-
"""Проверки резолвера Контракт->адрес на известном ответе.

Из чего родился. fundflow.onchain работал, но адрес подавали руками. Резолвер
достаёт его из конфига развёртывания в репо (`addresses/<сеть>.json` со списком
{name,address,path}). Тест запирает: имя рядом с адресом даёт пару; сеть берётся
из имени файла; голый адрес без имени НЕ попадает в карту (резолв по имени, не
по позиции — ложный адрес хуже отсутствия).

    python -m unittest test_resolveaddr -v
"""
import unittest

import resolveaddr


class PairsTests(unittest.TestCase):
    def test_запись_name_address(self):
        node = [{"name": "BebopWrapper", "address": "0x" + "a" * 40,
                 "path": "x.sol"}]
        self.assertEqual(resolveaddr._pairs(node),
                         [("BebopWrapper", "0x" + "a" * 40)])

    def test_ключ_как_имя(self):
        node = {"MyVault": "0x" + "b" * 40}
        self.assertIn(("MyVault", "0x" + "b" * 40), resolveaddr._pairs(node))

    def test_голый_адрес_без_имени_пропущен(self):
        # список позиционных адресов без имён — резолвить не по чему
        node = ["0x" + "c" * 40, "0x" + "d" * 40]
        self.assertEqual(resolveaddr._pairs(node), [])

    def test_сеть_из_имени_файла(self):
        self.assertEqual(resolveaddr._chain_of("addresses/optimism.json"), 10)
        self.assertEqual(resolveaddr._chain_of("x/base.json"), 8453)
        self.assertEqual(resolveaddr._chain_of("deploy/mainnet.json"), 1)
        self.assertIsNone(resolveaddr._chain_of("random/config.json"))


if __name__ == "__main__":
    unittest.main()
