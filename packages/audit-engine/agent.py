# -*- coding: utf-8 -*-
"""Петля: модель ведёт аудит через function-calling, инструменты — subprocess.

Что это. Первая живая петля проекта. Модель (по умолчанию HEAVY, это работа
суждения) получает описание восьми инструментов как функции, сама решает,
какой запустить, читает вывод, при нужде открывает исходный файл и в конце
выдаёт список кандидатов. Инструменты — это наши Python-скрипты, вызванные
через subprocess; модель НЕ исполняет произвольных команд.

Безопасность петли, по правилам STATE.md:
* корень исходников ЗАФИКСИРОВАН аргументом --root, модель его не выбирает;
* инструменты — белый список; имя вне списка отвергается;
* `read_file` заперт под корнем: `..` и абсолютные пути отбиваются;
* никакой сети, кроме вызова самой модели; deployed/xchain (RPC) в первую
  петлю НЕ включены — они требуют адресов и живой цепи, это отдельный заход;
* только чтение. Ни один инструмент петли ничего не пишет в мишень.

Это НЕ замена человеку на грани подачи: петля сужает поверхность и готовит
список вопросов. Решение «платим за заявку» и PoC — по-прежнему вне её.

использование:
    agent.py --root <корень src> [--model heavy|light|<id>] [--steps 8]
             [--task "<что искать>"]
"""
import json
import os
import subprocess
import sys

import llm
import runlog
import verify

# Журнал прогона. Пишется, только если петлю позвали с --runlog: наблюдение
# не должно быть обязательным условием работы.
LOG = None

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

PY = os.path.join(os.environ.get("LOCALAPPDATA", ""),
                  "Programs", "Python", "Python313", "python.exe")
if not os.path.exists(PY):
    PY = sys.executable
HERE = os.path.dirname(os.path.abspath(__file__))

MAX_OUT = 6000          # обрезка вывода инструмента, чтобы не раздувать контекст


# --- белый список инструментов -------------------------------------------
# Каждый: как собрать argv из аргументов модели. root подставляется здесь,
# модель его не передаёт.

def _t(script, *extra):
    return [PY, os.path.join(HERE, script)] + list(extra)


def cmd_ungated(root, a):
    c = _t("ungated.py", root)
    if a.get("min"):
        c += ["--min", str(a["min"])]
    return c


def cmd_msgauth(root, a):
    c = _t("msgauth.py", root)
    if a.get("all"):
        c += ["--all"]
    return c


def cmd_siblings(root, a):
    c = _t("siblings.py", root)
    if a.get("min"):
        c += ["--min", str(a["min"])]
    if a.get("dir"):
        c += ["--dir"]
    return c


def cmd_statesync(root, a):
    c = _t("statesync.py", root)
    if a.get("support"):
        c += ["--support", str(a["support"])]
    if a.get("early"):
        c += ["--early"]
    return c


# --- RPC-инструменты: конфигурация agglayer зашита, модель её не задаёт ----
# Из broadcast/README.md vault-bridge. vbETH — парный актив L1↔L2.
RPC_L1 = "https://ethereum-rpc.publicnode.com"
RPC_L2 = "https://rpc.katana.network"          # если ляжет — xchain даст «не сравнить», не фантом
VBETH_L1_VB = "0x2DC70fb75b88d2eB4715bc06E1595E6D97c34DFF"   # прод 0.5.0
VBETH_L1_OA = "0x8F45F7ACD4b9FC0B446902790F304d444dfF949b"   # OFT-адаптер L1
VBETH_L2_OA = "0x694d1697F6909361775139357d99fb60b5caB683"   # OFT-адаптер L2 (0.5.1)
MM_L1 = "0x417d01B64Ea30C4E163873f3a1f77b727c689e02"         # MigrationManager


def cmd_deployed(root, a):
    # прод vbETH на Ethereum против ЗЕРКАЛА (исходник vault-bridge): всплывёт
    # разрыв версии (прод 0.5.0, исходник v1.x) и impl вне конфига.
    return _t("deployed.py", "--rpc", RPC_L1, "--src", root,
              VBETH_L1_VB, VBETH_L1_OA, MM_L1)


def cmd_xchain(root, a):
    # рассинхрон OFT-адаптера vbETH между Ethereum и Katana: version/owner/impl
    return _t("xchain.py", "--a", RPC_L1, VBETH_L1_OA,
              "--b", RPC_L2, VBETH_L2_OA)


