# -*- coding: utf-8 -*-
"""БЕЗ ГЕЙТА: внешнее действие с деньгами или властью и без единой проверки.

Зачем. Пропущенный контроль доступа — класс уязвимостей номер один по
выплаченным деньгам (OWASP SC01:2026, суммарно счёт идёт на сотни
миллионов). И это ровно тот класс, который берётся ПО СТРУКТУРЕ, без
понимания смысла: внешняя функция делает властное действие (переводит
токен, минтит, жжёт, ставит роль, апгрейдит, дёргает произвольный вызов),
а в её заголовке и теле нет ни модификатора-разрешения, ни require по
msg.sender. Всё нужное для приговора лежит в одной сигнатуре.

Отличие от siblings.py. Там сигнал — «у брата гейт есть, а тут нет», то есть
нужна семья. Здесь семьи не нужно: функция подозрительна САМА ПО СЕБЕ,
одиноко стоящая. Два инструмента ловят разные половины: siblings — снятый
из ряда гейт, ungated — не поставленный вовсе.

Как считается сила. Действие даёт вес (перевод чужих средств > минт/жёг >
запись роли > произвольный вызов > запись состояния). Отсутствие ЛЮБОГО
гейта — обязательное условие, иначе строка не выводится. `view`/`pure`
отбрасываются: читать не властно. Конструкторы и `initializer` тоже (их
защищает одноразовость, если она есть, — это отдельная проверка).

ЧЕГО ИНСТРУМЕНТ НЕ ЗНАЕТ. Гейт может прятаться в вызванной внутренней
функции (`_checkOwner()` без слова only) или в библиотеке. Поэтому вывод —
это НЕ находки, а список «объясни, что защищает эту функцию». Пустой ответ
и есть дыра. Ложные срабатывания ожидаемы там, где защита вынесена в хелпер;
они закрываются одним переходом к телу хелпера.

использование:
    ungated.py <корень> [--min 3] [--file X.sol]
"""
import os
import re
import sys

import gating
import gatemem
import killcheck
import solsrc

# Властные действия и их вес. Перевод ЧУЖИХ средств (transferFrom, где
# отправитель не сам контракт) — тяжелее всего.
ACTIONS = [
    (9.0, "апгрейд/делегат",
     re.compile(r"\b(?:upgradeTo|_authorizeUpgrade|delegatecall|"
                r"setImplementation)\b")),
    (8.5, "произвольный внешний вызов",
     re.compile(r"\.\s*call\s*\{?|\.\s*call\s*\(|functionCall\s*\(")),
    (8.0, "выдача роли/владельца",
     re.compile(r"\b(?:grantRole|_grantRole|setRole|transferOwnership|"
                r"_setupRole|setOwner|setAdmin|addManager|setPending)\b")),
    (7.5, "перевод чужих средств",
     re.compile(r"\b(?:safeTransferFrom|transferFrom)\s*\(")),
    (7.0, "минт/жёг",
     re.compile(r"\b(?:_mint|mint|_burn|burn)\s*\(")),
    (6.5, "вывод средств",
     re.compile(r"\b(?:safeTransfer|transfer|sendValue|withdraw)\s*\(")),
    (5.5, "смена критичной настройки",
     re.compile(r"\b(?:setFee|setOracle|setPrice|setConfig|setParam|"
                r"setTreasury|setGateway|setVault|setToken|setAddress|"
                r"whitelist|setPeer|setEndpoint|setConnector)\b", re.I)),
    (4.0, "запись состояния",
     re.compile(r"^\s*[A-Za-z_]\w*(?:\[[^\]]*\])*\s*(?:=(?!=)|\+=|-=)", re.M)),
]

# Признаки гейта в заголовке или теле. Наличие ЛЮБОГО снимает подозрение.
GATE_MOD = re.compile(
    r"\b(?:only\w+|auth|authorized|restricted|nonReentrant|whenNotPaused|"
    r"whenPaused|onlyOwner|onlyRole|onlyAdmin|onlyGov|onlyManager|"
    r"requiresAuth|protected|gated|hasRole)\b", re.I)

# require/if по отправителю или роли прямо в теле.
GATE_BODY = re.compile(
    r"(?:require|if)\s*\([^;]*\b(?:msg\.sender|_msgSender\(\)|tx\.origin|"
    r"hasRole|owner\(\)|isOwner|isAuthorized|_checkRole|checkRole|"
    r"onlyRole|authority)\b", re.I)

# Голый вызов-страж без require/if: `_checkRole(...)`, `_checkOwner()`,
# `_requireAuth()`. В проде infiniFi именно так защищён grantRoles.
GATE_CALL = re.compile(
    r"\b(?:_?checkRole|_?checkOwner|_?checkAuth\w*|_?require(?:Auth|Owner|"
    r"Role|Admin|Governor)\w*|_?onlyRole|_?authorize\w*|_?validateAuth)\s*\(",
    re.I)

