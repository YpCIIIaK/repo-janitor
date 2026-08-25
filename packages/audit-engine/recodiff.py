# -*- coding: utf-8 -*-
"""Рекомендации аудиторов, к которым приложен ГОТОВЫЙ КОД.

Зачем. За 11.08.2026 трижды подряд остаток оставила не команда, а САМА
РЕКОМЕНДАЦИЯ:

* agglayer, Certora H-02 — «убрать `nonReentrant` из `receive()`». Убрали
  ровно его; `whenNotPaused` в той же строке остался и позже выстрелил;
* Reserve, Trust Security 3.1.0 — ограничитель в `claimTo()` вставлен
  точь-в-точь по диффу аудитора, вместе с неверным порядком записи
  водяного знака `rewardsClaimed`;
* контрпример: trusted-fillers, TRST-M-1 — команда взяла НЕ облегчённый
  вариант аудитора, а полный EIP-712, и вышло чисто.

Закономерность: когда команда копирует дифф аудитора дословно, этот дифф
уже никто не проверяет — его написал аудитор, значит он верен по
определению. Когда команда решает задачу по-своему, она думает.

Отсюда приём: искать не «Fixed in commit», а «Recommended mitigation» С
КОДОМ, и сверять, скопирован ли код дословно. Если да — читать не заплатку,
а САМ ДИФФ АУДИТОРА, ища то, чего он не покрыл.

ЧЕГО ИНСТРУМЕНТ НЕ ЗНАЕТ. Он не проверяет, что код действительно скопирован,
— это делается глазами по дереву нужного тега. И он не отличает хорошую
рекомендацию от плохой: тир 1 означает лишь «здесь копировали», а не
«здесь ошибка».
"""
import io
import os
import re
import sys

import audits

# Якорь рекомендации. Формулировки у разных фирм свои.
ANCHOR = re.compile(
    r"(?:Recommended\s+mitigation|Recommendation[s]?|Mitigation|"
    r"We\s+recommend|It\s+is\s+recommended|Consider\s+(?:adding|changing|"
    r"using|replacing|implementing))",
    re.I)

# Строка, добавленная диффом: плюс, затем начало объявления или оператора.
PLUS = re.compile(
    r"\+\s*(?:uint\d*|int\d*|address|bool|bytes\d*|string|require|if|"
    r"function|emit|return|mapping|for|while|else|revert|assert|delete|"
    r"try|modifier|constructor)\b")

# Признаки кода вообще, когда дифф не размечен плюсами.
CODEY = re.compile(
    r"(?:require\(|function\s+\w+\(|=\s*\w+\(|\);|\{|\}|"
    r"uint256\s+\w+|address\s+\w+|msg\.sender)")

# ХИРУРГИЧЕСКОЕ УКАЗАНИЕ: названо РОВНО ОДНО имя, и правка сводится к нему.
# Кода тут нет, но копируют такое так же дословно, как дифф, — и с тем же
# исходом. Certora H-02 у agglayer: «Remove `nonReentrant` from `receive()`».
# Убрали ровно `nonReentrant`; соседний `whenNotPaused` в той же строке
# остался и позже выстрелил. Сигнал — именно УЗОСТЬ указания: оно сужает
# взгляд до одного идентификатора из нескольких рядом стоящих.
SURGICAL = [
    ("убрать",   re.compile(
        r"\b(?:Remove|Delete|Drop|Omit)\s+(?:the\s+)?[`'\"]?([A-Za-z_]\w*)"
        r"[`'\"]?(?:\(\))?\s*(?:modifier|function|check|call|flag|line)?\s*"
        r"\bfrom\b\s*(?:the\s+)?[`'\"]?([A-Za-z_]\w*)", re.I)),
    ("добавить", re.compile(
        r"\bAdd\s+(?:a\s+|the\s+)?[`'\"]?([A-Za-z_]\w*)[`'\"]?(?:\(\))?\s*"
        r"(?:modifier|check|guard|require|function)?\s*\bto\b\s*"
        r"(?:the\s+)?[`'\"]?([A-Za-z_]\w*)", re.I)),
    ("заменить", re.compile(
        r"\b(?:Replace|Change)\s+[`'\"]?([A-Za-z_]\w*)[`'\"]?(?:\(\))?\s*"
        r"\b(?:with|to)\b\s*[`'\"]?([A-Za-z_]\w*)", re.I)),
    ("вместо",   re.compile(
        r"\b(?:Use|Call)\s+[`'\"]?([A-Za-z_]\w*)[`'\"]?(?:\(\))?\s*"
        r"\binstead\s+of\b\s*[`'\"]?([A-Za-z_]\w*)", re.I)),
]

