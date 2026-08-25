# -*- coding: utf-8 -*-
"""ШЛЮЗ «сигнал -> лид»: механически ПОПЫТАТЬСЯ УБИТЬ кандидата, и пропустить
дальше только то, что убить не удалось.

Зачем. Замерено за сессию: сигнал (ungated/msgauth/divergence) — это ВОПРОС,
а не баг. Если скормить сырой сигнал дешёвой модели, она вернёт «лид», и мы
подадим FoT/timelock-мусор за деньги -> отказ, бан, минус комиссия. Лечится не
подсказкой модели, а структурой: между сигналом и лидом стоит шлюз, который
модель обойти не может.

Философия — как у verify.py, но с другой стороны. verify.py доказывает, что
код РЕАЛЕН (файл/символ/строка/цитата). killcheck доказывает, что «дыра»
ОБЪЯСНЯЕТСЯ обыденно (гейт в хелпере, источник связан ниже, impl верифицирован).
Оба работают в одну сторону: НАЙТИ причину закрыть. Не нашли — кандидат выживает
и остаётся вопросом к человеку/PoC, а не выдаётся за находку.

Асимметрия намеренная: KILL срабатывает, только когда МОЖНО ПОКАЗАТЬ гейт.
Не смогли показать -> SURVIVES (не «баг», а «пока не убит»). Отсутствие
доказательства защиты — не доказательство дыры; выживший кандидат идёт к PoC,
а не в заявку.

Главный убийца, общий для ungated/msgauth: РЕЗОЛВЕР ХЕЛПЕРА. gating.Oracle
видит гейт в базовом МОДИФИКАТОРЕ и в теле; чего он не видит — это обычную
internal-функцию `_validate(x)`, вызванную в теле, которая и проверяет sender.
Именно этот ложняк жёг проект всю сессию («гейт в хелпере»). Резолвер идёт по
внутренним вызовам вглубь по контракту и его базам и ищет проверку отправителя.

использование как модуля:
    k = killcheck.Killer(contracts)        # весь разобранный тред мишени
    v = k.judge("ungated", func, contract)  # -> {survives, killed_by, note}
"""
import re

import gating
import solsrc

# ВАЖНО про строгость. Убить кандидата = спрятать его от модели. Ложный CLEAN
# скрывает РЕАЛЬНЫЙ баг — это хуже ложного лида. Поэтому «хелпер — страж» только
# при ПРИНУЖДАЮЩЕМ контексте: require/if/revert по отправителю или вызов-страж.
# Голое упоминание `msg.sender` (чтение, параметр) стражем НЕ считаем — иначе
# любой хелпер, читающий sender, ложно закрыл бы кандидата.
def _enforces(body):
    return bool(gating.GUARD_BODY.search(body or "") or
                gating.GUARD_CALL.search(body or ""))

# Связывание источника для входящего кросс-чейн/подписи: адрес отправителя
# сверяется с доверенным для данного домена. Наличие -> msgauth-кандидат мёртв.
SOURCE_BIND = re.compile(
    r"\b(?:trustedRemote|peers?\s*\[|_?getPeer|isTrustedRemote|"
    r"srcChainId|origin(?:Sender|Caller)|remoteChain|allowedSource|"
    r"authorizedSender|verifySource|_assertPeer|onlyPeer)\b", re.I)

# Защита от реплея — тот же словарь осей, что у msgauth (nonce/used[hash]/...).
_REPLAY = re.compile(
    r"\b(?:nonce|sequence|seq\b|used\w*\s*\[|processed\s*\[|consumed\s*\[|"
    r"inboundHashes|_markConsumed|deadline|expiry|expires|usedNonces)\b", re.I)

# Идентификаторы-вызовы в теле: `_foo(`, `foo(`. Отсекаем ключевые слова.
CALL = re.compile(r"\b([A-Za-z_]\w*)\s*\(")
# Квалифицированный вызов `Lib.foo(` / `Contract.foo(` — резолвим точно в
# by_name[Lib] (Silo делегирует реализацию+гейт в library Actions).
QUALIFIED = re.compile(r"\b([A-Z]\w*)\s*\.\s*([A-Za-z_]\w*)\s*\(")

