# -*- coding: utf-8 -*-
"""Мелкий разбор Solidity: контракты, функции, переменные состояния.

Зачем свой разбор, а не slither. Slither требует компиляции: нужны версия
компилятора, remappings, зависимости. Наши мишени — это распакованный
tar.gz на закреплённой ревизии, и половина из них не соберётся без возни.
Инструменты этого проекта должны запускаться по дереву файлов ЗА СЕКУНДЫ,
иначе ими не пользуются.

Что теряем честно: наследование раскрывается только по именам баз, дерево
вызовов не строится, `assembly` не разбирается. Всё, что здесь есть, — это
границы блоков по скобкам и заголовки. Этого хватает сигналам, которым
нужны не значения, а СРАВНЕНИЕ соседей между собой.
"""
import os
import re

# --- срезание комментариев и строковых литералов -------------------------
# Позиции сохраняются: вырезанное заменяется пробелами, поэтому смещения и
# номера строк остаются верными.


def strip(src, strings=True):
    """Убрать комментарии; при strings=False строковые литералы ОСТАВИТЬ.

    Литералы мешают разбору структуры (скобка внутри строки ломает счёт),
    но сравнению форка они нужны: `keccak256("ROLE_A")` против
    `keccak256("ROLE_B")` — это разный код, а без литералов строки равны.
    """
    out = list(src)
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c == "/" and i + 1 < n and src[i + 1] == "/":
            j = src.find("\n", i)
            j = n if j < 0 else j
            for k in range(i, j):
                out[k] = " "
            i = j
        elif c == "/" and i + 1 < n and src[i + 1] == "*":
            j = src.find("*/", i + 2)
            j = n if j < 0 else j + 2
            for k in range(i, j):
                if out[k] != "\n":
                    out[k] = " "
            i = j
        elif c in "\"'":
            j = i + 1
            while j < n and src[j] != c:
                j += 2 if src[j] == "\\" else 1
            j = min(j + 1, n)
            if strings:
                for k in range(i, j):
                    if out[k] != "\n":
                        out[k] = " "
            i = j
        else:
            i += 1
    return "".join(out)


def match_brace(txt, i):
    """i указывает на '{'. Вернуть индекс парной '}' или len(txt)."""
    d = 0
    n = len(txt)
    while i < n:
        if txt[i] == "{":
            d += 1
        elif txt[i] == "}":
            d -= 1
            if d == 0:
                return i
        i += 1
    return n


def lineno(txt, pos):
    return txt.count("\n", 0, pos) + 1


# --- заголовки -----------------------------------------------------------

CONTRACT = re.compile(
    r"\b(abstract\s+contract|contract|library|interface)\s+"
    r"([A-Za-z_]\w*)\s*(?:is\s+([^{]*?))?\{")

FUNC = re.compile(
    r"\b(function\s+([A-Za-z_]\w*)|constructor|receive|fallback|"
    r"modifier\s+([A-Za-z_]\w*))\s*\(")

# слова заголовка, которые НЕ являются модификатором
NOTMOD = {
    "public", "private", "internal", "external", "view", "pure", "payable",
    "virtual", "override", "returns", "memory", "calldata", "storage",
    "immutable", "constant", "anonymous",
}

# начала объявлений, которые не являются переменной состояния
NOTVAR = re.compile(
    r"^\s*(?:function|constructor|receive|fallback|modifier|event|error|"
    r"struct|enum|using|constructor|type|import|pragma|contract|library|"
    r"interface|unchecked)\b")

VARDECL = re.compile(
    r"^\s*(?:mapping\s*\(.*\)|[A-Za-z_][\w.]*(?:\s*\[[^\]]*\])*)\s+"
    r"(?:public\s+|private\s+|internal\s+|constant\s+|immutable\s+|"
    r"transient\s+|override\s+)*"
    r"([A-Za-z_]\w*)\s*(?:=|;)", re.S)


class Func(object):
    __slots__ = ("name", "kind", "params", "header", "mods", "body",
                 "line", "contract", "path")

    def __init__(self, **kw):
        for k in self.__slots__:
            setattr(self, k, kw.get(k))

    @property
    def arity(self):
        p = self.params.strip()
        return 0 if not p else p.count(",") + 1

    def __repr__(self):
        return "<%s.%s @%s:%d>" % (self.contract, self.name,
                                   os.path.basename(self.path or ""),
                                   self.line or 0)


class Contract(object):
    __slots__ = ("name", "kind", "bases", "funcs", "vars", "line", "path",
                 "body")

    def __init__(self, **kw):
        for k in self.__slots__:
            setattr(self, k, kw.get(k))

    def __repr__(self):
        return "<contract %s>" % self.name


