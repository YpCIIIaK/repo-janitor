# -*- coding: utf-8 -*-
"""Проверки инвариант-сигнала custodial-ядра на известном ответе.

Из чего родился. ungated-пайплайн даёт периферию (обёртки), а custodian-баги
(инфляция долей, донат-атака, округление) сидят в ядре хранилища. custody.py
целит туда. Тест запирает три класса на СИНТЕТИКЕ с известным ответом: наивный
vault ловится, защищённый (dead-shares/внутренний счёт/mulDiv) — нет.

    python -m unittest test_custody -v
"""
import unittest

import custody
import solsrc

# наивный: totalSupply==0 без dead-shares + курс по balanceOf(this) + деление
VULN = """pragma solidity ^0.8.0;
contract NaiveVault {
    mapping(address => uint256) public balances;
    uint256 public totalSupply;
    IERC20 public asset;
    function deposit(uint256 assets) external returns (uint256 shares) {
        if (totalSupply == 0) { shares = assets; }
        else { shares = assets * totalSupply / asset.balanceOf(address(this)); }
        totalSupply += shares;
        balances[msg.sender] += shares;
    }
    function convertToShares(uint256 assets) public view returns (uint256) {
        return assets * totalSupply / asset.balanceOf(address(this));
    }
}
interface IERC20 { function balanceOf(address) external view returns (uint256); }"""

# защищённый: dead-shares mint + внутренний счёт + mulDiv
SAFE = """pragma solidity ^0.8.0;
contract SafeVault {
    mapping(address => uint256) public balances;
    uint256 public totalSupply;
    uint256 internal _managed;
    function deposit(uint256 assets) external returns (uint256 shares) {
        if (totalSupply == 0) { _mint(address(0), MINIMUM_LIQUIDITY); shares = assets; }
        else { shares = mulDivDown(assets, totalSupply, _managed); }
        _managed += assets;
        totalSupply += shares;
    }
    function convertToShares(uint256 assets) public view returns (uint256) {
        return mulDivDown(assets, totalSupply, _managed);
    }
    uint256 constant MINIMUM_LIQUIDITY = 1000;
    function _mint(address, uint256) internal {}
    function mulDivDown(uint256 a, uint256 b, uint256 c) internal pure returns (uint256){return a*b/c;}
}"""


# chi-rate vault (SparkVault-класс): курс по внутреннему nowChi(), balanceOf(this)
# ТОЛЬКО как liquidity-require, округление через _divup. НЕ донат-уязвим.
CHIRATE = """pragma solidity ^0.8.0;
contract ChiVault {
    uint256 public totalSupply;
    address asset;
    function nowChi() public view returns (uint256) { return 1e27; }
    function convertToShares(uint256 assets) public view returns (uint256) {
        return assets * 1e27 / nowChi();
    }
    function previewRedeem(uint256 shares) external view returns (uint256 amount) {
        amount = shares * nowChi() / 1e27;
        require(IERC20(asset).balanceOf(address(this)) >= amount, "liq");
    }
    function _divup(uint256 a, uint256 b) internal pure returns (uint256){return (a+b-1)/b;}
    function previewWithdraw(uint256 assets) external view returns (uint256) {
        return _divup(assets * 1e27, nowChi());
    }
}
interface IERC20 { function balanceOf(address) external view returns (uint256); }"""


def rows(src, name):
    c = next(x for x in solsrc.parse_file("m.sol", src) if x.name == name)
    return custody.scan_contract(c)


class CustodyTests(unittest.TestCase):
    def test_наивный_vault_ловит_инфляцию_и_донат(self):
        cls = {r[1] for r in rows(VULN, "NaiveVault")}
        self.assertIn("share-inflation", cls)
        self.assertIn("donation-inflation", cls)

    def test_защищённый_vault_чист_по_инфляции_и_донату(self):
        cls = {r[1] for r in rows(SAFE, "SafeVault")}
        self.assertNotIn("share-inflation", cls, "dead-shares должен глушить")
        self.assertNotIn("donation-inflation", cls, "внутренний счёт, не balanceOf")

    def test_наивная_конверсия_делением_флагит_округление(self):
        cls = {r[1] for r in rows(VULN, "NaiveVault")}
        self.assertIn("rounding", cls)

    def test_mulDiv_конверсия_не_флагит_округление(self):
        cls = {r[1] for r in rows(SAFE, "SafeVault")}
        self.assertNotIn("rounding", cls)

    def test_chi_rate_и_liquidity_require_НЕ_донат(self):
        # SparkVault-класс: курс из nowChi(), balanceOf лишь liquidity-require,
        # округление через _divup -> ни доната, ни rounding-вопроса
        cls = {r[1] for r in rows(CHIRATE, "ChiVault")}
        self.assertNotIn("donation-inflation", cls,
                         "balanceOf в require — ликвидность, не курс")
        self.assertNotIn("rounding", cls, "_divup управляет округлением")


if __name__ == "__main__":
    unittest.main()
