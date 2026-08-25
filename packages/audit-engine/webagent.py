# -*- coding: utf-8 -*-
"""Веб-петля: модель ведёт ПАССИВНЫЙ веб-аудит через function-calling.

Аналог agent.py, но мишень — живой сайт, а не дерево исходников. Инструменты —
блоки webaudit.py (subprocess). Кандидат сверяется НЕ с кодом (его нет), а
ПОВТОРНЫМ ЖИВЫМ ЗАПРОСОМ (webverify.check) — выдумать нельзя.

Безопасность петли (правила STATE.md + методика: только authorized-scope):
* хост ЗАФИКСИРОВАН аргументом --allow, модель его не выбирает и не расширяет;
* только https; payload-подобные URL/параметры отбиваются (маркер ставит
  инструмент, не модель) — никаких <, ', ; и прочего в запросах;
* инструменты — белый список; все только GET/OPTIONS, ничего не меняют;
* никакой эксплуатации: reflection лишь отмечает отражение канарейки;
* сеть только к мишени и к самой модели.

использование:
    webagent.py --allow web.max.ru --base https://web.max.ru/
                [--model heavy|light|<id>] [--steps 8] [--task "..."]
"""
import json
import os
import subprocess
import sys

import llm
import webverify

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
MAX_OUT = 6000

PAYLOAD_RE = webverify.webaudit.PAYLOAD_RE


def _wa(*extra):
    return [PY, os.path.join(HERE, "webaudit.py")] + list(extra)


# --- белый список инструментов. allow добавляется здесь, модель его не задаёт.
def _blocks(allow, base):
    a = []
    for h in allow:
        a += ["--allow", h]

    def cmd_surface(args):
        return _wa("--surface", base, *a)

    def cmd_tls(args):
        return _wa("--tls", base, *a)

    def cmd_methods(args):
        url = args.get("url") or base
        return _wa("--methods", url, *a)

    def cmd_files(args):
        return _wa("--files", base, *a)

    def cmd_check(args):
        url = args.get("url") or base
        c = _wa("--check", url, *a)
        if args.get("param"):
            c += ["--param", str(args["param"])]
        return c

    def cmd_map(args):
        c = [PY, os.path.join(HERE, "webmap.py"), base]
        for h in allow:
            c += ["--allow", h]
        if args.get("max_js"):
            c += ["--max-js", str(args["max_js"])]
        return c

    def cmd_fingerprint(args):
        c = [PY, os.path.join(HERE, "webfinger.py"), base]
        for h in allow:
            c += ["--allow", h]
        return c

    def cmd_cve(args):
        c = [PY, os.path.join(HERE, "webcve.py"), base]
        for h in allow:
            c += ["--allow", h]
        return c

    def cmd_cors(args):
        url = args.get("url") or base
        c = [PY, os.path.join(HERE, "webcors.py"), url]
        for h in allow:
            c += ["--allow", h]
        return c

    return {
        "surface": (cmd_surface,
                    "Security-заголовки (с контекстом severity), cookie-флаги, "
                    "сервер корневой страницы. Аргументов нет."),
        "tls": (cmd_tls,
                "Сертификат: протокол, issuer, срок, SAN, скорый ли конец. "
                "Аргументов нет."),
        "methods": (cmd_methods,
                    "OPTIONS→Allow и опасные методы. Опц. url (в пределах allow)."),
        "files": (cmd_files,
                  "Probe забытых файлов (.git/.env/swagger/metrics/actuator...). "
                  "Настоящий файл, а не SPA-заглушка. Аргументов нет."),
        "check": (cmd_check,
                  "Отражение канарейки: ставит МАРКЕР (не payload) в параметр и "
                  "смотрит, вернулся ли он и в каком контексте (text/attr/script/"
                  "header/url). Опц. url, param."),
        "map": (cmd_map,
                "Карта приложения: краулит базовую страницу и ДОБЫВАЕТ эндпоинты "
                "из JS-бандлов (fetch/axios/пути /api). Даёт скрытые endpoint'ы, "
                "которых нет в браузере — цели для fetch_path/check. Опц. max_js."),
        "fingerprint": (cmd_fingerprint,
                        "Стек мишени: сервер/фреймворк/frontend/CDN/сессии по "
                        "заголовкам, cookie, HTML и путям бандлов. С версиями, "
                        "если видны. CVE тут НЕ выводится (это кандидат). Без арг."),
        "cve": (cmd_cve,
                "CVE-кандидаты через OSV по определённым версиям стека. Нет "
                "версии/маппинга — пропуск (не гадаем); сеть упала — unknown, "
                "не 'чисто'. Каждый CVE — КАНДИДАТ, контекст не проверен. Без арг."),
        "cors": (cmd_cors,
                 "CORS: шлёт маркер-Origin и смотрит, отражает ли сервер его в "
                 "ACAO с credentials (кража приватных ответов). Не эксплуатация. "
                 "Опц. url (лучше по /api из карты)."),
    }


