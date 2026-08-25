# -*- coding: utf-8 -*-
"""Проверки на ошибки, которые НЕ ВИДНО по коду возврата.

Всё, что здесь заперто, однажды прошло молча: типы сходились, процесс не
падал, код возврата был ноль — и только глаз на выводе показывал, что
результат неверен. Такие ошибки не ловятся ни разу, если их не запереть.

Каждый тест назван по случаю, из которого родился, чтобы правку нельзя
было откатить «за ненадобностью», не прочитав, чем она была вызвана.

Идут офлайн и за секунды: образцы лежат в data/fixtures — куски настоящих
отчётов из кэша и настоящий формат ответа модели.

    python -m unittest test_gates -v
"""
import json
import pathlib
import unittest

import intake
import runlog
from scout import c4reports as C4
from scout import cantina_reports as CR

FIX = pathlib.Path(__file__).resolve().parent / "data" / "fixtures"


def fixture(name):
    return (FIX / name).read_text(encoding="utf-8")


class SlugTests(unittest.TestCase):
    """Кириллическое имя схлопывалось в мусор: «UI Приём Тест» -> `ui`.

    Мишень уезжала в чужую папку, а при совпадении подхватывала чужие
    прогоны. Ошибка тихая: имя короткое, но не пустое, и всё «работало».
    """

    def test_кириллица_переводится_а_не_выбрасывается(self):
        self.assertEqual(intake._slug("UI Приём Тест"), "ui-priem-test")
        self.assertEqual(intake._slug("Проверка Приёма"), "proverka-priema")
        self.assertEqual(intake._slug("Ак Барс Банк"), "ak-bars-bank")

    def test_разные_имена_дают_разные_папки(self):
        names = ["Мосты", "Оракулы", "Мосты и Оракулы", "Bridges"]
        slugs = [intake._slug(n) for n in names]
        self.assertEqual(len(set(slugs)), len(names), slugs)

    def test_пустое_и_мусорное_имя_не_дают_пустой_папки(self):
        for bad in ("", "   ", "!!!", "---", "。。。"):
            with self.subTest(bad=bad):
                self.assertTrue(intake._slug(bad))


class ModelAnswerTests(unittest.TestCase):
    """Разбор ответа модели хватал ШАБЛОН из её же размышлений.

    Лёгкий тир пишет рассуждения вслух и пересказывает в них ту же схему:
    `{"out_of_scope": ["..."]}`. Поиск «от первой скобки» брал именно её,
    ворота честно выкидывали строки «...» как не найденные в тексте, и
    это выглядело как отказ модели — хотя настоящий ответ шёл ниже.
    """

    def test_рассуждение_перед_json_не_подменяет_ответ(self):
        d = intake._best_json(fixture("model_reasoning_then_json.txt"))
        self.assertIsNotNone(d)
        self.assertIn("фишинг", d["out_of_scope"])
        # Главное: не подобрали шаблон из размышления.
        self.assertNotIn("...", d["out_of_scope"])

    def test_оборванный_ответ_разбирается_а_не_теряется(self):
        d = intake._best_json(fixture("model_truncated.txt"))
        self.assertIsNotNone(d, "оборванный хвост должен чиниться, а не пропадать")
        self.assertIn("DDoS", d["out_of_scope"])

    def test_чистый_json_разбирается(self):
        d = intake._best_json(fixture("model_clean.txt"))
        self.assertEqual(d["rules"], ["нужен PoC"])

    def test_мусор_без_json_даёт_none_а_не_выдумку(self):
        self.assertIsNone(intake._best_json("никакого JSON тут нет"))


class LiteralGateTests(unittest.TestCase):
    """Последний рубеж: строка модели обязана найтись во входном тексте."""

    def test_дословное_проходит_выдуманное_нет(self):
        text = "Вне скоупа: фишинг, социальная инженерия, DDoS."
        self.assertTrue(intake.gate_literal("фишинг", text))
        self.assertFalse(intake.gate_literal("обход двухфакторной аутентификации",
                                             text))

    def test_шаблон_из_размышления_не_проходит(self):
        self.assertFalse(intake.gate_literal("...", ""))


