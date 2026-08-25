# -*- coding: utf-8 -*-
"""ПАМЯТЬ ШЛЮЗА: вердикты по кандидатам живут между заходами, петля их помнит.

Зачем (п.3 стороннего ревью). «Скан по находкам» был кнопкой: сигнал -> вывод,
и всё. Цикла не было — на следующем заходе те же FoT/timelock всплывали снова, а
однажды закрытая руками гипотеза возвращалась лидом. Замыкание:

    сигнал -> гипотеза -> ШЛЮЗ(killcheck) -> kill | lead -> ПАМЯТЬ -> следующий заход

Память держит две вещи:

* per-target вердикты в `data/bounty/<slug>/gate_memory.json` — по стабильному
  ключу `Контракт.функция`: `lead` (открытый вопрос, всплывать ДОЛЖЕН) или
  `clean` (закрыт — механически шлюзом ИЛИ руками/моделью с причиной; больше НЕ
  всплывает). Именно clean гасит повтор.
* глобальное зеркало kill-причин в `data/scan_memory.json` в форме, которую
  UI-`learnFromScan` вливает в `scanner_memory` -> `memoryPromptBlock` промпта
  модели. Так один и тот же урок («это шаблон, не повторять») виден и петле, и
  человеку в UI, и модели на следующем ходу.

Асимметрия как у [killcheck]: `clean` ставится, только когда ЕСТЬ причина
(механический kill или явное решение). Отсутствие вопроса лидом не считаем.

использование:
    gatemem.py <slug>                       показать память мишени
    gatemem.py clean <slug> <Контракт.функц> "причина"   закрыть руками
    gatemem.py lead  <slug> <Контракт.функц>             вернуть в открытые
как модуль:
    m = gatemem.Mem(slug); m.verdict("Vault.deposit") -> "clean"|"lead"|None
    m.record("Vault.deposit", "lead"|"clean", reason, source); m.save()
"""
import json
import os
import pathlib
import sys
import datetime as dt

ROOT = pathlib.Path(__file__).resolve().parent
WORK = ROOT / "data" / "bounty"
GLOBAL = ROOT / "data" / "scan_memory.json"

# Шаблоны-тропы: kill-причина этого класса ценна ГЛОБАЛЬНО (любой мишени), а не
# только текущей — её и льём в общий scan_memory, откуда UI кормит модель.
TROPE = ("fee-on-transfer", "fee on transfer", "timelock", "pause", "proxy admin",
         "unbounded loop", "predictable nonce", "reentr")


def _now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


class Mem(object):
    def __init__(self, slug):
        self.slug = slug
        self.path = WORK / slug / "gate_memory.json"
        self.data = {}
        if self.path.exists():
            try:
                self.data = json.loads(self.path.read_text(encoding="utf-8"))
            except Exception:
                self.data = {}

    def verdict(self, key):
        e = self.data.get(key)
        return e.get("verdict") if e else None

    def record(self, key, verdict, reason="", source=""):
        """Поставить вердикт. clean НЕ перетирается механическим lead: если
        закрыто руками/моделью, скан не должен «открыть» это снова."""
        prev = self.data.get(key)
        if prev and prev.get("verdict") == "clean" and verdict == "lead":
            prev["count"] = prev.get("count", 1) + 1
            return
        e = prev or {"key": key, "first": _now(), "count": 0}
        e.update({"verdict": verdict, "reason": reason[:300] or e.get("reason", ""),
                  "source": source or e.get("source", ""),
                  "last": _now(), "count": e.get("count", 0) + 1})
        self.data[key] = e

    def save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.data, ensure_ascii=False, indent=1),
                             encoding="utf-8")

    def leads(self):
        return {k: e for k, e in self.data.items() if e.get("verdict") == "lead"}

    def cleans(self):
        return {k: e for k, e in self.data.items() if e.get("verdict") == "clean"}


def mirror_kill(reason, source_slug, key=""):
    """Дописать kill-причину в общий scan_memory.json (форма для learnFromScan).

    Формат: {"kill": [...], "trope": [...], "gate": []}. UI-importer читает
    массивы kill/trope и кладёт в scanner_memory через remember()."""
    store = {"kill": [], "trope": [], "gate": []}
    if GLOBAL.exists():
        try:
            store = json.loads(GLOBAL.read_text(encoding="utf-8"))
        except Exception:
            pass
    for k in ("kill", "trope", "gate"):
        store.setdefault(k, [])
    low = reason.lower()
    bucket = "trope" if any(t in low for t in TROPE) else "kill"
    tag = ("%s — %s" % (key, reason)) if key else reason
    if tag not in store[bucket]:
        store[bucket].append(tag)
    GLOBAL.parent.mkdir(parents=True, exist_ok=True)
    GLOBAL.write_text(json.dumps(store, ensure_ascii=False, indent=1),
                      encoding="utf-8")


def apply_gate(slug, rows):
    """Прогнать список сырых строк сигнала через память. Каждая row — dict с
    ключами 'key' (Контракт.функция), 'survives' (bool шлюза), 'reason' (killed_by).

    Возвращает (leads, killed_by_gate, suppressed_by_memory) и обновляет память:
    * шлюз убил -> clean(механически) + зеркало kill;
    * шлюз пропустил, НО память уже clean (руки/модель) -> подавлено;
    * иначе -> lead (открытый вопрос).
    Это и есть ребро «kill|lead -> память -> следующий заход»."""
    m = Mem(slug)
    leads, killed, suppressed = [], [], []
    for r in rows:
        key = r["key"]
        if not r.get("survives"):
            m.record(key, "clean", r.get("reason", "гейт"), "killcheck")
            mirror_kill(r.get("reason", "гейт"), slug, key)
            killed.append(r)
        elif m.verdict(key) == "clean":
            suppressed.append({**r, "reason": m.data[key].get("reason", "закрыто ранее")})
        else:
            m.record(key, "lead", r.get("why", ""), r.get("source", "signal"))
            leads.append(r)
    m.save()
    return leads, killed, suppressed


def main():
    a = sys.argv[1:]
    if not a:
        print(__doc__)
        return
    if a[0] in ("clean", "lead") and len(a) >= 3:
        verdict, slug, key = a[0], a[1], a[2]
        reason = a[3] if len(a) > 3 else ("закрыто вручную" if verdict == "clean" else "")
        m = Mem(slug)
        m.record(key, verdict, reason, "manual")
        m.save()
        if verdict == "clean":
            mirror_kill(reason, slug, key)
        print("%s: %s -> %s%s" % (slug, key, verdict,
                                  (" (%s)" % reason) if reason else ""))
        return
    slug = a[0]
    m = Mem(slug)
    cl, ld = m.cleans(), m.leads()
    print("== память шлюза по %s: закрыто %d, открытых лидов %d"
          % (slug, len(cl), len(ld)))
    if cl:
        print("\nЗАКРЫТО (не всплывёт снова):")
        for k, e in sorted(cl.items()):
            print("  %-44s %s  [%s]" % (k, e.get("reason", "")[:40], e.get("source", "")))
    if ld:
        print("\nОТКРЫТЫЕ ЛИДЫ (всплывают до PoC/закрытия):")
        for k, e in sorted(ld.items()):
            print("  %-44s x%d" % (k, e.get("count", 1)))


if __name__ == "__main__":
    main()
