# -*- coding: utf-8 -*-
"""Событийный журнал прогона: одна строка JSON на шаг.

Зачем отдельный формат, когда есть лог. Текстовый лог годится человеку и
негоден машине: из простыни нельзя построить ни таймлайн, ни «какой шаг
сколько шёл», ни связь «сигнал -> файл -> кандидат». Поэтому рядом с
человеческим логом пишется машинный: `data/bounty/<мишень>/runs/<id>.jsonl`,
по строке на событие, дописыванием и со сбросом на диск сразу.

    run_start   что запустили, по какой мишени, чем
    step_start  шаг начался: имя, команда
    step_end    шаг кончился: статус, миллисекунды, сколько строк вывода,
                первые строки, куда лёг полный вывод
    note        замечание по ходу, без начала и конца
    candidate   кандидат в находки: файл, строка, чем смущает
    run_end     итог: сколько шагов, сколько всего времени, статус

Правило формата: событие ДОПИСЫВАЕТСЯ и не переписывается. Прогон, который
упал на середине, должен остаться читаемым ровно до места падения — иначе
наблюдаемость врёт именно тогда, когда нужна.

Читается это всё в UI («Прогоны»), но формат сознательно простой: `jq`,
`Get-Content` и глаз справляются без него.

    import runlog
    r = runlog.Run("alchemix", "scan")
    with r.step("siblings", cmd="siblings.py src/") as s:
        s.done(lines=120, head=["...", "..."], out="signals/siblings.txt")
    r.end()
"""
import contextlib
import datetime as dt
import json
import os
import pathlib
import time

ROOT = pathlib.Path(__file__).resolve().parent
WORK = ROOT / "data" / "bounty"


def _now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def runs_dir(slug):
    d = WORK / (slug or "_all") / "runs"
    d.mkdir(parents=True, exist_ok=True)
    return d


class _Step:
    def __init__(self, run, name):
        self.run = run
        self.name = name
        self.t0 = time.time()
        self._done = False

    def done(self, status="ok", **data):
        if self._done:
            return
        self._done = True
        self.run.emit("step_end", name=self.name, status=status,
                      ms=int((time.time() - self.t0) * 1000), **data)

    def note(self, text, **data):
        self.run.emit("note", name=self.name, text=text, **data)


class Run:
    """Один прогон. Пишет в свой файл и больше никуда."""

    def __init__(self, slug, action, target=None, **meta):
        self.slug = slug or "_all"
        self.action = action
        self.parent = meta.get("parent") or None
        self.root = meta.get("root") or self.parent or None
        # Секунд было недостаточно: два agent по деревьям могли писать в один
        # файл. Микросекунды сохраняют читаемый старый префикс и дают каждому
        # будущему дочернему прогону собственный id.
        self.id = "%s-%s" % (
            dt.datetime.now().strftime("%Y%m%d-%H%M%S-%f"), action)
        self.path = runs_dir(self.slug) / (self.id + ".jsonl")
        self.seq = 0
        self.t0 = time.time()
        self.steps = 0
        self.emit("run_start", action=action, target=target or self.slug,
                  pid=os.getpid(), **meta)

    def emit(self, kind, **data):
        self.seq += 1
        row = {"ts": _now(), "seq": self.seq, "run": self.id,
               "slug": self.slug, "kind": kind}
        row.update(data)
        # Дописывание и немедленный сброс: UI читает файл, пока мы пишем.
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
            f.flush()
        return row

    def model_call(self, model, step=None, **data):
        """Каноническое событие реального обращения к модели."""
        return self.emit("model_call", model=str(model or ""), step=step, **data)

    def verdict(self, ok, **data):
        """Канонический результат детерминированной проверки предложения."""
        return self.emit("verdict", ok=bool(ok), **data)

    def error(self, error, **data):
        """Ошибка как отдельное событие, не только поле завершающей строки."""
        return self.emit("error", error=str(error)[:1000], **data)

    def child(self, action, target=None, **meta):
        """Создать связанный дочерний прогон с тем же slug."""
        meta.setdefault("parent", self.id)
        meta.setdefault("root", self.root or self.id)
        child = Run(self.slug, action, target=target, **meta)
        self.emit("child_run", child=child.id, action=action)
        return child

    @contextlib.contextmanager
    def step(self, name, **data):
        self.steps += 1
        self.emit("step_start", name=name, **data)
        s = _Step(self, name)
        try:
            yield s
        except Exception as e:                      # падение шага — тоже факт
            self.error(e, name=name, scope="step")
            s.done(status="err", error=str(e)[:300])
            raise
        else:
            s.done()

    def candidate(self, file, line=None, why="", weight=None, source=""):
        """Кандидат в находки. НЕ находка: это вопрос к коду, не ответ."""
        self.emit("candidate", file=file, line=line, why=why[:400],
                  weight=weight, source=source)

    def note(self, text, **data):
        self.emit("note", text=text, **data)

    def end(self, status="ok", **data):
        self.emit("run_end", status=status, steps=self.steps,
                  ms=int((time.time() - self.t0) * 1000), **data)