class ExtractTests(unittest.TestCase):
    """Факты добывает регулярка, и только из данного текста."""

    TEXT = ("В скоупе: https://github.com/compound-finance/compound-protocol "
            "и контракт https://etherscan.io/address/"
            "0xc3d688B66703497DAA19211EEdff47f25384cdc3 в сети Ethereum. "
            "Документация: https://docs.compound.finance/ ")

    def test_репозиторий_и_адрес_достаются(self):
        f = intake.extract(self.TEXT)
        self.assertEqual(f["repos"], ["compound-finance/compound-protocol"])
        self.assertEqual(f["addrs"],
                         ["0xc3d688b66703497daa19211eedff47f25384cdc3"])
        self.assertIn(1, f["chains"])

    def test_служебные_хосты_не_считаются_активами(self):
        f = intake.extract(self.TEXT)
        for host in f["hosts"]:
            self.assertNotIn("github.com", host)
            self.assertNotIn("etherscan.io", host)

    def test_чего_нет_в_тексте_того_нет_в_фактах(self):
        f = intake.extract("Программа без единой ссылки и без адресов.")
        self.assertEqual(f["repos"], [])
        self.assertEqual(f["addrs"], [])


class C4FormatTests(unittest.TestCase):
    """Два формата заголовков находок, и различать надо ТОЧНО.

    Старые отчёты: «[H-01] Название». С 2025 года: «H‑01» без скобок, но
    дефис неразрывный (U+2011), тогда как в прозе на соседнюю находку
    ссылаются обычным дефисом. Пока это не различалось, половина отчётов
    давала ноль находок — и выглядело это как «там нечего было находить».
    """

    def test_старый_формат_со_скобками(self):
        p = C4.parse(fixture("c4_old_brackets.txt"))
        self.assertGreaterEqual(len(p["findings"]), 3)
        self.assertTrue(all(t.strip() for _s, _n, t in p["findings"]))

    def test_новый_формат_с_неразрывным_дефисом(self):
        p = C4.parse(fixture("c4_new_nbhyphen.txt"))
        self.assertGreaterEqual(len(p["findings"]), 5)

    def test_ссылка_в_прозе_не_считается_заголовком(self):
        # Обычный дефис без скобок — это упоминание, а не находка.
        p = C4.parse("Combines with L-01 and pairs with M-02 (owner-side skim).")
        self.assertEqual(p["findings"], [])

    def test_разметка_не_просачивается_в_имена_файлов(self):
        for name in ("c4_old_brackets.txt", "c4_new_nbhyphen.txt"):
            for f in C4.parse(fixture(name))["files"]:
                with self.subTest(fixture=name, file=f):
                    self.assertFalse(f.startswith("u003"), f)
                    self.assertNotIn("<", f)


class C4MatchTests(unittest.TestCase):
    """Связывание отчёта с мишенью идёт по имени — и это опасное место.

    Совпадение по подстроке притянуло бы чужой протокол, и его файлы
    вычлись бы из blindspots: файл объявлен прочитанным, хотя его никто
    не смотрел. Ошибка молчаливая и в опасную сторону.
    """

    ROWS = [{"title": "NOYA", "slug": "2024-04-noya", "status": "Completed"},
            {"title": "Lido Finance", "slug": "2025-07-lido-finance",
             "status": "Completed"},
            {"title": "Yeti Finance", "slug": "2021-12-yeti-finance",
             "status": "Completed"}]

    def test_слитный_владелец_находит_протокол(self):
        hits = C4.match(self.ROWS, "lidofinance core")
        self.assertEqual([h["title"] for h in hits], ["Lido Finance"])

    def test_подстрока_не_притягивает_чужое(self):
        self.assertEqual(C4.match(self.ROWS, "annoyance"), [])

    def test_общее_слово_не_склеивает_протоколы(self):
        # «finance» есть у половины рынка: по нему совпадать нельзя.
        self.assertEqual(C4.match(self.ROWS, "Compound Finance"), [])


class MarketGuardTests(unittest.TestCase):
    """Площадка, не ответившая сегодня, не должна ИСЧЕЗАТЬ из снимка.

    hackenproof отдала 403, фетчер честно вернул пусто — и `--refresh`
    молча стёр 78 живых программ вместе со скоупами, показав их в диффе
    как «ушла». Сетевой сбой не отличить от закрытия по одному прогону,
    но пусто там, где вчера было густо, — почти всегда сбой.
    """

    def setUp(self):
        import market as M
        self.M = M
        from scout.market import Program
        self.P = Program

    def test_упавшая_площадка_переносится(self):
        old = [self.P(site="hackenproof", pid=str(i), name="p%d" % i,
                      url="") for i in range(3)]
        old += [self.P(site="cantina", pid="c1", name="c", url="")]
        fresh = [self.P(site="cantina", pid="c1", name="c", url="")]
        out = self.M.carry_dead_site(list(fresh), old)
        self.assertEqual(sum(1 for p in out if p.site == "hackenproof"), 3)

    def test_живая_площадка_не_дублируется(self):
        old = [self.P(site="cantina", pid="c1", name="c", url="")]
        fresh = [self.P(site="cantina", pid="c1", name="c", url="")]
        out = self.M.carry_dead_site(list(fresh), old)
        self.assertEqual(len(out), 1)


