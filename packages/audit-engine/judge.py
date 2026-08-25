# -*- coding: utf-8 -*-
"""МОДЕЛЬНЫЙ ТРИАЖ ВЫЖИВШИХ: то, что механический шлюз не смог убить, судит
модель — и её вердикт течёт в память ([[gatemem]]). Замыкает п.3 на объёме.

Где место в цепочке:

    сигнал -> killcheck (механика) -> ВЫЖИВШИЕ -> judge (модель) -> gatemem

killcheck убивает только доказуемое (гейт в базе/хелпере, self-funded, прокси-
fallback). Остаётся класс «permissionless по замыслу» (governance queue/execute,
delegatecall-адаптеры) — механически не отличить от дыры, тут нужно СУЖДЕНИЕ.
Модель по коду функции решает: LEAD (стоит PoC) или CLEAN (по замыслу, с
причиной). CLEAN уходит в память с source=model и на след. заходе не всплывает.

Против выдумки. Модель здесь НЕ ищет баги (там её тянет сочинять — это работа
agent.py с verify-воротами), а СУДИТ показанный код. Но подстраховка есть: если
модель метит функцию как LEAD с конкретикой, конкретику не проверяем (лид и так
остаётся открытым — вреда нет); а CLEAN — это закрытие, и оно консервативно:
модель просят закрывать ТОЛЬКО при явной причине по-замыслу, иначе оставить LEAD.
Ошибка в сторону LEAD дешева (лишний вопрос), ошибка в CLEAN прячет баг — поэтому
асимметрия та же, что у killcheck.

использование:
    judge.py <slug> [--model heavy|light] [--min 6]
"""
import json
import os
import re
import sys

import callgraph
import fundflow
import gatemem
import llm
import resolveaddr
import scope
import solsrc
import ungated

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ROOT = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(ROOT, "data", "bounty")

SYSTEM = """Ты — старший аудитор смарт-контрактов. Тебе дают функции, которые
СТАТИЧЕСКИЙ шлюз счёл «внешнее властное действие без явного гейта». Часть из них
безопасна ПО ЗАМЫСЛУ (permissionless-вход, авторизация по учёту/состоянию,
вызов через delegatecall из прокси владельца, governance queue/execute с гейтом
по состоянию проголосованного предложения). Часть — настоящая дыра.

По КАЖДОЙ функции верни вердикт:
* "clean" — импакта НЕТ ВООБЩЕ, безопасна по замыслу. Только при явной причине
  из кода: средства/апрувы — самого вызывающего (delegatecall-контекст, from=
  msg.sender), цель вызова — КОНСТАНТА (не параметр), гейт по состоянию/роли.
* "lead" — есть РЕАЛЬНЫЙ импакт, хоть какой. НЕ отсеиваем low/medium: они ценны
  для фарма репутации и иногда стоят денег (класс Coin98). В reason укажи
  severity — "high"/"med"/"low" — и коротко чем именно (что и у кого уводится/
  ломается). Низкий импакт — всё равно "lead" с severity "low", НЕ "clean".

ПРАВИЛО: "clean" — только доказанный НОЛЬ импакта. Есть хоть низкий импакт или
сомнение — "lead" с честной severity. Не выдумывай ни уязвимостей, ни защит,
которых в коде нет. Подсказки CALLGRAPH учитывай, но решай по коду.

Ответь СТРОГО JSON-массивом: [{"key":"Contract.func","verdict":"clean|lead",
"reason":"severity: ..."}]. Без пояснений вокруг."""


