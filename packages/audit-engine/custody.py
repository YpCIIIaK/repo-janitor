# -*- coding: utf-8 -*-
"""ИНВАРИАНТЫ CUSTODIAL-ЯДРА — механический сигнал туда, где ungated слеп.

Зачем. Замерено на 10 мишенях (19.08): ungated-центричный пайплайн вытаскивает
ПЕРИФЕРИЮ — permissionless обёртки/адаптеры (транзитные, self-funded, low). А
ценные custodian-баги (инфляция долей, донат-атака, кривое округление) сидят
ВНУТРИ гейтованных функций хранилища и как «ungated» не всплывают вовсе. Этот
сигнал целит в само ядро — но только там, где [[fundflow-impact]] метит контракт
КАСТОДИАНОМ (держит чужие средства): в обёртке этих багов нет по определению.

Три статически-детектируемых класса высокой ценности (без компиляции/фаззинга):

1. ИНФЛЯЦИЯ ДОЛЕЙ / первый депозитор. Ветка `totalSupply == 0` в функции чеканки
   долей без защиты (dead-shares mint / minimum-liquidity / virtual offset) —
   первый вкладчик задаёт курс и грабит следующих (класс, укравший миллионы у
   форков ERC4626).
2. ДОНАТ-ИНФЛЯЦИЯ. Курс доли считается по `balanceOf(address(this))`, а не по
   внутреннему счёту — прямой перевод на контракт двигает курс (donation attack).
3. ОКРУГЛЕНИЕ. Конверсия shares<->assets простым делением — проверить, что
   депозит округляет ВНИЗ (в пользу хранилища), а вывод не округляет вверх.

Вывод даёт `file.sol:line` — течёт в [[gating-and-scan-flow]] scan как кандидат.
Это ВОПРОС инварианта, не находка: «здесь курс/округление, докажи асимметрию».

использование:
    custody.py <корень>            по кастодианам дерева
    custody.py <корень> --all      игнорировать fundflow-гейт (все контракты)
"""
import os
import re
import sys

import fundflow
import solsrc

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# --- сигнатуры функций, где живут инварианты долей ---
MINT_FN = re.compile(r"deposit|mint|stake|issue|enter|join|addLiquidity|"
                     r"convertToShares|previewDeposit|_?mintShares", re.I)
CONV_FN = re.compile(r"convertTo(?:Shares|Assets)|preview(?:Deposit|Mint|"
                     r"Withdraw|Redeem)|_?sharesToAssets|_?assetsToShares|"
                     r"getPricePerShare|exchangeRate|_?toShares|_?toAssets", re.I)

# --- паттерны в теле ---
SUPPLY_ZERO = re.compile(
    r"\b(totalSupply|totalShares|_?totalSupply|supply|totalAssets)\b\s*(?:\(\s*\))?"
    r"\s*==\s*0", re.I)
# защита от инфляции рядом — ТОЛЬКО инфляция-специфичная (require/revert из окна
# убраны: они в каждой функции и глушили бы настоящий баг). Dead-shares mint,
# минимальная ликвидность, virtual offset (ERC4626 decimalsOffset), сжигание в
# нулевой/dead адрес.
GUARD = re.compile(r"MINIMUM_LIQUIDITY|dead[_ ]?shares|_decimalsOffset|"
                   r"virtualShares|virtualAssets|_mint\s*\(\s*address\(0\)|"
                   r"_mint\s*\(\s*(?:0xdead|DEAD)|burn\s*\(\s*(?:address\(0\)|0)",
                   re.I)
# balanceOf(this) как ФАКТОР КУРСА (умножение/деление рядом), а НЕ liquidity-
# check. `require(balanceOf(this) >= amount)` и `max*` — не донат-уязвимость:
# донат двигает курс только если курс СЧИТАЕТСЯ из баланса. Замерено на
# SparkVault (chi-rate, balanceOf лишь require-ликвидности) — груборый детектор
# давал ложный HIGH.
_BOS = r"[\w.]*balanceOf\s*\(\s*(?:address\s*\(\s*this\s*\)|this)\s*\)"
BALANCE_OF_SELF = re.compile(
    r"(?:[*/]\s*%s)|(?:%s\s*[*/])" % (_BOS, _BOS), re.I)
# сравнение/require с балансом — это ликвидность, не курс: гасит ложняк
BALANCE_CMP = re.compile(r"%s\s*(?:>=|<=|>|<|==)|(?:>=|<=|>|<|==)\s*%s" % (_BOS, _BOS))
# деление в конверсии (грубый маркер округления)
DIVIDE = re.compile(r"[)\w]\s*/\s*[\w(]")
MULDIV = re.compile(r"mulDiv|fullMulDiv|mulDivDown|mulDivUp", re.I)