class UnexplainedZeroTests(unittest.TestCase):
    """Успех + ноль результата + молчание = «неизвестно», а не «чисто».

    Класс, на котором мы горели дважды. Starknet: скан отработал за 7
    секунд по недокачанному дереву. Spark: 30 шагов, ни одного сигнала от
    дерева. Оба раза код возврата ноль, оба раза UI рисовал успех — и
    только чтение вывода показывало, что смотреть было нечего.
    """

    @staticmethod
    def run_events(status="ok", cands=0, incomplete=False, notes=0, failed=0):
        ev = [{"kind": "run_start", "action": "scan"}]
        ev += [{"kind": "note", "text": "почему пусто"} for _ in range(notes)]
        ev += [{"kind": "step_end", "status": "err"} for _ in range(failed)]
        ev += [{"kind": "candidate", "file": "A.sol"} for _ in range(cands)]
        end = {"kind": "run_end", "status": status}
        if incomplete:
            end["incomplete"] = True
        ev.append(end)
        return ev

    def test_молчаливый_ноль_ловится(self):
        self.assertTrue(runlog.unexplained_zero(self.run_events()))

    def test_помеченный_неполным_не_ловится(self):
        self.assertFalse(
            runlog.unexplained_zero(self.run_events(incomplete=True)))

    def test_ноль_с_заметкой_не_ловится(self):
        self.assertFalse(runlog.unexplained_zero(self.run_events(notes=1)))

    def test_ноль_с_упавшим_шагом_не_ловится(self):
        self.assertFalse(runlog.unexplained_zero(self.run_events(failed=1)))

    def test_есть_зацепки_значит_объяснять_нечего(self):
        self.assertFalse(runlog.unexplained_zero(self.run_events(cands=3)))

    def test_идущий_прогон_не_обвиняем(self):
        ev = [{"kind": "run_start"}]           # run_end ещё нет
        self.assertFalse(runlog.unexplained_zero(ev))

    def test_подготовка_не_обвиняется_в_нуле(self):
        # prep качает исходники и зацепок не даёт вовсе. Предупреждение,
        # которое горит на каждом prep, перестают читать — и оно не
        # сработает там, где действительно нужно.
        ev = self.run_events()
        ev[0]["action"] = "prep"
        self.assertFalse(runlog.unexplained_zero(ev))

    def test_упавший_прогон_и_так_виден(self):
        self.assertFalse(runlog.unexplained_zero(self.run_events(status="err")))


class CantinaGradeTests(unittest.TestCase):
    """Ноль починенных ≠ «не чинили». Самая дорогая ошибка этого источника.

    Замерено: из 51 отчёта публичных конкурсов у 37 стоит fixed=0 —
    на конкурсах починку не отслеживают вовсе. Принять это за признание
    «мы не чинили» значит гнать человека читать 41 находку, по которым на
    самом деле неизвестно ничего.

    Настоящий сигнал — частичная починка: команда своей рукой отметила
    часть закрытой, а часть оставила.
    """

    @staticmethod
    def row(pairs):
        return {"findingStats": [{"severity": s, "totalCount": t,
                                  "fixedCount": f} for s, t, f in pairs]}

    def test_частичная_починка_это_partial(self):
        self.assertEqual(CR.grade(self.row([("high", 11, 2)])), "partial")

    def test_ноль_починенных_это_неизвестно_а_не_признание(self):
        self.assertEqual(CR.grade(self.row([("high", 41, 0)])), "none")

    def test_всё_починено(self):
        self.assertEqual(CR.grade(self.row([("medium", 5, 5)])), "full")

    def test_низкие_серьёзности_не_считаются(self):
        # low и informational не ведут к находке: их и не смотрим.
        self.assertEqual(CR.grade(self.row([("low", 9, 0),
                                            ("informational", 4, 4)])), "empty")

    def test_частично_починенные_идут_первыми(self):
        rows = [{"grade": "none", "total": 41, "fixed": 0, "at": "2025"},
                {"grade": "partial", "total": 11, "fixed": 2, "at": "2023"},
                {"grade": "full", "total": 5, "fixed": 5, "at": "2024"}]
        self.assertEqual(CR.order(rows)[0]["grade"], "partial")


