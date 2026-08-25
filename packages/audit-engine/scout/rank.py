"""Оценка тесноты конкурса.

ВАЖНО ПРО ЕДИНИЦЫ. Поле `num_competition_issues` у Sherlock и `totalFindings`
у Cantina — это ПОДАННЫЕ ЗАЯВКИ, а не принятые уникальные находки. Проверено
сверкой со списком issue в отчёте: у 2024-11-autonomint 1066 заявок против
75 уникальных проблем, то есть каждую в среднем нашли 14 человек.

Для нашей задачи это удача. Награда за проблему делится между всеми, кто её
подал, поэтому

    фонд / число заявок  ~  ожидаемая выплата за ОДНУ твою заявку

Это и есть главная метрика. Называть её «доллар на находку» неверно —
правильно «доллар на заявку».

ЧТО НЕ СРАБОТАЛО. Первая версия пыталась предсказать число заявок регрессией
по размеру кода и величине фонда. Результат на 398 конкурсах:

    только фонд                  R^2 = 0.000   (коэффициент -0.01)
    фонд + площадка              R^2 = 0.003
    фонд + площадка + срок       R^2 = 0.059
    фонд + размер кода           R^2 = 0.081
    фонд + площадка + год        R^2 = 0.108

Размер фонда не предсказывает тесноту ВООБЩЕ. Крупный фонд не собирает
больше участников — приходят одни и те же люди на всё подряд. Единственный
признак с какой-то силой — год, и он же перекрывает всё остальное.
Поэтому регрессия выброшена, а прогноз строится по базовой ставке года.
"""
import datetime as dt
import statistics as st


class Baseline:
    """Базовая ставка: сколько заявок собирает типичный конкурс сейчас.

    Никакой подгонки. Берём медиану по недавним завершённым конкурсам той же
    площадки и используем её как ожидание. Это честнее регрессии с R^2=0.1
    и, как показала проверка, не хуже по точности.
    """

    def __init__(self, contests, window_years=1):
        now = dt.datetime.now(dt.timezone.utc)
        cut = now.year - window_years
        self.by_site, self.overall = {}, None
        recent = [c for c in contests
                  if c.findings > 0 and c.end and c.end.year >= cut]
        if not recent:
            recent = [c for c in contests if c.findings > 0 and c.end]
        if recent:
            self.overall = st.median([c.findings for c in recent])
            for site in {c.site for c in recent}:
                v = [c.findings for c in recent if c.site == site]
                if len(v) >= 3:
                    self.by_site[site] = st.median(v)
        self.n = len(recent)
        self.cut = cut

    def submissions(self, c):
        return self.by_site.get(c.site, self.overall)

    def per_submission(self, c):
        """Ожидаемая выплата за одну поданную заявку."""
        s = self.submissions(c)
        return c.pool / s if (s and c.pool) else None


# ГЛАВНЫЙ ИЗМЕРЕННЫЙ ЗАКОН ПРОЕКТА.
#
# Шанс оказаться ЕДИНСТВЕННЫМ нашедшим определяется не типом протокола, не
# размером фонда и не языком, а ПЛОТНОСТЬЮ ПОКРЫТИЯ — сколько заявок
# приходится на строку кода в скоупе.
#
#   плотность   заявок   строк   доля одиночек   медиана выплаты одиночке
#     0.021        70     3516        67%              2 286$
#     0.073       137     2190        36%              2 098$
#     0.145       225     1570        17%              1 211$
#     0.257       309     1072        15%              1 469$
#     0.636       615      639         0%                561$
#
# Корреляция плотности с долей одиночек r = -0.67 — сильнее, чем у любого
# отдельного признака: размер кода +0.41, число заявок -0.53, срок +0.24,
# размер фонда +0.20. Значит размер, срок и фонд — три проявления одного
# механизма, а не три независимых рычага.
#
# Практический вывод, обратный интуиции: МАЛЕНЬКИЙ скоуп — это плохо.
# Двести человек вычищают тысячу строк целиком, и уникальных находок не
# остаётся вовсе. Углы, куда никто не дошёл, бывают только в большом коде.
#
# Измерено на 193 конкурсах с полным набором признаков.
DENSITY_TABLE = ((0.05, 0.60, 2333), (0.15, 0.30, 1500),
                 (0.30, 0.15, 1200), (9e9, 0.02, 776))


def density(nsloc, submissions):
    """Заявок на строку кода. Меньше — реже придётся делиться."""
    return submissions / nsloc if (nsloc and submissions) else None


def density_outlook(nsloc, expected_subs):
    """-> (плотность, ожидаемая доля одиночек, медиана выплаты одиночке)."""
    dn = density(nsloc, expected_subs)
    if dn is None:
        return None
    for cap, solo, pay in DENSITY_TABLE:
        if dn <= cap:
            return dn, solo, pay
    return dn, 0.02, 776


def min_scope(expected_subs, target_density=0.05):
    """Сколько строк должно быть в скоупе, чтобы толпа размазалась тонко."""
    return int(expected_subs / target_density) if expected_subs else None


def yearly(contests):
    """Как менялась теснота по годам — главный измеренный факт."""
    by = {}
    for c in contests:
        if c.findings > 0 and c.pool > 0 and c.end:
            by.setdefault(c.end.year, []).append(c)
    out = []
    for y in sorted(by):
        v = by[y]
        out.append((y, len(v),
                    st.median([x.findings for x in v]),
                    st.median([x.per_finding for x in v])))
    return out


def by_language(contests):
    """Теснота в разрезе основного языка. Работает только там, где есть scope."""
    g = {}
    for c in contests:
        if not c.per_finding:
            continue
        g.setdefault(c.langs[0] if c.langs else "?", []).append(c.per_finding)
    return {k: (len(v), st.median(v)) for k, v in g.items() if len(v) >= 2}