def tool_schemas(blocks):
    props = {
        "surface": {},
        "tls": {},
        "methods": {"url": {"type": "string"}},
        "files": {},
        "check": {"url": {"type": "string"}, "param": {"type": "string"}},
        "map": {"max_js": {"type": "number"}},
        "fingerprint": {},
        "cve": {},
        "cors": {"url": {"type": "string"}},
    }
    schemas = []
    for name, (_, desc) in blocks.items():
        schemas.append({"type": "function", "function": {
            "name": name, "description": desc,
            "parameters": {"type": "object", "properties": props.get(name, {})}}})
    schemas.append({"type": "function", "function": {
        "name": "fetch_path",
        "description": "GET путь в пределах allow-хоста и вернуть статус, "
                       "заголовки и НАЧАЛО тела — чтобы построить карту сайта. "
                       "Только чтение. payload-подобные пути отбиваются.",
        "parameters": {"type": "object", "properties": {
            "path": {"type": "string", "description": "путь от корня, напр. /api/v1/status"}},
            "required": ["path"]}}})
    schemas.append({"type": "function", "function": {
        "name": "report_candidate",
        "description": "Зарегистрировать кандидата. Он будет МЕХАНИЧЕСКИ сверен "
                       "ПОВТОРНЫМ ЖИВЫМ ЗАПРОСОМ к мишени. Не подтверждённое "
                       "отклоняется и в отчёт не идёт. Выдумывать бессмысленно.",
        "parameters": {"type": "object", "properties": {
            "kind": {"type": "string",
                     "enum": list(webverify.KINDS),
                     "description": "тип улики"},
            "url": {"type": "string", "description": "в пределах allow"},
            "header": {"type": "string"},
            "cookie": {"type": "string"},
            "param": {"type": "string"},
            "path": {"type": "string"},
            "method": {"type": "string"},
            "impact": {"type": "string", "description": "в чём риск, коротко"}},
            "required": ["kind", "url", "impact"]}}})
    return schemas


_CACHE = {}
_CANDIDATES = []


def run_fetch_path(allow, base, args):
    path = (args.get("path") or "/").replace("\\", "/")
    if not path.startswith("/"):
        path = "/" + path
    u = webverify.urllib.parse.urlparse(base)
    url = f"{u.scheme}://{u.netloc}{path}"
    try:
        webverify.webaudit.host_ok(url, allow)
    except SystemExit as e:
        return "ОТКАЗ: %s" % e
    if PAYLOAD_RE.search(url):
        return "ОТКАЗ: путь похож на payload — маркер ставит инструмент, не ты."
    try:
        st, hdr, body, cookies = webverify.webaudit.fetch(url)
    except Exception as e:
        return "ошибка запроса: %s" % str(e)[:160]
    head = {k: hdr[k] for k in ("content-type", "server", "location",
                                "content-length") if k in hdr}
    excerpt = webverify.webaudit.re.sub(r"\s+", " ", body[:800])
    return json.dumps({"status": st, "headers": head,
                       "cookies": len(cookies), "body_excerpt": excerpt},
                      ensure_ascii=False)