# RPC-инструменты зашиты под КОНКРЕТНУЮ мишень (agglayer vbETH). На другой
# мишени их адреса чужие и дадут ложь — поэтому они за флагом --rpc и по
# умолчанию ВЫКЛЮЧЕНЫ. Для новой мишени включать только с её адресами.
RPC_TOOLS = {
    "deployed": (cmd_deployed,
                 "ПРОД против ЗЕРКАЛА: читает vbETH на Ethereum по RPC и "
                 "сверяет с исходником — версия, impl вне конфига, файлы "
                 "'в проде есть, в зеркале нет'. Аргументов нет."),
    "xchain": (cmd_xchain,
               "РАССИНХРОН L1↔L2: сверяет OFT-адаптер vbETH между Ethereum "
               "и Katana (version/owner/impl). Аргументов нет."),
}

TOOLS = {
    "ungated": (cmd_ungated,
                "Внешние функции с властным действием и без гейта. "
                "Опц. min (число, вес отсечки, по умолчанию 3)."),
    "msgauth": (cmd_msgauth,
                "Обработчики входящих сообщений/подписей, не связавшие "
                "источник/реплей/отправителя. Опц. all (bool)."),
    "siblings": (cmd_siblings,
                 "Белая ворона: одна реализация из семьи отличается от родни. "
                 "Опц. min (размер семьи), dir (bool, семьи по каталогу)."),
    "statesync": (cmd_statesync,
                  "Забытый спутник: переменные, что пишутся вместе, а тут "
                  "не все. Опц. support (число), early (bool, ранние выходы)."),
}


def active_tools(rpc=False):
    """Белый список под мишень: RPC-инструменты только по флагу (их адреса
    зашиты под agglayer, на чужой мишени врут)."""
    t = dict(TOOLS)
    if rpc:
        t.update(RPC_TOOLS)
    return t


def tool_schemas(rpc=False):
    props = {
        "deployed": {},
        "xchain": {},
        "ungated": {"min": {"type": "number"}},
        "msgauth": {"all": {"type": "boolean"}},
        "siblings": {"min": {"type": "number"}, "dir": {"type": "boolean"}},
        "statesync": {"support": {"type": "number"},
                      "early": {"type": "boolean"}},
    }
    tools = active_tools(rpc)
    schemas = []
    for name, (_, desc) in tools.items():
        schemas.append({
            "type": "function",
            "function": {
                "name": name, "description": desc,
                "parameters": {"type": "object",
                               "properties": props.get(name, {})},
            },
        })
    # чтение файла — чтобы модель могла заглянуть в помеченный код
    schemas.append({
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Прочитать исходный файл под корнем мишени, чтобы "
                           "проверить кандидата. Путь ОТНОСИТЕЛЬНЫЙ от корня.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "start": {"type": "number"},
                    "end": {"type": "number"},
                },
                "required": ["path"],
            },
        },
    })
    # ЕДИНСТВЕННЫЙ способ зарегистрировать кандидата. Проза не считается.
    schemas.append({
        "type": "function",
        "function": {
            "name": "report_candidate",
            "description": "Зарегистрировать выжившего кандидата. Он будет "
                           "МЕХАНИЧЕСКИ сверен с исходником: файл, символ, "
                           "строка и ДОСЛОВНАЯ цитата кода. Не прошедшее "
                           "отклоняется и НЕ попадает в отчёт. Выдумывать "
                           "бессмысленно — проверка поймает.",
            "parameters": {
                "type": "object",
                "properties": {
                    "file": {"type": "string",
                             "description": "путь относительно корня"},
                    "symbol": {"type": "string",
                               "description": "имя функции/модификатора"},
                    "line": {"type": "number"},
                    "quote": {"type": "string",
                              "description": "ДОСЛОВНЫЙ кусок кода из этой "
                                             "функции (проверяется на наличие)"},
                    "suspicion": {"type": "string",
                                  "description": "в чём подозрение"},
                },
                "required": ["file", "symbol", "quote", "suspicion"],
            },
        },
    })
    return schemas


def run_read_file(root, a):
    rel = (a.get("path") or "").replace("\\", "/").lstrip("/")
    full = os.path.normpath(os.path.join(root, rel))
    if not full.startswith(os.path.normpath(root)):
        return "ОТКАЗ: путь вне корня мишени."
    if not os.path.isfile(full):
        return "нет такого файла: %s" % rel
    with open(full, "r", encoding="utf-8", errors="replace") as fh:
        lines = fh.readlines()
    s = int(a.get("start") or 1)
    e = int(a.get("end") or min(len(lines), s + 160))
    s = max(1, s)
    e = min(len(lines), e)
    body = "".join("%4d\t%s" % (i + 1, lines[i]) for i in range(s - 1, e))
    return "%s (строки %d–%d из %d):\n%s" % (rel, s, e, len(lines), body)