def load_survivors(slug, min_w):
    base = os.path.join(WORK, slug, "src")
    if not os.path.isdir(base):
        return []
    out = []
    bypass = {}          # ключ -> вызывающие, что валидируют у себя
    module = set()       # ключи action-модулей (delegatecall-контекст)
    ff = {}              # контракт -> вердикт fund-flow (держит ли средства)
    for name in os.listdir(base):
        tree = os.path.join(base, name)
        if not os.path.isdir(tree):
            continue
        rows_here = ungated.collect(tree, min_w)
        out += rows_here
        # callgraph: механические факты достижимости для модели
        try:
            g = callgraph.build(tree)
            for h in g.bypass():
                bypass[h["key"]] = h["gated_callers"]
            # action-модуль: нет прямого вызывающего + в дереве delegatecall-
            # диспетчер -> исполняется в контексте прокси владельца (by-design)
            if g.has_delegatecall_dispatcher():
                for r in rows_here:
                    if g.no_direct_caller(r["func"]):
                        module.add(r["key"])
        except Exception:
            pass
        # fund-flow: держит ли контракт средства в покое -> определяет ИМПАКТ
        # произвольного вызова/ungated (drain vs красть нечего)
        try:
            for c in solsrc.parse_tree(tree):
                if c.kind != "interface":
                    ff[c.name] = fundflow.verdict(c)
        except Exception:
            pass
    # on-chain-обогащение fund-flow: адрес контракта берём из конфигов репо
    # ([[resolveaddr]]) — снимает ручной ввод. Кэш по контракту: один сетевой
    # запрос на контракт, не на каждого выжившего. Best-effort, сеть не блочит.
    onchain_cache = {}
    survivor_contracts = {r["contract"] for r in out if ff.get(r["contract"])}
    for cname in survivor_contracts:
        loc = resolveaddr.resolve(slug, cname, prefer_chain=1)
        if not loc:
            continue
        chain, addr = loc
        onchain_cache[cname] = fundflow.enrich(ff[cname], chain, addr)
    # уникум по ключу (одноимённые в разных файлах — редко, берём первый)
    seen, uniq = set(), []
    for r in out:
        if r["key"] in seen:
            continue
        seen.add(r["key"])
        r["bypass"] = bypass.get(r["key"])      # None или список вызывающих
        r["module"] = r["key"] in module        # action-модуль (delegatecall)
        # обогащённый вердикт если резолвнули адрес, иначе статика
        r["fundflow"] = onchain_cache.get(r["contract"], ff.get(r["contract"]))
        uniq.append(r)
    return uniq


def _one_batch(model, survivors, key):
    listing = []
    for r in survivors:
        flag = ""
        if r.get("bypass"):
            flag = ("\n⚠ CALLGRAPH: валидация опасного входа стоит в ВЫЗЫВАЮЩЕМ "
                    "(%s), а не в этой public-функции — прямой вызов её обходит. "
                    "Оцени импакт этого обхода." % ", ".join(r["bypass"][:2]))
        elif r.get("module"):
            flag = ("\n• CALLGRAPH: у функции НЕТ прямого вызывающего в дереве, "
                    "а протокол использует delegatecall-диспетчер — вероятно "
                    "action-модуль, исполняемый в контексте прокси владельца "
                    "(средства и апрувы — вызывающего, не чужие). Если так — clean.")
        ff = r.get("fundflow")
        if ff:
            impact = ("КАСТОДИАН держит средства -> произвольный вызов = DRAIN, "
                      "severity ВВЕРХ" if ff["custodial"] else
                      "НЕ кастодиан, в покое пусто -> импакт произвольного вызова "
                      "LOW (красть нечего кроме пыли)")
            flag += "\n• FUND-FLOW: %s (%s). %s" % (ff["kind"], ff["why"][:130], impact)
            # факт из сети, не механический вывод: пусть модель взвесит
            if ff.get("holds_live"):
                flag += ("\n• ON-CHAIN: адрес ДЕРЖИТ баланс ПРЯМО СЕЙЧАС — даже "
                         "если по коду транзит, остаток реально лежит. Если этот "
                         "вход даёт его увести — импакт НЕ low. Оцени размер/токен.")
            elif "holds_live" in ff:
                flag += "\n• ON-CHAIN: адрес пуст сейчас — транзит подтверждён."
        listing.append("### %s  (%s:%d)  действия: %s%s\n```solidity\n%s\n```"
                       % (r["key"], r["file"], r["line"],
                          ", ".join(r["acts"]), flag, r["code"][:800]))
    user = ("Суди эти %d функции. Верни ТОЛЬКО JSON-массив вердиктов, без "
            "рассуждений вокруг.\n\n%s" % (len(survivors), "\n\n".join(listing)))
    msgs = [{"role": "system", "content": SYSTEM},
            {"role": "user", "content": user}]
    # свободный nemotron льёт reasoning перед ответом — даём запас токенов,
    # чтобы JSON не обрезался на середине рассуждения
    for m in llm._chain(model):
        try:
            r = llm._once(m, msgs, key, 0.1, 6000, None, None, tries=2,
                          timeout=180)
            v = _parse((r or {}).get("text") or "")
            if v:
                return v
            sys.stderr.write("  (%s: JSON не распарсен, пробую следующий)\n"
                             % m.split("/")[-1])
        except Exception as e:
            sys.stderr.write("  (%s не ответил: %s)\n" % (m.split("/")[-1], e))
    return {}