# Внутренний вызов, который МОЖЕТ содержать гейт — снижаем уверенность, но
# не снимаем: помечаем «возможно, гейт в хелпере».
CALLS_HELPER = re.compile(r"\b(_[a-z]\w*|_check\w*|_only\w*|_require\w*)\s*\(")

READONLY = re.compile(r"\b(?:view|pure)\b")
VIS = re.compile(r"\b(public|external|internal|private)\b")

# Чужой код: библиотеки не наша поверхность, они аудированы отдельно и лишь
# топят вывод. Отсекаем ПО ПУТИ, как в deployed.py и forkdiff.py.
VENDOR = re.compile(
    r"(?:^|/)(?:lib|node_modules|@[\w-]+|forge-std|solmate|solady|"
    r"openzeppelin[\w-]*|layerzero[\w-]*)/", re.I)

# НЕ БОЕВОЙ КОД. Демонстрации, тесты, моки и примеры никуда не задеплоены и
# ни в один скоуп не входят: незащищённая функция там — норма жанра, а не
# дефект. Повод: `AmmDemo.updateState` из `cairo-lang/src/demo/amm_demo`
# всплыл лидом на Starknet и стоил внимания на пустом месте.
# Тест-гнёзда без слова test в пути тоже не боевые: certora/spec-харнесс,
# копии чужих систем под верификацию (mcd — MakerDAO в spec Compound),
# `test-sol/utils` DeFi Saver. Модель их ловит по коду (Foundry cheats), но
# фильтром дешевле, чем токенами модели.
NONPROD = re.compile(
    r"(?:^|/)(?:demo|demos|test|tests|test-sol|mock|mocks|example|examples|"
    r"sample|samples|fixtures?|scripts?|spec|certora|mcd|harness)/", re.I)

# ГЕЙТ ЗА ДЕЛЕГАТОМ К СЕБЕ. `address(this).delegatecall(abi.encodeWithSignature(
# "addImplementation(...)"))` — обёртка, у которой своего модификатора нет
# по замыслу: проверку делает вызываемая функция ПРОКСИ, а `delegatecall`
# сохраняет msg.sender, поэтому гейт срабатывает на исходном вызывающем.
# Кода прокси в дереве обычно НЕТ, и инструмент честно «не видит гейта» —
# но именно поэтому такие строки нельзя показывать весом 9.0.
# Встречается у StarkWare (ProxySupport.safeAddImplementation), в семействе
# OpenZeppelin и вообще везде, где есть прокси.
SELF_DELEGATE = re.compile(
    r"address\s*\(\s*this\s*\)\s*\.\s*delegatecall|"
    r"\bthis\s*\.\s*delegatecall", re.I)


# Стандартные сигнатуры ERC20/ERC4626/ERC721: их `from`/`transfer` — не
# властное действие над ЧУЖИМИ деньгами, а обычный токен-интерфейс, где
# аллованс и есть авторизация. Инструмент на них спотыкался (agglayer,
# TermMax). Подавляем по точному имени.
# ТОЛЬКО те, где авторизацией служит сам allowance ERC20. НЕ включать
# mint/burn/deposit/withdraw/redeem: незащищённый mint токена — находка №1,
# а имя у него то же, что у безобидного ERC4626. По имени их не подавлять.
ERC_STD = {
    "transfer", "transferFrom", "approve", "increaseAllowance",
    "decreaseAllowance", "permit", "safeTransferFrom", "safeTransfer",
}


def gated(f, oracle=None):
    """Есть ли у функции гейт. С oracle учитываются базовые модификаторы."""
    if oracle is not None:
        return oracle.why_gated(f)
    if any(GATE_MOD.search(m) for m in f.mods):
        return "модификатор"
    if GATE_BODY.search(f.body or ""):
        return "require по отправителю"
    if GATE_CALL.search(f.body or ""):
        return "вызов-страж"
    return None


def is_open(f):
    """Внешне вызываемая, не view, не конструктор/инициализатор.

    Видимость берём из СЫРОГО заголовка: solsrc._mods намеренно выкидывает
    видимость из списка модификаторов (это верно для siblings), поэтому по
    f.mods отличить internal от public нельзя."""
    if f.kind == "constructor":
        return False
    if "initializer" in f.mods or f.name in ("initialize", "init", "__init"):
        return False
    header = f.header or ""
    if READONLY.search(header):
        return False
    m = VIS.search(header)
    vis = m.group(1) if m else "public"     # без явной видимости — public
    return vis in ("public", "external")


