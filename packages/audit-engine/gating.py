# -*- coding: utf-8 -*-
"""Оракул гейтинга, знающий про НАСЛЕДОВАНИЕ. Общий для ungated и msgauth.

Зачем отдельно. Одна дыра ужалила проект трижды: `ungated`/`msgauth` смотрели
только на сам файл и объявляли «гейта нет», когда защита лежала в БАЗОВОМ
контракте (`onlyOftAdapter`, `onlyMigrationManager`, `onlyLxLyBridge`) или в
модификаторе с нестандартным именем. Все три — ложные срабатывания, каждое
жгло шаги модели и грозило пустой заявкой.

Идея фикса, механическая и точная. Модификатор — это гейт не по ИМЕНИ, а по
ТЕЛУ: если внутри он проверяет `msg.sender`/роль/`require`, он авторизует,
как бы ни назывался. Собираем тела ВСЕХ модификаторов по всему дереву (то
есть и из баз, лишь бы файл базы был в скане) и помечаем авторизующие. Дальше
функция считается защищённой, если применяет хоть один такой модификатор —
даже определённый в родителе — или сама проверяет отправителя в теле.

Что этим НЕ закрывается (честно). Архитектурные гейты, которых нет в коде
функции: адаптер-делегат, чьи аппрувы лежат на вызывающем; путь, достижимый
только через уже-защищённый вход. Их инструмент оставит кандидатами — это
верно, там нужен взгляд человека, а не молчание.
"""
import re

import solsrc

# Имя-эвристика: и так почти все гейты названы так. Оставляем как быстрый путь.
AUTH_NAME = re.compile(
    r"\b(?:only\w+|auth\w*|authorized|restricted|requiresAuth|protected|"
    r"gated|permissioned|whenNotPaused|whenPaused|nonReentrant)\b", re.I)

# Тело, доказывающее авторизацию: проверка отправителя/роли/владельца.
SENDER_CHECK = re.compile(
    r"\b(?:msg\.sender|_msgSender\(\)|tx\.origin)\b|"
    r"\b(?:hasRole|_checkRole|checkRole|_checkOwner|checkOwner|isOwner|"
    r"isAuthorized|onlyRole|_checkAuth\w*|requireAuth|_requireOwner|"
    r"_requireRole|authority|owner\(\))\b", re.I)

# Голый вызов-страж в теле функции (не через модификатор).
GUARD_CALL = re.compile(
    r"\b(?:_?checkRole|_?checkOwner|_?checkAuth\w*|_?require(?:Auth|Owner|"
    r"Role|Admin|Governor)\w*|_?onlyRole|_?authorize\w*|_?validateAuth|"
    r"_?checkSender|_?onlyLxLyBridge|_?checkAccess)\s*\(", re.I)

# require/if по отправителю прямо в теле.
GUARD_BODY = re.compile(
    r"(?:require|if)\s*\([^;{]*\b(?:msg\.sender|_msgSender\(\)|tx\.origin|"
    r"hasRole|owner\(\)|isOwner|isAuthorized|_checkRole|onlyRole|authority)\b",
    re.I)


class Oracle(object):
    """Знает, какие модификаторы во всём дереве авторизуют."""

    def __init__(self, contracts):
        self.auth_mods = set()          # имена авторизующих модификаторов
        self.by_name = {}
        for c in contracts:
            self.by_name.setdefault(c.name, c)
        # тело каждого модификатора, определённого где угодно в дереве
        for c in contracts:
            for f in c.funcs:
                if f.kind != "modifier":
                    continue
                body = f.body or ""
                if SENDER_CHECK.search(body) or GUARD_CALL.search(body):
                    self.auth_mods.add(f.name)
        # плюс имена, авторизующие по эвристике (на случай, если тело
        # модификатора не попало в дерево — база вне скана)
        # это делается в gated() через AUTH_NAME, не тут.

    def modifier_is_auth(self, name):
        return name in self.auth_mods or bool(AUTH_NAME.fullmatch(name))

    def gated(self, func):
        """Функция защищена: применён авторизующий модификатор (в т.ч. из
        базы) ИЛИ тело само проверяет отправителя/зовёт стража."""
        for m in func.mods:
            if self.modifier_is_auth(m):
                return True
        body = func.body or ""
        if GUARD_BODY.search(body) or GUARD_CALL.search(body):
            return True
        return False

    def why_gated(self, func):
        for m in func.mods:
            if m in self.auth_mods:
                return "модификатор %s (авторизует по телу)" % m
            if AUTH_NAME.fullmatch(m):
                return "модификатор %s" % m
        body = func.body or ""
        if GUARD_BODY.search(body):
            return "require по msg.sender в теле"
        if GUARD_CALL.search(body):
            return "вызов-страж в теле"
        return None


def build(root_or_contracts):
    """Оракул из корня-дерева (str) или готового списка контрактов."""
    if isinstance(root_or_contracts, str):
        contracts = solsrc.parse_tree(root_or_contracts)
    else:
        contracts = root_or_contracts
    return Oracle(contracts)
