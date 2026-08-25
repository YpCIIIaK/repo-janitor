# -*- coding: utf-8 -*-
"""Проверки scope-манифеста на известном ответе.

Из чего родился. Программа defi-saver пишет «excluding the 'mocks' and 'views'
folders», а среди лидов был DFSPricesView из папки views — НЕeligible при подаче.
Тест запирает: исключения вытягиваются из текста актива в глобы; файл под
исключённой папкой = OOS; обычный файл в скоупе; пустой known_issues помечен
(пустое != «проблем нет»).

    python -m unittest test_scope -v
"""
import unittest

import scope

REC = {
    "slug": "x", "name": "X", "url": "u", "reward": 1, "fee": 0, "kyc": False,
    "repos": ["https://github.com/x/y"],
    "assets": [
        {"name": "https://app.x.com/", "type": "websites_and_applications",
         "url": "https://app.x.com/"},
        {"name": "X V3 (excluding the 'mocks' and 'views' folders)",
         "type": "smart_contract", "url": "https://github.com/x/y"},
    ],
}


class ScopeTests(unittest.TestCase):
    def setUp(self):
        self.m = scope.build(REC)

    def test_исключения_в_глобы(self):
        self.assertEqual(self.m["exclude_names"], ["mocks", "views"])
        self.assertIn("**/views/**", self.m["exclude_globs"])

    def test_файл_под_исключённой_папкой_OOS(self):
        ok, why = scope.in_scope(self.m, "contracts/views/DFSPricesView.sol")
        self.assertFalse(ok, why)

    def test_обычный_файл_в_скоупе(self):
        ok, _ = scope.in_scope(self.m, "contracts/exchangeV3/BebopWrapper.sol")
        self.assertTrue(ok)

    def test_сайт_не_код_OOS_тип(self):
        oos = [a for a in self.m["assets"] if not a["in_scope"]]
        self.assertEqual(len(oos), 1)
        self.assertEqual(oos[0]["type"], "websites_and_applications")

    def test_пустой_known_issues_помечен(self):
        self.assertEqual(self.m["known_issues"], [])
        self.assertTrue(self.m["known_issues_note"])

    def test_адрес_с_сетью_из_explorer_ссылки(self):
        rec = {
            "slug": "y", "name": "Y", "url": "u", "reward": 1, "fee": 0,
            "kyc": False, "repos": [],
            "assets": [
                {"name": "V", "type": "smart_contract",
                 "url": "https://etherscan.io/address/0x" + "1" * 40},
                {"name": "L2", "type": "smart_contract",
                 "url": "https://basescan.org/address/0x" + "2" * 40},
                {"name": "нет-explorer", "type": "smart_contract",
                 "url": "https://github.com/y/z"},
            ],
        }
        ac = scope.build(rec)["addr_chains"]
        self.assertIn([1, "0x" + "1" * 40], ac)
        self.assertIn([8453, "0x" + "2" * 40], ac)
        # github без explorer-домена — сеть не определить, пропущен
        self.assertEqual(len(ac), 2)

    def test_пара_xchain_по_одинаковому_имени_на_двух_сетях(self):
        rec = {
            "slug": "z", "name": "Z", "url": "u", "reward": 1, "fee": 0,
            "kyc": False, "repos": [],
            "assets": [
                {"name": "Redeemer", "type": "smart_contract",
                 "url": "https://basescan.org/address/0x" + "a" * 40},
                {"name": "Redeemer", "type": "smart_contract",
                 "url": "https://arbiscan.io/address/0x" + "b" * 40},
                {"name": "Solo", "type": "smart_contract",
                 "url": "https://etherscan.io/address/0x" + "c" * 40},
            ],
        }
        pairs = scope.build(rec)["xchain_pairs"]
        # один контракт на 2 сетях -> одна пара; Solo на одной сети -> не пара
        self.assertEqual(len(pairs), 1)
        self.assertEqual(pairs[0]["name"], "Redeemer")
        self.assertEqual(sorted([pairs[0]["a"][0], pairs[0]["b"][0]]), [8453, 42161])


if __name__ == "__main__":
    unittest.main()