def actions_of(f):
    body = f.body or ""
    out = []
    for w, label, rx in ACTIONS:
        if rx.search(body):
            out.append((w, label))
    return out


def demote_reason(c, f):
    """Почему функция не может быть самостоятельной находкой. "" = может.

    Два случая, и оба про то, что ГЕЙТ ЖИВЁТ НЕ ЗДЕСЬ.

    library. Функция библиотеки исполняется в контексте того, кто её
    подключил: Aave объявляет `executeBorrow` в `BorrowLogic` как external,
    а гейт стоит в `Pool.sol`, который её делегирует. Прямой вызов такой
    функции трогает хранилище самой библиотеки, а не пула, — то есть не
    делает ничего. Замерено на Spark: 33 «зацепки» из 38 были ровно этим.

    delegatecall к себе. Обёртка над прокси: гейт в контракте прокси,
    которого в дереве нет.

    Ни то, ни другое не убиваем совсем — прокси бывает и без гейта, а
    библиотеку изредка вызывают напрямую. Но верх списка они занимать не
    должны: список читают сверху и до усталости.
    """
    if getattr(c, "kind", "") == "library":
        return "функция библиотеки — гейт у того, кто её делегирует"
    if SELF_DELEGATE.search(f.body or ""):
        return "обёртка над delegatecall к себе — гейт в прокси, его тут нет"
    return ""


def collect(root, min_w=3.0):
    """Выжившие после шлюза как список dict — для judge.py (модельный триаж).
    Без печати, без памяти. {key,file,line,contract,func,acts,note}."""
    if os.path.isfile(root):
        cons = solsrc.parse_file(root)
        root = os.path.dirname(root)
    else:
        cons = solsrc.parse_tree(root)
    oracle = gating.Oracle(cons)
    killer = killcheck.Killer(cons)
    out = []
    for c in cons:
        path = c.path.replace("\\", "/")
        if c.kind == "interface" or VENDOR.search(path) or NONPROD.search(path):
            continue
        for f in c.funcs:
            if f.kind == "modifier" or not is_open(f) or f.name in ERC_STD:
                continue
            if gated(f, oracle):
                continue
            acts = actions_of(f)
            if not acts or max(a[0] for a in acts) < min_w:
                continue
            # Понижённые не отдаём модели: платить за суждение по функции,
            # у которой гейт заведомо в другом файле, — тратить тяжёлый тир
            # на заведомо пустое.
            if demote_reason(c, f):
                continue
            v = killer.judge("ungated", f, c)
            if not v["survives"]:
                continue
            code = ((f.header or "") + "\n" + (f.body or "")).strip()
            out.append({"key": "%s.%s" % (c.name, f.name),
                        "file": solsrc.rel(f.path, root), "line": f.line,
                        "contract": c.name, "func": f.name,
                        "acts": [a[1] for a in acts], "note": v["note"],
                        "bases": list(c.bases or []),
                        "code": code[:1400], "w": max(a[0] for a in acts)})
    out.sort(key=lambda r: -r["w"])
    return out