def dispatch(allow, base, blocks, name, args):
    key = (name, json.dumps(args, sort_keys=True, ensure_ascii=False))
    if key in _CACHE:
        return _CACHE[key] + "\n[из кеша]"
    if name == "fetch_path":
        out = run_fetch_path(allow, base, args)
        _CACHE[key] = out
        return out
    if name == "report_candidate":
        return _report(allow, args)
    if name not in blocks:
        return "неизвестный инструмент: %s" % name
    argv = blocks[name][0](args)
    try:
        p = subprocess.run(argv, capture_output=True, text=True,
                           timeout=120, encoding="utf-8", errors="replace")
    except subprocess.TimeoutExpired:
        return "инструмент %s не уложился" % name
    out = (p.stdout or "") + (("\n[stderr]\n" + p.stderr) if p.stderr else "")
    if len(out) > MAX_OUT:
        out = out[:MAX_OUT] + "\n... [обрезано]"
    out = out or "(пусто)"
    _CACHE[key] = out
    return out


def _report(allow, a):
    kind = a.get("kind")
    res = webverify.check(allow, kind, a)
    if res["ok"]:
        _CANDIDATES.append({"kind": kind, "url": a.get("url"),
                            "impact": a.get("impact"), "detail": res["detail"]})
        return ("ПОДТВЕРЖДЕНО живым запросом и записан. %s. Кандидатов: %d."
                % (res["detail"], len(_CANDIDATES)))
    return ("ОТКЛОНЕНО — НЕ записан. %s\nИсправь улику или сними кандидата. "
            "Перепроверка бьёт по живой мишени — выдуманное не пройдёт."
            % res["detail"])


def compact(messages, keep=3):
    idx = [i for i, m in enumerate(messages) if m.get("role") == "tool"]
    for i in idx[:-keep] if len(idx) > keep else []:
        c = messages[i].get("content") or ""
        if not c.startswith("[свёрнуто"):
            n = c.count("\n") + 1
            messages[i]["content"] = ("[свёрнуто: вывод %s, ~%d строк]"
                                      % (messages[i].get("name", "?"), n))
    return messages


SYSTEM = """Ты — веб-аудитор на authorized-scope баунти. Мишень — живой сайт,
хост зафиксирован (ты его НЕ меняешь и НЕ выходишь за allow). Работа только
ПАССИВНАЯ и marker-only: никакой эксплуатации, никаких payload'ов, никакого
перебора и нагрузки. Маркеры (канарейку) ставит инструмент, не ты.

Порядок: сначала map — построй карту приложения (краул + добыча эндпоинтов
из JS-бандлов; там всплывают /api-пути, которых нет в браузере). Затем
surface (заголовки, cookie), tls, methods — дёшево и показывает конфигурацию.
Потом files (забытые .git/.env/swagger/metrics — инструмент уже отсеивает
SPA-заглушки, доверяй его вердикту). По найденным в карте эндпоинтам ходи
fetch_path и, где есть параметр, check. Где есть
отражаемый параметр — проверь check (это лишь отметка отражения канарейки,
НЕ XSS-эксплуатация).

Оценивай severity по контексту (см. частые пустышки): отсутствие X-Frame-
Options при CSP frame-ancestors — НЕ находка; раскрытие версии сервера без
влияния — почти ничего; scanner-only без подтверждения — не подавай.
Приоритет: утечка секрета/структуры, отражение в опасном контексте, опасные
методы, скорый конец/слабый TLS.

РЕГИСТРАЦИЯ — ТОЛЬКО через report_candidate. Проза в финале не считается.
Каждый кандидат перепроверяется ЖИВЫМ запросом к мишени: если улики нет —
отклонят. ВЫДУМЫВАТЬ БЕССМЫСЛЕННО. Когда закончил — коротко ответь БЕЗ
вызова функций: что зарегистрировал или честно 'пусто'."""


def _turn(model, messages, tools):
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