def ask_model(model, survivors):
    """Вердикты по всем выжившим. Если партия не распарсилась (nemotron
    обрезал JSON рассуждением), дробим пополам — меньше партия, меньше
    reasoning, целее JSON. Возвращает {key: (verdict, reason)}."""
    key = os.environ.get("OPENROUTER_API_KEY") or llm._key()
    v = _one_batch(model, survivors, key)
    if v or len(survivors) <= 2:
        return v
    mid = len(survivors) // 2
    out = {}
    out.update(_one_batch(model, survivors[:mid], key))
    out.update(_one_batch(model, survivors[mid:], key))
    return out


# Средства тянутся из ВЫЗЫВАЮЩЕГО (его аппрув), не из чужих: обёртка крутит свои.
# Два порядка аргументов: raw ERC20 `transferFrom(FROM, to, amt)` (from=arg1) и
# OZ `SafeERC20.safeTransferFrom(token, FROM, to, amt)` (from=arg2). Плюс частый
# локальный алиас `sender = msg.sender`. Замерено на strata sNUSDSwapAdapter:
# `safeTransferFrom(tokenIn, sender, ...)` проскакивал старый регекс (ждал from
# первым и буквальный msg.sender) -> ложный high на self-funded адаптере.
_FROM = r"(?:msg\s*\.\s*sender|_?sender\b|_?caller\b)"
_SELF_FUNDED = re.compile(
    # from=arg1: raw `transferFrom(FROM,` и using-for `token.safeTransferFrom(FROM,`
    r"(?:safe)?transferFrom\s*\(\s*%s"
    # from=arg2: библиотечный `SafeERC20.safeTransferFrom(token, FROM,`
    r"|safeTransferFrom\s*\(\s*[^,]+,\s*%s" % (_FROM, _FROM),
    re.I)
_SEV = re.compile(r"severity\s*:\s*(high|med(?:ium)?)", re.I)


def _deflate_selffunded(reason, r):
    """Механически понизить severity high/med -> low для SELF-FUNDED ТРАНЗИТА.

    Систематический ложняк модели (замерено на enzyme DepositWrapper.exchange*,
    SharesSplitterLib.redeemShares — все «high/med»): видит «произвольный вызов +
    user-controlled target», НЕ видит, что средства тянутся из msg.sender и
    сметаются обратно — произвольный вызов крутит СВОИ деньги вызывающего, импакт
    ограничен им же (класс takeOrder, уже доказанный dust на форке). Условие:
    fundflow НЕ кастодиан И тело тянет transferFrom(msg.sender). Понижаем ТОЛЬКО
    severity, лид ОСТАЁТСЯ лидом (не прячем баг): вдруг есть путь помимо своих
    средств — пусть остаётся вопросом, но не ложным high в верхушке."""
    ff = r.get("fundflow")
    code = r.get("code") or ""
    if ff and not ff.get("custodial") and _SELF_FUNDED.search(code) and _SEV.search(reason or ""):
        return _SEV.sub(lambda mo: "severity: low (self-funded транзит: импакт "
                        "ограничен вызывающим, понижено с %s)" % mo.group(1),
                        reason)
    return reason


