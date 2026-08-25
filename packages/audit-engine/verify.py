# -*- coding: utf-8 -*-
"""ПРОВЕРЩИК УТВЕРЖДЕНИЙ: заявленный (файл, символ, строка, цитата) — реален?

Зачем это отдельным, жёстким модулем. Выдуманная находка — не мелкая
неточность, а прямой путь к отказу, бану на площадке и потере комиссии за
заявку (38–50$). Модель-драйвер СКЛОННА сочинять: на TermMax она вписала
`execute(address,bytes)` со строками 210-253, где на деле
`borrowTokenFromCollateral`. Проза модели не может быть источником фактов о
коде — фактом является только то, что подтверждается разбором исходника.

Поэтому каждое утверждение о коде обязано пройти четыре проверки, и все
четыре — механические, БЕЗ участия модели:

    1. ФАЙЛ     существует под корнем мишени (и не вне его);
    2. СИМВОЛ   в этом файле есть функция/модификатор с таким именем;
    3. СТРОКА   заявленная строка попадает в тело этого символа (± допуск);
    4. ЦИТАТА   приведённый кусок кода ДОСЛОВНО присутствует в файле.

Провал любой — утверждение НЕ ПОДТВЕРЖДЕНО. Такое не показывается как
кандидат и тем более не идёт в заявку. Это не «понизить доверие», это
вычеркнуть: выдумка стоит денег.

использование как модуля:
    verify.check(root, file, symbol, line, quote) -> {ok, reasons, ...}
использование из консоли:
    verify.py <корень> <файл> <символ> [строка] [--quote "..."]
"""
import os
import re
import sys

import solsrc

LINE_TOLERANCE = 40         # строка может указывать чуть мимо тела — допускаем


def _norm(s):
    """Сжать пробелы: цитата из чата теряет отступы, но не суть."""
    return " ".join((s or "").split())


def check(root, file, symbol=None, line=None, quote=None):
    """Проверить утверждение о коде. Возвращает словарь с ok и причинами."""
    reasons = []
    res = {"file": file, "symbol": symbol, "line": line,
           "checks": {}, "ok": False, "reasons": reasons}

    # 1. ФАЙЛ под корнем
    rel = (file or "").replace("\\", "/").lstrip("/")
    full = os.path.normpath(os.path.join(root, rel))
    root_n = os.path.normpath(root)
    if not full.startswith(root_n):
        reasons.append("файл вне корня мишени")
        res["checks"]["file"] = False
        return res
    if not os.path.isfile(full):
        reasons.append("файла нет: %s" % rel)
        res["checks"]["file"] = False
        return res
    res["checks"]["file"] = True

    with open(full, "r", encoding="utf-8", errors="replace") as fh:
        src = fh.read()
    src_lines = src.splitlines()

    # 4. ЦИТАТА (проверяем рано — не зависит от разбора)
    if quote:
        flat_src = _norm(src)
        if _norm(quote) in flat_src:
            res["checks"]["quote"] = True
        else:
            res["checks"]["quote"] = False
            reasons.append("цитата НЕ найдена в файле дословно")

    # 2+3. СИМВОЛ и СТРОКА через разбор
    if symbol:
        try:
            contracts = solsrc.parse_file(full, src)
        except Exception as e:
            reasons.append("разбор файла не удался: %s" % e)
            res["checks"]["symbol"] = False
            return res
        found = []
        for c in contracts:
            for f in c.funcs:
                if f.name == symbol:
                    # диапазон тела: от заголовка до конца (грубо по числу
                    # строк тела)
                    body_lines = (f.body or "").count("\n") + 1
                    found.append((f, f.line, f.line + body_lines + 3))
        if not found:
            res["checks"]["symbol"] = False
            reasons.append("символ '%s' не найден как функция в файле" % symbol)
            # подсказка: что там ЕСТЬ рядом по строке
            if line:
                near = _symbol_at_line(contracts, int(line))
                if near:
                    reasons.append("на строке ~%s на деле '%s'" % (line, near))
            return res
        res["checks"]["symbol"] = True

        if line is not None:
            ln = int(line)
            hit = any(a - LINE_TOLERANCE <= ln <= b + LINE_TOLERANCE
                      for _, a, b in found)
            res["checks"]["line"] = hit
            if not hit:
                spans = ", ".join("%d–%d" % (a, b) for _, a, b in found)
                reasons.append("строка %d вне тела '%s' (тело: %s)"
                               % (ln, symbol, spans))
            else:
                # запомним фактическую строку символа — для отчёта
                res["actual_line"] = found[0][1]

    # вердикт: ok, если все ПРОВЕДЁННЫЕ проверки истинны
    res["ok"] = all(res["checks"].values()) and bool(res["checks"])
    return res


# --- сплошная сверка свободного текста -----------------------------------
# Любое упоминание кода в прозе модели — потенциальная выдумка. Находим их и
# помечаем ПРЯМО В ТЕКСТЕ: сверенное — галкой, несверенное — перечёркнуто.