_CACHE = {}
_CANDIDATES = []          # подтверждённые кандидаты текущего прогона


def dispatch(root, name, args):
    """Выполнить один tool_call, вернуть текст результата.

    Кеш по (имя, аргументы): модель нередко повторяет один и тот же вызов —
    это лишний subprocess и лишняя латентность. Детерминированные
    инструменты по фиксированному корню кешируются безопасно."""
    key = (name, json.dumps(args, sort_keys=True, ensure_ascii=False))
    if key in _CACHE:
        return _CACHE[key] + "\n[из кеша: повторный вызов]"
    if name == "read_file":
        out = run_read_file(root, args)
        _CACHE[key] = out
        return out
    if name == "report_candidate":
        return _report(root, args)
    reg = {**TOOLS, **RPC_TOOLS}
    if name not in reg:
        return "неизвестный инструмент: %s" % name
    argv = reg[name][0](root, args)
    try:
        p = subprocess.run(argv, capture_output=True, text=True,
                           timeout=180, encoding="utf-8", errors="replace")
    except subprocess.TimeoutExpired:
        return "инструмент %s не уложился в 180с" % name
    out = (p.stdout or "") + (("\n[stderr]\n" + p.stderr) if p.stderr else "")
    if len(out) > MAX_OUT:
        out = out[:MAX_OUT] + "\n... [обрезано]"
    out = out or "(пустой вывод)"
    _CACHE[key] = out
    return out


def _report(root, a):
    """Ворота против выдумки: кандидат принимается ТОЛЬКО если сверился с
    исходником. Не прошедшее возвращается модели с причиной, чтобы она
    исправила или сняла, — но в отчёт оно не попадёт никогда."""
    res = verify.check(root, a.get("file"), a.get("symbol"),
                       a.get("line"), a.get("quote"))
    if LOG:
        # Вердикт ворот — самое ценное событие петли: видно не только что
        # модель предложила, но и что из этого пережило сверку с кодом.
        LOG.verdict(res["ok"], file=a.get("file"), symbol=a.get("symbol"),
                    line=res.get("actual_line", a.get("line")),
                    why=str(a.get("suspicion") or "")[:300],
                    reason=verify.fmt(res).splitlines()[0][:200])
        if res["ok"]:
            LOG.candidate(file=a.get("file"),
                          line=res.get("actual_line", a.get("line")),
                          why=str(a.get("suspicion") or "")[:300],
                          source="agent/verify")
    if res["ok"]:
        _CANDIDATES.append({
            "file": a.get("file"), "symbol": a.get("symbol"),
            "line": res.get("actual_line", a.get("line")),
            "suspicion": a.get("suspicion"), "quote": a.get("quote"),
        })
        return ("ПОДТВЕРЖДЕНО и записан. %s. Кандидатов в отчёте: %d."
                % (verify.fmt(res).splitlines()[0], len(_CANDIDATES)))
    return ("ОТКЛОНЕНО — НЕ записан. %s\nИсправь (верный файл/символ/строка/"
            "дословная цитата) или сними этого кандидата. Выдуманное в отчёт "
            "не пройдёт." % verify.fmt(res))


def compact(messages, keep=3):
    """Свернуть СТАРЫЕ дампы инструментов в заглушку, оставив последние keep.

    Зачем. Каждый ход шлёт всю историю; сырые выводы инструментов раздувают
    запрос — это и медленнее, и ближе к обрыву по контексту/таймауту. Старую
    выжимку модель уже учла в своих ходах, сырой текст ей больше не нужен.
    Свежие keep оставляем целиком: по ним модель ещё рассуждает."""
    tool_idx = [i for i, m in enumerate(messages) if m.get("role") == "tool"]
    for i in tool_idx[:-keep] if len(tool_idx) > keep else []:
        c = messages[i].get("content") or ""
        if not c.startswith("[свёрнуто"):
            n = c.count("\n") + 1
            messages[i]["content"] = ("[свёрнуто: вывод %s, ~%d строк — "
                                      "уже учтён в рассуждении выше]"
                                      % (messages[i].get("name", "?"), n))
    return messages