def _parse(text):
    """Вытащить JSON-массив вердиктов из ответа (модель льёт reasoning вокруг)."""
    verdicts = {}
    i, j = text.find("["), text.rfind("]")
    if i < 0 or j < 0 or j < i:
        return verdicts
    try:
        arr = json.loads(text[i:j + 1])
    except Exception:
        return verdicts
    for e in arr if isinstance(arr, list) else []:
        if not isinstance(e, dict):
            continue
        k = e.get("key")
        v = str(e.get("verdict", "")).lower()
        if k and v in ("clean", "lead"):
            verdicts[k] = (v, str(e.get("reason", ""))[:280])
    return verdicts


def main():
    a = sys.argv[1:]
    if not a:
        print(__doc__)
        return
    slug = a[0]
    model = "heavy"
    if "--model" in a:
        model = a[a.index("--model") + 1]
    model = {"heavy": llm.HEAVY, "light": llm.LIGHT,
             "fallback": llm.FALLBACK}.get(model, model)
    # порог СОГЛАСОВАН со сканом (targets.py гонит ungated --min 5): иначе
    # judge триажит верхушку, а низковесные лиды копятся нетриаженными.
    min_w = float(a[a.index("--min") + 1]) if "--min" in a else 5.0

    survivors = load_survivors(slug, min_w)
    # SCOPE-гейт ДО модели: OOS-файл (исключённая папка) — трата бюджета и
    # НЕeligible-дубль при подаче. Закрываем его причиной, к модели не несём.
    man = scope.load(slug)
    m = gatemem.Mem(slug)
    n_oos = 0
    if man:
        keep = []
        for r in survivors:
            ok, why = scope.in_scope(man, r["file"])
            if ok:
                keep.append(r)
            else:
                n_oos += 1
                m.record(r["key"], "clean", "OOS: " + why, "scope")
                print("  OOS   %-46s %s" % (r["key"], why))
        survivors = keep
    print("=" * 78)
    print("ТРИАЖ %s: в скоупе %d (OOS отсеяно %d), судит модель %s"
          % (slug, len(survivors), n_oos, model.split("/")[-1]))
    print("=" * 78)
    if not survivors:
        m.save()
        print("выживших в скоупе нет — судить нечего")
        return

    verdicts = ask_model(model, survivors)
    n_clean = n_lead = n_skip = 0
    for r in survivors:
        vr = verdicts.get(r["key"])
        if not vr:
            n_skip += 1
            print("  ?    %-46s (модель не вернула вердикт — остаётся лидом)"
                  % r["key"])
            m.record(r["key"], "lead", r["note"], "signal")
            continue
        verdict, reason = vr
        if verdict == "clean":
            n_clean += 1
            m.record(r["key"], "clean", reason, "model")
            gatemem.mirror_kill(reason, slug, r["key"])
            print("  CLEAN %-46s %s" % (r["key"], reason[:70]))
        else:
            n_lead += 1
            reason = _deflate_selffunded(reason or r["note"], r)
            m.record(r["key"], "lead", reason, "model")
            print("  LEAD  %-46s %s" % (r["key"], (reason or "")[:70]))
    m.save()
    print("\n" + "-" * 78)
    print("итог: CLEAN(в память) %d, LEAD(открыто) %d, без вердикта %d"
          % (n_clean, n_lead, n_skip))
    print("CLEAN закрыты source=model и на след. заходе ungated их подавит.")
    print("Проверить руками: gatemem.py %s" % slug)


if __name__ == "__main__":
    main()