FILE_RE = re.compile(r"\b([A-Z][A-Za-z0-9_]{2,})\.sol\b")

WINDOW = 900


def blocks(txt):
    """Куски текста вокруг рекомендаций, с оценкой «сколько там кода»."""
    flat = re.sub(r"\s+", " ", txt)
    for a, b in (("ﬁ", "fi"), ("ﬂ", "fl"), ("ﬀ", "ff"),
                 ("ﬃ", "ffi")):
        flat = flat.replace(a, b)
    out = []
    seen = set()
    for m in ANCHOR.finditer(flat):
        start = m.start()
        # склеиваем близкие якоря, чтобы не выдавать один блок трижды
        if any(abs(start - s) < 300 for s in seen):
            continue
        seen.add(start)
        seg = flat[start:start + WINDOW]
        plus = len(PLUS.findall(seg))
        codey = len(CODEY.findall(seg))

        # Хирургию ищем в НАЧАЛЕ блока: указание идёт сразу за якорем,
        # дальше начинается обсуждение и ложные срабатывания.
        surg = None
        for kind, rx in SURGICAL:
            m2 = rx.search(seg[:260])
            if m2:
                surg = "%s %s → %s" % (kind, m2.group(1), m2.group(2))
                break

        if plus:
            tier = 1.0
        elif surg:
            tier = 1.5
        elif codey >= 4:
            tier = 2.0
        else:
            continue

        # файл: ближайшее имя .sol ДО якоря, иначе внутри блока
        before = flat[max(0, start - 1200):start]
        names = FILE_RE.findall(before) or FILE_RE.findall(seg)
        out.append({
            "tier": tier, "surg": surg,
            "plus": plus, "codey": codey,
            "file": names[-1] + ".sol" if names else "—",
            "text": seg,
        })
    return out


def report_paths(owner, repo):
    d = os.path.join(audits.CACHE, owner, repo)
    if not os.path.isdir(d):
        return []
    return [os.path.join(d, f) for f in sorted(os.listdir(d))
            if f.lower().endswith(audits.DOC_EXT) and not f.startswith("_")]


def run(owner, repo, show=2):
    paths = report_paths(owner, repo)
    if not paths:
        print("%s/%s — отчётов в кеше нет. Сначала: python audits.py --repo %s/%s"
              % (owner, repo, owner, repo))
        return
    found = []
    for p in paths:
        txt = audits.text_of(p)
        if not txt or not txt.strip():
            continue
        for b in blocks(txt):
            b["report"] = os.path.basename(p)
            found.append(b)
    found.sort(key=lambda b: (b["tier"], -b["plus"], -b["codey"]))
    t1 = [b for b in found if b["tier"] == 1.0]
    t15 = [b for b in found if b["tier"] == 1.5]
    print("=" * 78)
    print("%s/%s — отчётов %d, рекомендаций %d (диффов %d, хирургии %d)"
          % (owner, repo, len(paths), len(found), len(t1), len(t15)))
    print("=" * 78)
    for b in found:
        if b["tier"] > show:
            continue
        mark = b["surg"] if b["surg"] else "плюсов %d" % b["plus"]
        print("\n[тир %-3s] %-22s  %-34s %s"
              % (b["tier"], b["report"][:22], mark, b["file"]))
        print("    " + b["text"][:460].strip())
    if t1 or t15:
        print("\n" + "-" * 78)
        if t1:
            print("ТИР 1 — аудитор дал готовый дифф. Читать НЕ заплатку, а сам")
            print("дифф: копировали дословно, и всё, чего дифф не покрыл,")
            print("осталось открытым.")
        if t15:
            print("ТИР 1.5 — хирургическое указание: названо РОВНО ОДНО имя.")
            print("Смотреть, что стоит РЯДОМ с названным: в той же строке, в том")
            print("же списке модификаторов, в соседней ветке. Указание сужает")
            print("взгляд до одного идентификатора — соседи и остаются открытыми.")


def main():
    args = [a for a in sys.argv[1:] if a != "--all"]
    show = 2.0 if "--all" in sys.argv[1:] else 1.5
    if not args:
        print(__doc__)
        print("использование: recodiff.py owner/repo [...]   (--all: и тир 2)")
        return
    for r in args:
        owner, _, repo = r.partition("/")
        if repo:
            run(owner, repo, show)


if __name__ == "__main__":
    main()