# Внешние хелперы с ФИКСИРОВАННЫМ гейтом по семантике библиотеки, исходника
# которых в дереве обычно НЕТ (импорт из openzeppelin через remappings, не
# вендорено). grantRole/revokeRole — `onlyRole(getRoleAdmin(role))`; renounce —
# self-only; Ownable-переходы — onlyOwner. Применяем ТОЛЬКО когда имя НЕ
# переопределено в дереве (если переопределено — проверим настоящее тело/мод,
# и вот тогда переопределённая-беззащитная версия честно выживет).
KNOWN_GATED_EXT = {"grantRole", "revokeRole", "renounceRole",
                   "transferOwnership", "renounceOwnership",
                   "_checkRole", "_checkOwner"}
_KW = {"require", "assert", "revert", "if", "for", "while", "return",
       "emit", "new", "abi", "keccak256", "address", "payable", "uint256",
       "bytes", "memory", "storage", "type", "super", "this"}


class Killer(object):
    """Индекс всего треда мишени: функции по контракту+базам, тела хелперов."""

    def __init__(self, contracts):
        self.contracts = contracts
        self.by_name = {}
        for c in contracts:
            self.by_name.setdefault(c.name, c)
        self.oracle = gating.Oracle(contracts)

    # --- разрешение области видимости по наследованию ---------------------
    def _bases(self, contract, seen=None):
        """Контракт и все его базы, что есть в треде (транзитивно)."""
        seen = seen if seen is not None else set()
        if contract.name in seen:
            return []
        seen.add(contract.name)
        out = [contract]
        for b in (contract.bases or []):
            bc = self.by_name.get(b)
            if bc:
                out += self._bases(bc, seen)
        return out

    def _scope_funcs(self, contract):
        """{имя: func} по контракту и базам — где искать хелпер."""
        idx = {}
        for c in self._bases(contract):
            for f in c.funcs:
                idx.setdefault(f.name, f)
        return idx

    # --- убийца №1: гейт спрятан в вызванном хелпере ----------------------
    def helper_guards(self, func, contract, depth=2):
        """Достижимый по внутренним вызовам хелпер проверяет отправителя?

        Возвращает имя хелпера-стража или None. Ходит вглубь до depth. Два вида
        вызовов:
        * НЕквалифицированный `_foo(` — только по функциям контракта и баз (чтобы
          одноимённый страж из чужого контракта не закрыл ложно);
        * КВАЛИФИЦИРОВАННЫЙ `Lib.foo(` — резолвим точно в этой библиотеке/
          контракте по глобальному индексу (Silo делегирует реализацию И ГЕЙТ в
          library Actions; тут одноимённости нет, резолв безопасен).

        Гейт хелпера считаем по `oracle.gated` — он ловит И require в теле, И
        авторизующий МОДИФИКАТОР на хелпере (OZ `grantRole` под `onlyRole`; без
        этого модификаторные гейты пропускались, давая ложный high)."""
        scope = self._scope_funcs(contract)
        seen = set()

        def guarded(callee):
            # библиотечный/базовый хелпер — страж, если сам гейтован (тело ИЛИ
            # модификатор). Это шире прежнего _enforces (тот не видел модификатор).
            return self.oracle.gated(callee) or _enforces(callee.body or "")

        def walk(f, d):
            if d < 0 or f is None:
                return None
            body = f.body or ""
            # 1) квалифицированные `Qualifier.foo(` — резолв в by_name[Qualifier]
            for m in QUALIFIED.finditer(body):
                qual, name = m.group(1), m.group(2)
                if name in _KW:
                    continue
                owner = self.by_name.get(qual)
                callee = self._func_in(owner, name) if owner else None
                if callee is None or ("Q:" + callee.name) in seen:
                    continue
                seen.add("Q:" + callee.name)
                if guarded(callee):
                    return "%s.%s" % (qual, callee.name)
                deeper = walk(callee, d - 1)
                if deeper:
                    return deeper
            # 2) неквалифицированные `_foo(` — по контракту и базам
            for m in CALL.finditer(body):
                name = m.group(1)
                if name in _KW or name == func.name:
                    continue
                callee = scope.get(name)
                if callee is None:
                    # исходника хелпера в дереве нет: доверяем фикс-семантике
                    # известных внешних гейтов (OZ grantRole/onlyOwner-переходы)
                    if name in KNOWN_GATED_EXT:
                        return name
                    continue
                if callee.name in seen:
                    continue
                seen.add(callee.name)
                if guarded(callee):
                    return callee.name
                deeper = walk(callee, d - 1)
                if deeper:
                    return deeper
            return None

        return walk(func, depth)

    @staticmethod
    def _func_in(contract, name):
        if not contract:
            return None
        for f in contract.funcs or []:
            if f.name == name:
                return f
        return None

    # --- вердикты по классам сигналов -------------------------------------
    def judge(self, kind, func, contract):
        """{survives: bool, killed_by: str|None, note: str}. survives=False
        значит кандидата УБИЛИ обыденным объяснением — в лид не идёт."""
        # общий для всех: гейт по оракулу (базовый модификатор / тело)
        why = self.oracle.why_gated(func)
        if why:
            return _dead("гейт: " + why)

        # гейт в вызванном хелпере — главный ложняк проекта
        h = self.helper_guards(func, contract)
        if h:
            return _dead("гейт в хелпере %s() (проверяет отправителя)" % h)

        if kind == "ungated":
            # Ложняк №1 на верхе КАЖДОГО списка (замерено 4×4: compound
            # Unitroller/CErc20Delegator, defi-saver Resolver/EntryPoint,
            # GovernorBravoDelegator): прокси-fallback с delegatecall в impl из
            # слота. Гейт — в РЕАЛИЗАЦИИ, которой в дереве прокси нет. Убить
            # безопасно, ЕСЛИ цель делегата не произвольна: у fallback/receive
            # нет address-параметра -> адрес impl приходит из storage, не извне.
            if _proxy_fallback(func):
                return _dead("прокси-fallback: delegatecall в impl из слота, "
                             "гейт в реализации (её в дереве прокси нет)")
            # САМЫЙ частый ложняк DeFi: `transferFrom(msg.sender, ...)` — это
            # ввод СВОИХ токенов (deposit), а не «перевод чужих средств». Украсть
            # безгейтовой функцией можно, лишь двигая ЧУЖОЙ from; если каждый
            # transferFrom тянет из msg.sender/address(this) и в теле нет иного
            # властного глагола (минт/жёг/апгрейд/роль/произвольный вызов/вывод),
            # то красть нечего. Убить это безопасно — оно не прячет реальный баг.
            if _self_funded(func):
                return _dead("перевод из СВОИХ средств (from=msg.sender/this), "
                             "не чужих — ввод, а не увод")
            return _alive("гейта не видно ни в теле, ни в базе, ни в хелпере")

        if kind == "msgauth":
            body = func.body or ""
            if SOURCE_BIND.search(body):
                return _dead("источник связан в теле (peers/trustedRemote/srcChain)")
            h2 = self._reaches_source_bind(func, contract)
            if h2:
                return _dead("источник связан в хелпере %s()" % h2)
            return _alive("входящее сообщение без видимой сверки источника")

        if kind == "divergence":
            # divergence проверяется в deployed.py/unverified.py (Sourcify+
            # Blockscout). Сюда попадает уже отфильтрованное — просто пропускаем.
            return _alive("impl не найден ни в Sourcify, ни на Blockscout")

        return _alive("класс без спец-проверок")

    def msgauth_recover(self, func, contract, miss):
        """Осевой шлюз для msgauth: вернуть ПОДмножество miss, которое хелперы
        НЕ закрывают. Пусто -> кандидат мёртв (всё связано ниже по вызовам).

        По-осевой намеренно: если источник связан в `_validate(_from)`, гасим
        ТОЛЬКО ось источника, а не всю строку — реплей/вызывающий могут остаться
        дырами. Убить больше, чем доказано, значит спрятать реальный баг."""
        remain = []
        for axis in miss:
            covered = False
            if "источник" in axis:
                covered = bool(self._reaches_source_bind(func, contract))
            elif "вызывающий" in axis:
                covered = (self.oracle.gated(func) or
                           bool(self.helper_guards(func, contract)))
            elif "репл" in axis:
                covered = bool(self._reaches_pattern(func, contract, _REPLAY))
            if not covered:
                remain.append(axis)
        return remain

    def _reaches_pattern(self, func, contract, rx, depth=2):
        scope = self._scope_funcs(contract)
        seen = set()

        def walk(f, d):
            if d < 0 or f is None:
                return None
            for m in CALL.finditer(f.body or ""):
                name = m.group(1)
                if name in _KW:
                    continue
                callee = scope.get(name)
                if callee is None or callee.name in seen:
                    continue
                seen.add(callee.name)
                if rx.search(callee.body or ""):
                    return callee.name
                deeper = walk(callee, d - 1)
                if deeper:
                    return deeper
            return None

        return walk(func, depth)

    def _reaches_source_bind(self, func, contract, depth=2):
        scope = self._scope_funcs(contract)
        seen = set()

        def walk(f, d):
            if d < 0 or f is None:
                return None
            for m in CALL.finditer(f.body or ""):
                name = m.group(1)
                if name in _KW:
                    continue
                callee = scope.get(name)
                if callee is None or callee.name in seen:
                    continue
                seen.add(callee.name)
                if SOURCE_BIND.search(callee.body or ""):
                    return callee.name
                deeper = walk(callee, d - 1)
                if deeper:
                    return deeper
            return None

        return walk(func, depth)