SYSTEM = """Ты — аудитор смарт-контрактов на баунти. Мишень — кросс-чейн
протокол (мост между Ethereum и L2). Твоя задача: НАЙТИ ПОДОЗРИТЕЛЬНЫЕ МЕСТА,
пользуясь инструментами, а не догадками.

Порядок: ПЕРВЫМИ прогони deployed и xchain — они читают ПРОД по RPC и
показывают разрыв версии прод/зеркало и рассинхрон L1↔L2. Это дешевле всего
и критично: если прод на другой версии, чем исходник, находки в исходнике
могут быть НЕ в проде (частая пустышка проекта). Затем msgauth (это мост!),
ungated, siblings, statesync. Потом ОТКРЫВАЙ read_file по каждому кандидату
и суди, реально ли там дыра или асимметрия оправдана. Большинство находок
инструментов оправданы — твоя ценность в том, чтобы отсеять их и оставить
настоящие. Помни: гейт часто лежит в БАЗОВОМ контракте или во внутреннем
хелпере — проверь наследование, прежде чем звать функцию незащищённой.

Правила: если гейт/проверка есть в хелпере или базе — это НЕ дыра; кандидат
живой только если ты ПРОЧИТАЛ код (read_file) и не нашёл защиты.

РЕГИСТРАЦИЯ КАНДИДАТА — ТОЛЬКО через `report_candidate`. Проза в финале НЕ
считается находкой и никем не читается. Каждый вызов сверяется с исходником:
файл, символ, строка и ДОСЛОВНАЯ цитата кода из этой функции. Не прошедшее
отклоняется — тогда исправь (открой read_file, возьми точные файл/строку/
цитату) или сними кандидата. ВЫДУМЫВАТЬ БЕССМЫСЛЕННО И ВРЕДНО: выдуманная
находка в баунти = отказ, бан и потеря комиссии. Цитату бери КОПИЕЙ из
read_file, не по памяти.

Когда закончил — ответь коротким текстом БЕЗ вызова функций (перечисли, что
зарегистрировал, или честно 'пусто')."""

# Вариант без RPC-инструментов: на новой мишени адреса ещё не заведены, идём
# по статике. Дисциплина «сначала прод» остаётся — но проверку версии делает
# человек отдельно, до подачи.
SYSTEM_NORPC = SYSTEM.replace(
    """Порядок: ПЕРВЫМИ прогони deployed и xchain — они читают ПРОД по RPC и
показывают разрыв версии прод/зеркало и рассинхрон L1↔L2. Это дешевле всего
и критично: если прод на другой версии, чем исходник, находки в исходнике
могут быть НЕ в проде (частая пустышка проекта). Затем msgauth (это мост!),
ungated, siblings, statesync.""",
    """Порядок: прогони инструменты (msgauth — если есть мост/подпись; ungated,
siblings, statesync).""")


def run(root, model, steps, task, rpc=False):
    _CANDIDATES.clear()
    tools = tool_schemas(rpc)
    msgs = [{"role": "system", "content": SYSTEM if rpc else SYSTEM_NORPC}]
    user = "Корень мишени зафиксирован. " + (task or
           "Проведи первичный проход и дай список выживших кандидатов.")
    msgs.append({"role": "user", "content": user})

    print("=" * 78)
    print("ПЕТЛЯ на %s" % root)
    print("модель-драйвер: %s, шагов максимум %d" % (model, steps))
    print("=" * 78)

    for step in range(1, steps + 1):
        # На последнем шаге отбираем инструменты: без них модель ОБЯЗАНА
        # ответить текстом. Так петля всегда завершается выводом, а не
        # обрывается на середине расследования.
        last = step == steps
        if last:
            msgs.append({"role": "user", "content":
                         "Шаги кончились. НЕ вызывай функции. Дай итоговый "
                         "список выживших кандидатов или честное 'пусто'."})
        # сжать старые дампы перед отправкой: меньше запрос — быстрее и
        # устойчивее к обрыву
        compact(msgs, keep=3)
        # llm.ask строит messages из одного prompt; для многоходовки нужен
        # прямой вызов с полной историей — это _turn.
        r = _turn(model, msgs, tools if not last else None)
        if LOG:
            u = (r or {}).get("usage") or {}
            LOG.model_call(
                str((r or {}).get("model") or model).split("/")[-1],
                step=step,
                tier="light" if "lightning" in str(model) else "heavy",
                tokens_in=u.get("prompt_tokens"),
                tokens_out=u.get("completion_tokens"),
                calls=[c["function"]["name"]
                       for c in ((r or {}).get("tool_calls") or [])],
                answered=r is not None)
        if r is None:
            if LOG:
                LOG.error("модель не ответила (включая резерв)",
                          scope="model_call", step=step)
            print("\n[шаг %d] модель не ответила (и резерв тоже). Стоп." % step)
            return

        tcs = r.get("tool_calls")
        content = (r.get("text") or "").strip()

        if not tcs:
            print("\n" + "=" * 78)
            print("ИТОГ модели (%s) — упоминания кода сверены прямо в тексте:"
                  % r["model"].split("/")[-1])
            print("=" * 78)
            scrubbed, tot, okn, bad = verify.scrub_text(root, content or "(пусто)")
            print(scrubbed)
            if tot:
                print("\n[сверка текста: упоминаний %d, сверено %d, НЕ сверено %d]"
                      % (tot, okn, bad))
            _print_candidates(root)
            return

        # промежуточная проза ассистента — тоже сверяем: если модель по ходу
        # ссылается на код, видно сразу, реально ли упоминание
        if content:
            sc, tt, ok2, bad2 = verify.scrub_text(root, content)
            if bad2:
                print("   [текст хода: %d упоминаний НЕ сверено]" % bad2)
        # зафиксировать ход ассистента с вызовами
        msgs.append({"role": "assistant", "content": content or None,
                     "tool_calls": tcs})
        for tc in tcs:
            fn = tc["function"]["name"]
            try:
                args = json.loads(tc["function"].get("arguments") or "{}")
            except Exception:
                args = {}
            print("\n[шаг %d] %s(%s)" % (step, fn, json.dumps(args, ensure_ascii=False)))
            if LOG:
                with LOG.step("%s(%s)" % (fn, json.dumps(args, ensure_ascii=False)[:60]),
                              tool=fn, step_no=step) as _st:
                    result = dispatch(root, fn, args)
                    _st.done(lines=len(result.splitlines()),
                             head=result.strip().splitlines()[:4])
            else:
                result = dispatch(root, fn, args)
            head = result.strip().splitlines()[:4]
            print("   -> " + " / ".join(h.strip() for h in head)[:200])
            msgs.append({"role": "tool", "tool_call_id": tc.get("id", fn),
                         "name": fn, "content": result})

    print("\n[исчерпаны %d шагов без финального ответа]" % steps)
    _print_candidates(root)