def read(path):
    """Прочитать журнал целиком, пропуская недописанную последнюю строку."""
    out = []
    try:
        for line in pathlib.Path(path).read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except ValueError:
                pass            # файл пишется прямо сейчас — хвост оборван
    except OSError:
        pass
    return out


def listing(limit=50):
    """Все прогоны по всем мишеням, свежие первыми."""
    rows = []
    if not WORK.exists():
        return rows
    for slug_dir in WORK.iterdir():
        d = slug_dir / "runs"
        if not d.is_dir():
            continue
        for f in d.glob("*.jsonl"):
            ev = read(f)
            if not ev:
                continue
            start = next((e for e in ev if e["kind"] == "run_start"), ev[0])
            end = next((e for e in ev if e["kind"] == "run_end"), None)
            rows.append({
                "id": f.stem, "slug": slug_dir.name, "path": str(f),
                "action": start.get("action", ""), "at": start.get("ts", ""),
                "steps": sum(1 for e in ev if e["kind"] == "step_start"),
                "done": sum(1 for e in ev if e["kind"] == "step_end"),
                "candidates": sum(1 for e in ev if e["kind"] == "candidate"),
                "ms": (end or {}).get("ms"),
                "status": (end or {}).get("status") or "идёт",
                "events": len(ev),
            })
    rows.sort(key=lambda r: r["at"], reverse=True)
    return rows[:limit]


if __name__ == "__main__":
    for r in listing():
        print("%-28s %-12s %-6s шагов %2d  кандидатов %2d  %s"
              % (r["id"], r["slug"], r["action"], r["steps"], r["candidates"],
                 r["status"]))


def unexplained_zero(events):
    """Прогон закончился успехом, дал ноль — и НЕ СКАЗАЛ почему.

    Это отдельный класс ошибок, и он дороже остальных: «ноль зацепок»
    читается как «чисто», а означать может «не смотрели». Так вышло дважды.
    На Starknet скан отработал за 7 секунд по недокачанному дереву; на Spark
    прошёл 30 шагов, не запустив ни одного сигнала от дерева. Оба раза код
    возврата был ноль, оба раза UI показывал успех.

    Объяснением считается что угодно из трёх: пометка `incomplete`, заметка
    в ленте или хоть один шаг, честно упавший с ошибкой. Молчание — нет.

    Возвращает True, если объяснения нет. Тогда прогон надо ПОКАЗАТЬ
    иначе, чем удачный: он не «чисто», он «неизвестно».
    """
    # Подготовка зацепок не даёт ПО ОПРЕДЕЛЕНИЮ: она качает исходники.
    # Обвинять её в молчаливом нуле — значит утопить настоящий сигнал в
    # ложных, а предупреждение, которое горит всегда, читать перестают.
    start = next((e for e in events if e.get("kind") == "run_start"), None)
    if str((start or {}).get("action") or "") not in ("scan", "rescan"):
        return False
    end = None
    kinds = set()
    notes = 0
    failed = 0
    cands = 0
    for e in events:
        k = e.get("kind")
        kinds.add(k)
        if k == "run_end":
            end = e
        elif k == "note":
            notes += 1
        elif k == "candidate":
            cands += 1
        elif k == "step_end" and e.get("status") == "err":
            failed += 1
    if end is None or str(end.get("status") or "") != "ok":
        return False                      # идёт, оборван или упал — видно и так
    if cands:
        return False                      # результат есть, объяснять нечего
    if end.get("incomplete") or notes or failed:
        return False                      # ноль объяснён
    return True