class CantinaMatchTests(unittest.TestCase):
    """Связь по репозиторию точна, по имени — нет. Порядок обязателен."""

    ROWS = [{"title": "Morpho Blue", "repos": ["morpho-org/morpho-blue"],
             "grade": "partial", "total": 11, "fixed": 2, "at": "2023"},
            {"title": "Blue Finance", "repos": ["other/blue"],
             "grade": "none", "total": 3, "fixed": 0, "at": "2024"}]

    def test_репозиторий_бьёт_точно_и_не_добирает_однофамильцев(self):
        hits, how = CR.match(self.ROWS, repo="morpho-org/morpho-blue",
                             name="morpho blue")
        self.assertEqual(how, "репозиторий")
        self.assertEqual([h["title"] for h in hits], ["Morpho Blue"])

    def test_регистр_и_хвост_ссылки_не_мешают(self):
        self.assertEqual(CR._norm_repo("https://github.com/Morpho-Org/Morpho-Blue/"),
                         "morpho-org/morpho-blue")

    def test_имя_работает_когда_репозитория_нет(self):
        hits, how = CR.match(self.ROWS, repo="", name="Morpho Blue")
        self.assertEqual(how, "имя")
        self.assertTrue(hits)


class BlindspotSkipTests(unittest.TestCase):
    """Обвязка тестов забивала список нетронутого: у Lido 265 файлов из 352.

    Настоящие файлы в таком списке не найти, а значит сигнал бесполезен,
    хотя формально работает.
    """

    def test_обвязка_отсеивается(self):
        import blindspots
        for name in ("AccessControl__Harness.sol",
                     "Accounting__MockForSanityChecker.sol",
                     "AlertingHarness.sol", "MockToken.sol"):
            with self.subTest(name=name):
                self.assertTrue(blindspots.SKIP.search(name), name)

    def test_настоящие_файлы_остаются(self):
        import blindspots
        for name in ("AlchemistV3.sol", "BorrowLogic.sol", "Accounting.sol"):
            with self.subTest(name=name):
                self.assertFalse(blindspots.SKIP.search(name), name)


class UngatedDemoteTests(unittest.TestCase):
    """Гейт живёт не в файле функции — значит это не самостоятельная находка.

    На Spark 33 «зацепки» из 38 были функциями логических библиотек Aave
    (`BorrowLogic.executeBorrow` и родня). Гейт у них в `Pool.sol`, который
    их делегирует; прямой вызов трогает хранилище самой библиотеки, то есть
    не делает ничего. Список читают сверху и до усталости — такие строки
    вытесняли настоящее.
    """

    class C:
        def __init__(self, kind):
            self.kind = kind

    class F:
        def __init__(self, body=""):
            self.body = body

    def test_функция_библиотеки_понижается(self):
        import ungated
        why = ungated.demote_reason(self.C("library"), self.F("emit X();"))
        self.assertIn("библиотек", why)

    def test_обёртка_над_делегатом_к_себе_понижается(self):
        import ungated
        why = ungated.demote_reason(
            self.C("contract"), self.F("address(this).delegatecall(data);"))
        self.assertIn("прокси", why)

    def test_обычный_контракт_не_понижается(self):
        import ungated
        self.assertEqual(
            ungated.demote_reason(self.C("contract"),
                                  self.F("balances[msg.sender] += x;")), "")

    def test_понижённые_не_уходят_в_модельный_триаж(self):
        # collect() кормит judge.py тяжёлым тиром. Платить за суждение по
        # функции, у которой гейт заведомо в другом файле, — трата.
        import inspect

        import ungated
        src = inspect.getsource(ungated.collect)
        self.assertIn("demote_reason", src)


class HitsBoundaryTests(unittest.TestCase):
    """Объяснения — не зацепки, хотя выглядят так же.

    Блоки «ПОНИЖЕНО», «УБИТО ШЛЮЗОМ», «ПОДАВЛЕНО ПАМЯТЬЮ» печатают те же
    «файл:строка». Без границы понижённое возвращалось в журнал как
    зацепка, и весь отсев шума пропадал на последнем шаге: ungated ужался
    с 85 строк до 25, а зацепок в журнале осталось столько же.
    """

    def test_после_понижено_ничего_не_собирается(self):
        import tempfile

        import targets
        text = (
            "[7.0] Pool.deposit\n"
            "   contracts/Pool.sol:42   модификаторы: (нет)\n"
            "ПОНИЖЕНО — гейт живёт не в этом файле (1):\n"
            "   BorrowLogic.executeBorrow — libraries/BorrowLogic.sol:67\n")
        with tempfile.TemporaryDirectory() as d:
            f = pathlib.Path(d) / "s.txt"
            f.write_text(text, encoding="utf-8")
            hits = targets.hits_in(f)
        files = [h[0] for h in hits]
        self.assertIn("contracts/Pool.sol", files)
        self.assertNotIn("libraries/BorrowLogic.sol", files)


if __name__ == "__main__":
    unittest.main(verbosity=2)