def _print_candidates(root):
    print("\n" + "#" * 78)
    if not _CANDIDATES:
        print("ПОДТВЕРЖДЁННЫХ КАНДИДАТОВ: 0 (проза модели в отчёт не идёт)")
        print("#" * 78)
        return
    print("ПОДТВЕРЖДЁННЫЕ КАНДИДАТЫ — %d (каждый сверен с исходником):"
          % len(_CANDIDATES))
    print("#" * 78)
    for i, c in enumerate(_CANDIDATES, 1):
        print("\n%d. %s :: %s  (%s:%s)"
              % (i, c["file"], c["symbol"], c["file"], c["line"]))
        print("   подозрение: %s" % c["suspicion"])
        print("   код: %s" % (c["quote"] or "")[:120])
    print("\nЭто НЕ находки — это подтверждённые ЦЕЛИ ЧТЕНИЯ. Дальше: сверить")
    print("версию в проде, прочитать самому, PoC. Но выдумки среди них нет.")


def _turn(model, messages, tools):
    """Один ход многоходового диалога: шлём ВСЮ историю, ждём ответ/вызовы."""
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        llm._key()
    for m in llm._chain(model):
        try:
            return llm._once(m, messages, key, 0.2, 2200, tools, "auto",
                             tries=3, timeout=180)
        except Exception as e:
            print("   (модель %s не ответила: %s)" % (m.split("/")[-1], e))
    return None


def main():
    a = sys.argv[1:]
    if "--root" not in a:
        print(__doc__)
        return
    root = a[a.index("--root") + 1]
    if not os.path.isdir(root):
        print("нет каталога:", root)
        return
    m = "heavy"
    if "--model" in a:
        m = a[a.index("--model") + 1]
    model = {"heavy": llm.HEAVY, "light": llm.LIGHT,
             "fallback": llm.FALLBACK}.get(m, m)
    steps = int(a[a.index("--steps") + 1]) if "--steps" in a else 8
    task = a[a.index("--task") + 1] if "--task" in a else None
    # --rpc включает deployed/xchain (их адреса зашиты под agglayer vbETH!)
    global LOG
    if "--runlog" in a:
        parent = a[a.index("--parent") + 1] if "--parent" in a else None
        LOG = runlog.Run(a[a.index("--runlog") + 1], "agent",
                         target=os.path.basename(root), model=model,
                         steps=steps, parent=parent)
    try:
        run(root, model, steps, task, rpc="--rpc" in a)
    except BaseException as e:
        if LOG:
            LOG.error(e, scope="run")
            LOG.end(status="err", error=str(e)[:300])
        raise
    if LOG:
        LOG.end(candidates=len(_CANDIDATES))


if __name__ == "__main__":
    main()