# path/to/File.sol  с необязательными :123 / #L123 / :210-253
_FILE_REF = re.compile(
    r"([A-Za-z_][\w./-]*\.sol)(?:[:#]L?(\d+)(?:\s*[-–]\s*\d+)?)?")

# `symbol` (стр. 520) / symbol() (строки 210-253) / symbol line 520
_SYM_LINE = re.compile(
    r"[`']?([A-Za-z_]\w*)[`']?\s*(?:\(\))?\s*\(?\s*"
    r"(?:стр\.?|строк[а-я]*|line|L)\s*(\d+)", re.I)


def scrub_text(root, text):
    """Проставить в тексте пометки сверки у каждого упоминания кода.

    Возвращает (размеченный_текст, всего, сверено, провалов). Вставки
    считаем по ОРИГИНАЛЬНОМУ тексту и применяем разом справа налево, чтобы
    не съезжали позиции."""
    inserts = []          # (позиция_конца, метка)
    total = ok_n = 0

    # 1) прямые файловые ссылки, при наличии — со строкой
    file_positions = [(m.start(), m.group(1))
                      for m in _FILE_REF.finditer(text)]
    for m in _FILE_REF.finditer(text):
        f, ln = m.group(1), m.group(2)
        res = check(root, f, None, ln, None)
        total += 1
        # для файла без строки достаточно, что файл есть; со строкой —
        # что на ней реально стоит какая-то функция
        good = res["checks"].get("file", False)
        if ln and good:
            try:
                cons = parse_ok(root, f)
                good = _symbol_at_line(cons, int(ln)) is not None
            except Exception:
                good = False
        ok_n += 1 if good else 0
        inserts.append((m.end(), _mark(good, res, ln)))

    # 2) символ + строка (файл берём ближайший .sol в ТОЙ ЖЕ строке, в обе
    # стороны — проза пишет и «File.sol: symbol», и «symbol в File.sol»)
    for m in _SYM_LINE.finditer(text):
        sym, ln = m.group(1), m.group(2)
        if sym.lower() in _STOP:
            continue
        f = _nearest_file(file_positions, m.start(), text)
        if not f:
            continue
        res = check(root, f, sym, ln, None)
        total += 1
        good = res["ok"]
        ok_n += 1 if good else 0
        inserts.append((m.end(), _mark(good, res, ln, sym)))

    for pos, mark in sorted(inserts, key=lambda x: -x[0]):
        text = text[:pos] + mark + text[pos:]
    return text, total, ok_n, total - ok_n


_STOP = {"the", "at", "in", "line", "and", "function", "function"}


def parse_ok(root, file):
    full = os.path.normpath(os.path.join(root, file.replace("\\", "/")))
    return solsrc.parse_file(full)


def _nearest_file(positions, pos, text=None):
    """Ближайший .sol к позиции. Если дан text — сначала ищем в ТОЙ ЖЕ строке
    (в обе стороны, по минимальному расстоянию), иначе ближайший левее."""
    if text is not None:
        ls = text.rfind("\n", 0, pos) + 1
        le = text.find("\n", pos)
        le = len(text) if le < 0 else le
        same = [(abs(p - pos), f) for p, f in positions if ls <= p < le]
        if same:
            return min(same)[1]
    best = None
    for p, f in positions:
        if p <= pos:
            best = f
        else:
            break
    return best


def _mark(good, res, ln=None, sym=None):
    if good:
        return " ⟦✓сверено⟧"
    why = "; ".join(res["reasons"]) or "не подтверждено"
    return " ⟦✗НЕ СВЕРЕНО: %s⟧" % why


def _symbol_at_line(contracts, line):
    """Какая функция реально стоит на заданной строке — для честной подсказки."""
    best = None
    for c in contracts:
        for f in c.funcs:
            span = (f.body or "").count("\n") + 1
            if f.line <= line <= f.line + span + 3:
                if best is None or f.line > best.line:
                    best = f
    return best.name if best else None


def fmt(res):
    tick = {True: "✓", False: "✗", None: "—"}
    parts = []
    for k in ("file", "symbol", "line", "quote"):
        if k in res["checks"]:
            parts.append("%s %s" % (tick[res["checks"][k]], k))
    head = "ПОДТВЕРЖДЕНО" if res["ok"] else "НЕ ПОДТВЕРЖДЕНО"
    out = "%s  [%s]" % (head, "  ".join(parts))
    if res["reasons"]:
        out += "\n   причина: " + "; ".join(res["reasons"])
    return out


def main():
    a = sys.argv[1:]
    if len(a) < 2:
        print(__doc__)
        return
    root, file = a[0], a[1]
    symbol = a[2] if len(a) > 2 and not a[2].startswith("--") else None
    line = a[3] if len(a) > 3 and not a[3].startswith("--") else None
    quote = None
    if "--quote" in a:
        quote = a[a.index("--quote") + 1]
    res = check(root, file, symbol, line, quote)
    print(fmt(res))


if __name__ == "__main__":
    main()