def _split_params(txt, i):
    """i указывает на '(' — вернуть (содержимое, индекс после ')')."""
    d, n, start = 0, len(txt), i
    while i < n:
        if txt[i] == "(":
            d += 1
        elif txt[i] == ")":
            d -= 1
            if d == 0:
                return txt[start + 1:i], i + 1
        i += 1
    return "", n


def _mods(header):
    """Имена модификаторов из заголовка, БЕЗ аргументов и без ключевых слов."""
    h = re.sub(r"\breturns\s*\([^)]*\)", " ", header)
    out = []
    for m in re.finditer(r"([A-Za-z_]\w*)\s*(\([^)]*\))?", h):
        w = m.group(1)
        if w in NOTMOD or not w:
            continue
        out.append(w)
    return out


def parse_file(path, src=None):
    """Список Contract из одного файла."""
    if src is None:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            src = fh.read()
    txt = strip(src)
    res = []
    for cm in CONTRACT.finditer(txt):
        open_i = txt.index("{", cm.end() - 1)
        close_i = match_brace(txt, open_i)
        body = txt[open_i + 1:close_i]
        base = open_i + 1
        bases = [b.strip().split("(")[0].strip()
                 for b in (cm.group(3) or "").split(",") if b.strip()]
        c = Contract(name=cm.group(2), kind=cm.group(1).split()[-1],
                     bases=bases, funcs=[], vars=[], path=path,
                     line=lineno(txt, cm.start()), body=body)

        # функции: ищем по всему телу контракта, вложенные отсекаем по
        # смещению — тело найденной функции пропускаем целиком.
        i = 0
        spans = []
        while True:
            fm = FUNC.search(body, i)
            if not fm:
                break
            g = fm.group(1)
            if g.startswith("function"):
                name, kind = fm.group(2), "function"
            elif g.startswith("modifier"):
                name, kind = fm.group(3), "modifier"
            else:
                name, kind = g, g
            params, after = _split_params(body, fm.end() - 1)
            # заголовок до '{' или ';'
            b1 = body.find("{", after)
            s1 = body.find(";", after)
            if b1 < 0 or (0 <= s1 < b1):
                # объявление без тела (интерфейс, abstract)
                i = (s1 if s1 >= 0 else after) + 1
                header, fbody, endi = body[after:max(after, s1)], "", i
            else:
                header = body[after:b1]
                end = match_brace(body, b1)
                fbody = body[b1 + 1:end]
                endi = end + 1
            spans.append((fm.start(), endi))
            c.funcs.append(Func(
                name=name, kind=kind, params=params, header=header,
                mods=_mods(header), body=fbody,
                line=lineno(txt, base + fm.start()),
                contract=c.name, path=path))
            i = endi

        # переменные состояния: то, что осталось от тела вне функций
        rest, prev = [], 0
        for a, b in spans:
            rest.append(body[prev:a])
            prev = b
        rest.append(body[prev:])
        for chunk in rest:
            # ВЫРЕЗАТЬ тела struct/enum: их поля — НЕ переменные состояния, а
            # statesync принимал имя поля (`collateralData` в LoanInfo) за
            # отдельный слот и выдавал ложный «разрыв инварианта».
            chunk = re.sub(r"\b(?:struct|enum)\s+\w+\s*\{[^{}]*\}", " ", chunk)
            for stmt in re.split(r";", chunk):
                stmt = stmt.strip()
                if not stmt or NOTVAR.match(stmt) or "{" in stmt:
                    continue
                vm = VARDECL.match(stmt + ";")
                if vm and vm.group(1) not in NOTMOD:
                    c.vars.append(vm.group(1))
        res.append(c)
    return res


def parse_tree(root, skip_tests=True):
    """Все контракты дерева. Возвращает список Contract."""
    out = []
    for dirpath, dirnames, files in os.walk(root):
        dirnames[:] = [d for d in dirnames
                       if d not in ("node_modules", ".git", "out", "cache",
                                    "artifacts", "broadcast")]
        low = dirpath.replace("\\", "/").lower()
        if skip_tests and re.search(r"/(?:test|tests|mocks?|script)s?(?:/|$)",
                                    low):
            continue
        for f in files:
            if not f.endswith(".sol"):
                continue
            if skip_tests and re.search(r"\.(?:t|s)\.sol$|^Mock|^Test", f):
                continue
            try:
                out.extend(parse_file(os.path.join(dirpath, f)))
            except Exception as e:          # разбор не должен ронять проход
                print("   ! разбор %s: %s" % (f, e))
    return out


def rel(path, root):
    try:
        return os.path.relpath(path, root).replace("\\", "/")
    except ValueError:
        return path