def _line_of(body, m_start, func_line):
    """Номер строки для совпадения в теле (func_line + смещение по \\n)."""
    return (func_line or 0) + body[:m_start].count("\n")


ROUND_MANAGED = re.compile(r"_?divUp|_?divDown|mulDiv|ceilDiv|roundUp|roundingUp",
                           re.I)


def scan_contract(c):
    """Список находок-инвариантов по контракту: (line, class, severity, why)."""
    out = []
    # контракт осознанно управляет направлением округления где-то -> rounding-
    # вопрос снимаем (иначе шум на каждом делении зрелого vault)
    round_managed = bool(ROUND_MANAGED.search(c.body or ""))
    for f in c.funcs or []:
        body = f.body or ""
        if not body:
            continue
        # 1. инфляция долей: totalSupply==0 в чеканящей функции без защиты рядом
        if MINT_FN.search(f.name or "") or MINT_FN.search(f.header or ""):
            m = SUPPLY_ZERO.search(body)
            if m:
                # окно ±260 символов вокруг ветки — есть ли защита
                w = body[max(0, m.start() - 120): m.start() + 260]
                if not GUARD.search(w):
                    out.append((_line_of(body, m.start(), f.line),
                                "share-inflation", "high",
                                "ветка totalSupply==0 в чеканке долей без "
                                "dead-shares/min-liquidity — первый депозитор "
                                "задаёт курс (%s)" % f.name))
        # 2. донат-инфляция: курс по balanceOf(this)
        nm = (f.name or "").lower()
        if (CONV_FN.search(f.name or "") or "share" in nm or "price" in nm) \
                and not nm.startswith("max"):
            m = BALANCE_OF_SELF.search(body)
            if m:
                out.append((_line_of(body, m.start(), f.line),
                            "donation-inflation", "high",
                            "курс доли СЧИТАЕТСЯ из balanceOf(address(this)) — "
                            "прямой перевод двигает курс (%s)" % f.name))
        # 3. округление: конверсия делением, и ТОЛЬКО если контракт нигде не
        # управляет направлением явно (иначе это осознанный дизайн, не вопрос)
        if CONV_FN.search(f.name or "") and not round_managed:
            if DIVIDE.search(body) and not MULDIV.search(body):
                m = DIVIDE.search(body)
                out.append((_line_of(body, m.start(), f.line),
                            "rounding", "med",
                            "конверсия shares/assets делением без mulDiv — "
                            "проверить направление округления (%s)" % f.name))
    return out


def scan_tree(root, gate=True):
    cons = (solsrc.parse_file(root) if os.path.isfile(root)
            else solsrc.parse_tree(root))
    try:
        import ungated                       # общий фильтр вендора/тестов
        vendor, nonprod = ungated.VENDOR, ungated.NONPROD
    except Exception:
        vendor = nonprod = None
    rows = []
    for c in cons:
        if c.kind == "interface":
            continue
        p = (c.path or "").replace("\\", "/")
        if vendor and (vendor.search(p) or nonprod.search(p)):
            continue                         # lib/vendor/test — не наш скоуп
        if gate:
            try:
                if not fundflow.verdict(c).get("custodial"):
                    continue     # не кастодиан -> инвариантов долей тут нет
            except Exception:
                continue
        rel = solsrc.rel(c.path, root if os.path.isdir(root)
                         else os.path.dirname(root))
        for line, cls, sev, why in scan_contract(c):
            rows.append((rel, line, c.name, cls, sev, why))
    return rows


def main():
    a = sys.argv[1:]
    if not a:
        print(__doc__)
        return
    rows = scan_tree(a[0], gate="--all" not in a)
    print("=" * 78)
    print("ИНВАРИАНТЫ CUSTODIAL-ЯДРА: %d вопросов%s"
          % (len(rows), "" if "--all" in a else " (только кастодианы)"))
    print("=" * 78)
    order = {"high": 0, "med": 1, "low": 2}
    for rel, line, name, cls, sev, why in sorted(rows, key=lambda r: order.get(r[4], 3)):
        print("\n[%s] %s.%s" % (sev.upper(), name, cls))
        print("   %s:%d" % (rel, line))
        print("   %s" % why)
    if not rows:
        print("кастодиан-инвариантов не нашли (или нет кастодианов в дереве)")
    else:
        print("\n" + "-" * 78)
        print("Это ВОПРОСЫ инварианта, не находки: доказать асимметрию "
              "(deposit vs withdraw, курс до/после доната) на форке.")


if __name__ == "__main__":
    main()
