import tempfile
import unittest
from pathlib import Path
from unittest import mock

import runlog
import targets


class RunlogTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.work = Path(self.tmp.name)
        self.work_patch = mock.patch.object(runlog, "WORK", self.work)
        self.work_patch.start()

    def tearDown(self):
        self.work_patch.stop()
        self.tmp.cleanup()

    def test_helpers_and_parent_child_are_canonical(self):
        parent = runlog.Run("demo", "loop", model="planned")
        child = parent.child("agent", target="tree")
        child.model_call("actual-model", step=1, answered=True)
        child.verdict(True, file="A.sol")
        child.error("temporary failure", scope="model")
        child.end()
        parent.end()

        self.assertNotEqual(parent.id, child.id)
        start = runlog.read(child.path)[0]
        self.assertEqual(start["parent"], parent.id)
        self.assertEqual(start["root"], parent.id)
        events = runlog.read(child.path)
        self.assertEqual(
            [e["kind"] for e in events],
            ["run_start", "model_call", "verdict", "error", "run_end"],
        )
        self.assertEqual(events[1]["model"], "actual-model")
        self.assertIs(events[2]["ok"], True)
        self.assertEqual(runlog.read(parent.path)[1]["child"], child.id)

    def test_deterministic_scan_does_not_invent_model_events(self):
        row = {
            "slug": "demo", "name": "Demo", "site": "test", "url": "",
            "repos": [], "assets": [],
        }
        tree = self.work / "demo" / "src" / "repo"
        tree.mkdir(parents=True)

        def fake_tool(_cmd, out_file):
            out_file.write_text("", encoding="utf-8")
            return 0, []

        with mock.patch.object(targets, "WORK", self.work), \
                mock.patch.object(targets, "run_tool", side_effect=fake_tool):
            targets.scan(row)

        files = list((self.work / "demo" / "runs").glob("*.jsonl"))
        self.assertEqual(len(files), 1)
        kinds = [e["kind"] for e in runlog.read(files[0])]
        self.assertNotIn("model_call", kinds)
        # Шесть сигналов от дерева (siblings, statesync, ungated, msgauth,
        # callgraph, custody — последние два подключены условно при наличии
        # дерева) плюс c4 и cantina: отчёты Code4rena и Cantina идут по МИШЕНИ
        # (а не по репозиторию) и работают без скачанного дерева, поэтому их два.
        self.assertEqual(kinds.count("step_start"), 8)


if __name__ == "__main__":
    unittest.main()