# from-аргумент каждого transferFrom; и «прочие властные глаголы», при которых
# self-funded уже не спасает (мог быть незащищённый mint/вывод рядом).
_TF_FROM = re.compile(r"(?:safeTransferFrom|transferFrom)\s*\(\s*([^,]+),")
_OTHER_POWER = re.compile(
    r"\b(?:_?mint|_?burn|upgradeTo|_authorizeUpgrade|delegatecall|grantRole|"
    r"_grantRole|transferOwnership|setImplementation|sendValue)\b|"
    r"\.\s*call\s*[({]|\bwithdraw\w*\s*\(|"
    r"(?<!From)\b(?:safeTransfer|transfer)\s*\(")     # исходящий перевод наружу


def _proxy_fallback(func):
    """fallback/receive, делегирующий в impl из слота (не в адрес из параметра).

    Произвольный delegatecall в адрес-параметр — это ЗАХВАТ, а не прокси: такое
    оставляем лидом (address в params -> не убиваем)."""
    if (func.name or "").lower() not in ("fallback", "receive"):
        return False
    if "delegatecall" not in (func.body or ""):
        return False
    if re.search(r"\baddress\b", func.params or ""):
        return False           # цель делегата может быть произвольной — не гасим
    return True


def _self_funded(func):
    """Все transferFrom тянут из msg.sender/this И нет иного властного глагола."""
    body = func.body or ""
    froms = _TF_FROM.findall(body)
    if not froms:
        return False
    self_re = re.compile(r"msg\.sender|_msgSender\(\)|address\s*\(\s*this\s*\)")
    if not all(self_re.search(a) for a in froms):
        return False
    return not _OTHER_POWER.search(body)


def _dead(reason):
    return {"survives": False, "killed_by": reason, "note": ""}


def _alive(note):
    return {"survives": True, "killed_by": None, "note": note}
