# -*- coding: utf-8 -*-
"""Проверки callgraph на известном ответе — bypass-паттерн defi-saver.

Из чего родился. Лид `BebopWrapper.takeOrder` держался на ручном шаге:
public-функция делает произвольный `.call`, whitelist опасного входа живёт в
ВЫЗЫВАЮЩЕМ (`DFSExchangeCore.offChainSwap`), а не в самой функции -> прямой
вызов обходит проверку. Тест запирает, что детектор ловит этот паттерн И НЕ
ловит функцию, которая валидирует вход у себя (иначе шум затопит вывод).

    python -m unittest test_callgraph -v
"""
import unittest

import callgraph
import solsrc

# Мишень: DIRECT-вызов обходит whitelist из вызывающего (паттерн takeOrder).
# Контроль: safeCall валидирует target У СЕБЯ -> не bypass.
SRC = """
pragma solidity ^0.8.0;

contract Registry {
    mapping(address => bool) public isAllowed;
}

contract Wrapper {
    // ПАТТЕРН: public, произвольный .call, своей проверки target НЕТ
    function takeOrder(address target, bytes calldata data) public returns (bool ok) {
        (ok, ) = target.call(data);
    }

    // КОНТРОЛЬ: сама валидирует target -> не bypass
    function safeCall(address target, bytes calldata data) public returns (bool ok) {
        require(isAllowedTarget(target), "bad");
        (ok, ) = target.call(data);
    }
    function isAllowedTarget(address) internal pure returns (bool) { return true; }
}

contract Core {
    Registry reg;
    // ВЫЗЫВАЮЩИЙ: валидирует target ДО вызова takeOrder у себя
    function run(address wrapper, address target, bytes calldata data) external {
        require(reg.isAllowed(target), "not whitelisted");
        Wrapper(wrapper).takeOrder(target, data);
    }
}
"""


class BypassTests(unittest.TestCase):
    def setUp(self):
        cons = solsrc.parse_file("mem.sol", SRC)
        self.g = callgraph.Graph(cons)
        self.g._root = "."

    def test_прямой_вызов_обходящий_whitelist_вызывающего_пойман(self):
        keys = {h["key"] for h in self.g.bypass()}
        self.assertIn("Wrapper.takeOrder", keys,
                      "bypass-паттерн takeOrder должен быть найден")

    def test_функция_валидирующая_вход_у_себя_НЕ_bypass(self):
        keys = {h["key"] for h in self.g.bypass()}
        self.assertNotIn("Wrapper.safeCall", keys,
                         "safeCall валидирует target сам — это не bypass")

    def test_вызывающий_и_тип_вызова_видны(self):
        callers = self.g.callers_of("takeOrder")
        names = {"%s.%s" % (c.name, f.name) for f, c, _ in callers}
        self.assertIn("Core.run", names)

    def test_достижима_напрямую_различает_public_и_internal(self):
        pub = [f for c in self.g.contracts for f in c.funcs
               if f.name == "takeOrder"][0]
        intern = [f for c in self.g.contracts for f in c.funcs
                  if f.name == "isAllowedTarget"][0]
        self.assertTrue(self.g.reachable_directly(pub))
        self.assertFalse(self.g.reachable_directly(intern))


if __name__ == "__main__":
    unittest.main()