def run(allow, base, model, steps, task):
    _CANDIDATES.clear()
    blocks = _blocks(allow, base)
    tools = tool_schemas(blocks)
    msgs = [{"role": "system", "content": SYSTEM}]
    msgs.append({"role": "user", "content":
                 "Мишень %s (allow: %s). %s" % (base, ", ".join(allow),
                 task or "Проведи пассивный проход и дай список выживших кандидатов.")})

    print("=" * 78)
    print("ВЕБ-ПЕТЛЯ на %s (allow: %s)" % (base, ", ".join(allow)))
    print("модель-драйвер: %s, шагов максимум %d" % (model, steps))
    print("=" * 78)

    for step in range(1, steps + 1):
        last = step == steps
        if last:
            msgs.append({"role": "user", "content":
                         "Шаги кончились. НЕ вызывай функции. Дай итог: "
                         "выжившие кандидаты или честное 'пусто'."})
        compact(msgs, keep=3)
        r = _turn(model, msgs, tools if not last else None)
        if r is None:
            print("\n[шаг %d] модель не ответила. Стоп." % step)
            return
        tcs = r.get("tool_calls")
        content = (r.get("text") or "").strip()
        if not tcs:
            print("\n" + "=" * 78)
            print("ИТОГ модели (%s):" % r["model"].split("/")[-1])
            print("=" * 78)
            print(content or "(пусто)")
            _print_candidates()
            return
        msgs.append({"role": "assistant", "content": content or None,
                     "tool_calls": tcs})
        for tc in tcs:
            fn = tc["function"]["name"]
            try:
                args = json.loads(tc["function"].get("arguments") or "{}")
            except Exception:
                args = {}
            print("\n[шаг %d] %s(%s)" % (step, fn, json.dumps(args, ensure_ascii=False)[:120]))
            result = dispatch(allow, base, blocks, fn, args)
            head = result.strip().splitlines()[:4]
            print("   -> " + " / ".join(h.strip() for h in head)[:200])
            msgs.append({"role": "tool", "tool_call_id": tc.get("id", fn),
                         "name": fn, "content": result})

    print("\n[исчерпаны %d шагов без финального ответа]" % steps)
    _print_candidates()


def _print_candidates():
    print("\n" + "#" * 78)
    if not _CANDIDATES:
        print("ПОДТВЕРЖДЁННЫХ КАНДИДАТОВ: 0 (проза модели в отчёт не идёт)")
        print("#" * 78)
        return
    print("ПОДТВЕРЖДЁННЫЕ КАНДИДАТЫ — %d (каждый сверен живым запросом):"
          % len(_CANDIDATES))
    print("#" * 78)
    for i, c in enumerate(_CANDIDATES, 1):
        print("\n%d. [%s] %s" % (i, c["kind"], c["url"]))
        print("   риск: %s" % c["impact"])
        print("   улика: %s" % c["detail"])
    print("\nЭто НЕ готовые находки — подтверждённые НАБЛЮДЕНИЯ. Дальше: оценить")
    print("импакт по контексту, собрать отчёт, нести на портал программы.")


def main():
    a = sys.argv[1:]
    if "--allow" not in a or "--base" not in a:
        print(__doc__)
        return
    allow = [a[i + 1] for i, x in enumerate(a) if x == "--allow"]
    base = a[a.index("--base") + 1]
    try:
        webverify.webaudit.host_ok(base, allow)
    except SystemExit as e:
        print("base вне allow:", e)
        return
    m = "heavy"
    if "--model" in a:
        m = a[a.index("--model") + 1]
    model = {"heavy": llm.HEAVY, "light": llm.LIGHT,
             "fallback": llm.FALLBACK}.get(m, m)
    steps = int(a[a.index("--steps") + 1]) if "--steps" in a else 8
    task = a[a.index("--task") + 1] if "--task" in a else None
    out = a[a.index("--out") + 1] if "--out" in a else None
    try:
        run(allow, base, model, steps, task)
    finally:
        if out:
            import datetime
            payload = {"at": datetime.datetime.now(datetime.timezone.utc)
                       .isoformat(timespec="seconds"),
                       "base": base, "allow": allow,
                       "model": str(model).split("/")[-1], "steps": steps,
                       "candidates": _CANDIDATES}
            try:
                with open(out, "w", encoding="utf-8") as fh:
                    json.dump(payload, fh, ensure_ascii=False, indent=1)
                print("\n[дамп кандидатов -> %s]" % out)
            except Exception as e:
                print("\n[не смог записать --out: %s]" % e)


if __name__ == "__main__":
    main()
