import { test } from "node:test"
import assert from "node:assert/strict"
import { removedLines } from "./case-cache.mjs"

test("removedLines: old-side lines a fix removes or changes", () => {
  const patch = `--- a/app/db.py
+++ b/app/db.py
@@ -10,3 +10,3 @@ def q(name):
     cur = conn.cursor()
-    cur.execute("SELECT * FROM t WHERE n = '" + name + "'")
+    cur.execute("SELECT * FROM t WHERE n = %s", (name,))
     return cur
@@ -40 +40,0 @@
-    os.system(cmd)
--- /dev/null
+++ b/new.py
@@ -0,0 +1 @@
+x = 1
`
  assert.deepEqual(removedLines(patch), { "app/db.py": [11, 40] })
})