def run(root, min_w=3.0, only=None, show_all=False, slug=None):
    if os.path.isfile(root):
        cons = solsrc.parse_file(root)
        root = os.path.dirname(root)
    else:
        cons = solsrc.parse_tree(root)
    if only:
        cons = [c for c in cons if os.path.basename(c.path) == only]

    # оракул гейтинга по ВСЕМУ дереву — чтобы видеть модификаторы из баз
    oracle = gating.Oracle(cons)
    # шлюз «сигнал -> лид»: попытается убить кандидата гейтом в хелпере и т.п.
    killer = killcheck.Killer(cons)

    rows, demoted = [], []
    skipped_nonprod = 0
    for c in cons:
        path = c.path.replace("\\", "/")
        if c.kind == "interface" or VENDOR.search(path):
            continue
        if NONPROD.search(path):
            skipped_nonprod += 1
            continue
        for f in c.funcs:
            if f.kind == "modifier" or not is_open(f):
                continue
            if f.name in ERC_STD:          # стандартный токен-интерфейс
                continue
            if gated(f, oracle):
                continue
            acts = actions_of(f)
            if not acts:
                continue
            w = max(a[0] for a in acts)
            if w < min_w:
                continue
            helper = bool(CALLS_HELPER.search(f.body or ""))
            # Гейт живёт не здесь: библиотека или обёртка над прокси.
            # Роняем вес до самого низа, но не убиваем — см. demote_reason.
            why = demote_reason(c, f)
            if why:
                w = min(w, 2.0)
            v = killer.judge("ungated", f, c)      # ШЛЮЗ
            row = {"w": w, "c": c, "f": f, "acts": acts,
                   "helper": helper, "proxy": bool(why), "why": why, "v": v}
            # Понижённые ниже порога не идут в лиды, но и не пропадают
            # молча: их считаем и показываем строкой — иначе назавтра
            # никто не вспомнит, почему инструмент промолчал.
            (demoted if w < min_w else rows).append(row)

    rows.sort(key=lambda r: -r["w"])
    survived = [r for r in rows if r["v"]["survives"]]
    killed = [r for r in rows if not r["v"]["survives"]]

    # ПАМЯТЬ ШЛЮЗА (п.3): при --slug вердикты текут в память мишени, а
    # закрытое ранее (руками/моделью) подавляется на этом заходе. Это ребро
    # «kill|lead -> память -> следующий заход».
    suppressed = []
    if slug:
        def _key(r):
            return "%s.%s" % (r["c"].name, r["f"].name)
        gm_rows = ([{"key": _key(r), "survives": True,
                     "why": r["v"]["note"]} for r in survived] +
                   [{"key": _key(r), "survives": False,
                     "reason": r["v"]["killed_by"]} for r in killed])
        leads_keys, _k, supp = gatemem.apply_gate(slug, gm_rows)
        supp_keys = {s["key"] for s in supp}
        suppressed = [r for r in survived if _key(r) in supp_keys]
        survived = [r for r in survived if _key(r) not in supp_keys]

    print("=" * 78)
    print("контрактов %d, сырых кандидатов %d -> шлюз убил %d, выжило %d (лиды)"
          % (len(cons), len(rows), len(killed), len(survived)))
    if suppressed:
        print("подавлено памятью (закрыто ранее руками/моделью): %d"
              % len(suppressed))
    if skipped_nonprod:
        print("пропущено файлов вне прода (demo/test/mock/example): %d"
              % skipped_nonprod)
    print("=" * 78)
    for r in survived:
        f = r["f"]
        acts = ", ".join(dict.fromkeys(a[1] for a in r["acts"]))
        print("\n[%.1f] %s.%s(%s)"
              % (r["w"], r["c"].name, f.name,
                 (f.params or "").strip()[:40]))
        print("      действие: %s" % acts)
        print("      %s:%d   модификаторы: %s"
              % (solsrc.rel(f.path, root), f.line,
                 " ".join(f.mods) or "(нет)"))
        print("      шлюз: %s" % r["v"]["note"])
        if r["helper"]:
            print("      ! зовёт внутренний хелпер, но страж в нём НЕ найден —")
            print("        всё равно проверить тело хелпера глазами")

    if demoted:
        print("\n" + "·" * 78)
        print("ПОНИЖЕНО — гейт живёт не в этом файле (%d):" % len(demoted))
        by = {}
        for r in demoted:
            by.setdefault(r.get("why") or "прочее", []).append(r)
        for why, rows_ in sorted(by.items(), key=lambda kv: -len(kv[1])):
            print("\n  %s — %d:" % (why, len(rows_)))
            for r in rows_[:12]:
                print("     %s.%s — %s:%d"
                      % (r["c"].name, r["f"].name,
                         solsrc.rel(r["f"].path, root), r["f"].line))
            if len(rows_) > 12:
                print("     ... и ещё %d" % (len(rows_) - 12))
        print("\nПроверять их надо там, где стоит гейт: в контракте, который")
        print("подключает библиотеку, или в прокси по адресу из скоупа.")

    if suppressed and show_all:
        print("\n" + "·" * 78)
        print("ПОДАВЛЕНО ПАМЯТЬЮ (закрыто на прошлых заходах, не всплывает):")
        for r in suppressed:
            print("  %s.%s" % (r["c"].name, r["f"].name))

    if killed and show_all:
        print("\n" + "·" * 78)
        print("УБИТО ШЛЮЗОМ (обыденное объяснение найдено, в лид не идут):")
        for r in killed:
            f = r["f"]
            print("  [%.1f] %s.%s — %s"
                  % (r["w"], r["c"].name, f.name, r["v"]["killed_by"]))
    elif killed:
        print("\n(убито шлюзом: %d; показать с --all)" % len(killed))

    print("\n" + "-" * 78)
    print("Выжившие — это ЛИДЫ (вопрос к строке: кто угодно может это дёрнуть?),")
    print("а не находки: следующий шаг PoC, не заявка. Убитые шлюз закрыл сам —")
    print("гейт в базе/хелпере/теле; их модель уже не увидит и не раздует.")


def main():
    a = sys.argv[1:]
    if not a:
        print(__doc__)
        return
    min_w = float(a[a.index("--min") + 1]) if "--min" in a else 3.0
    only = a[a.index("--file") + 1] if "--file" in a else None
    slug = a[a.index("--slug") + 1] if "--slug" in a else None
    run(a[0], min_w, only, show_all="--all" in a, slug=slug)


if __name__ == "__main__":
    main()
