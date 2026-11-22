import { describe, it, expect } from "vitest"
import { pyTaintScanner } from "../../src/scanners/py-taint"
import { parsePython } from "../../src/scanners/py-taint/parse"
import { makeContext } from "../helpers"

const run = async (files: Record<string, string>) => pyTaintScanner.run(makeContext({ files }))
const rules = async (files: Record<string, string>) => (await run(files)).map((i) => `${i.rule}@${i.location}`)

describe("py-taint parser", () => {
  it("parses decorators, f-strings, comprehensions, walrus, match", () => {
    const src = `@app.route("/x/<name>")
def view(name: str = "a", *args, key=None, **kw) -> str:
    q = f"SELECT * FROM t WHERE n = '{name!r:>3}' AND {kw['a']}"
    xs = [y for y in range(3) if (z := y) > 1]
    match name:
        case "a" | "b":
            pass
        case _:
            return q
    async with a as b, c as d:
        await b
    return {**kw, "k": lambda v: v}
`
    const ast = parsePython(src)!
    const json = JSON.stringify(ast)
    expect(json).not.toContain('"Error"')
    expect(ast[0].type).toBe("FunctionDef")
  })
})

describe("py-taint — Flask", () => {
  it("SQL text built from request.args with an f-string", async () => {
    const src = `from flask import Flask, request
import sqlite3
app = Flask(__name__)

@app.route("/search")
def search():
    q = request.args.get("q", "")
    conn = sqlite3.connect("db")
    cur = conn.cursor()
    cur.execute(f"SELECT * FROM items WHERE name LIKE '%{q}%'")
    return "ok"
`
    const out = await run({ "app.py": src })
    const sqli = out.find((i) => i.rule === "py-taint-sqli")
    expect(sqli?.location).toBe("app.py:10")
    expect(sqli?.flow?.[0]?.text).toBe("request.args")
    expect(sqli?.confidence).toBe("high")
  })

  it("bound parameters are not SQL injection", async () => {
    const src = `from flask import request\n@app.route("/u")\ndef u():\n    uid = request.args["id"]\n    cur.execute("SELECT * FROM users WHERE id = %s", (uid,))\n`
    expect(await rules({ "app.py": src })).not.toContain("py-taint-sqli@app.py:5")
  })

  it("% formatting and .format() into SQL", async () => {
    const src = `from flask import request
@app.route("/a")
def a():
    name = request.form["name"]
    sql = "SELECT * FROM users WHERE name = '%s'" % name
    db.execute(sql)
    other = "DELETE FROM t WHERE id = {}".format(request.values.get("id"))
    cursor.execute(other)
`
    const out = await rules({ "views.py": src })
    expect(out).toContain("py-taint-sqli@views.py:6")
    expect(out).toContain("py-taint-sqli@views.py:8")
  })

  it("route parameters: <path:name> is text, <int:id> is not", async () => {
    const src = `from flask import send_file
@app.route("/files/<path:name>")
def get_file(name):
    return send_file("/srv/files/" + name)

@app.route("/n/<int:id>")
def by_id(id):
    return send_file(f"/srv/{id}.txt")
`
    const out = await rules({ "app.py": src })
    expect(out).toContain("py-taint-path-traversal@app.py:4")
    expect(out).not.toContain("py-taint-path-traversal@app.py:8")
  })

  it("secure_filename and basename confine a path", async () => {
    const src = `from flask import request, send_file
from werkzeug.utils import secure_filename
@app.route("/d")
def d():
    f = secure_filename(request.args["f"])
    return send_file(os.path.join("/srv", f))
`
    expect(await rules({ "app.py": src })).not.toContain("py-taint-path-traversal@app.py:6")
  })

  it("shell, eval, SSTI, pickle, redirect, reflected HTML", async () => {
    const src = `import os, subprocess, pickle, base64
from flask import request, redirect, render_template_string
@app.route("/x")
def x():
    host = request.args.get("host")
    os.system("ping -c 1 " + host)
    subprocess.run(f"nslookup {host}", shell=True)
    eval(request.form["expr"])
    render_template_string("<p>Hello " + request.args["name"] + "</p>")
    pickle.loads(base64.b64decode(request.cookies.get("session")))
    nxt = request.args.get("next")
    if nxt:
        return redirect(nxt)
    return f"<h1>Hello {request.args.get('name')}</h1>"
`
    const out = await rules({ "app.py": src })
    for (const r of ["py-taint-cmdi@app.py:6", "py-taint-cmdi@app.py:7", "py-taint-code-injection@app.py:8", "py-taint-code-injection@app.py:9", "py-taint-deserialization@app.py:10", "py-taint-open-redirect@app.py:13", "py-taint-xss@app.py:14"])
      expect(out).toContain(r)
  })

  it("subprocess with an argument list is not a shell", async () => {
    const src = `import subprocess\nfrom flask import request\n@app.route("/p")\ndef p():\n    subprocess.run(["ping", "-c", "1", request.args["h"]])\n`
    expect((await rules({ "app.py": src })).filter((r) => r.startsWith("py-taint-cmdi"))).toEqual([])
  })

  it("SSRF only when the input chooses the host", async () => {
    const src = `import requests
from flask import request
@app.route("/f")
def f():
    url = request.args["url"]
    requests.get(url)
    requests.get(f"https://api.example.com/items/{request.args['id']}")
`
    const out = await rules({ "app.py": src })
    expect(out).toContain("py-taint-ssrf@app.py:6")
    expect(out).not.toContain("py-taint-ssrf@app.py:7")
  })

  it("allowlist and regex checks lower confidence", async () => {
    const src = `from flask import request, send_file
@app.route("/g")
def g():
    name = request.args["name"]
    if name not in ALLOWED_FILES:
        abort(404)
    return send_file("/srv/" + name)
`
    const out = await run({ "app.py": src })
    const f = out.find((i) => i.rule === "py-taint-path-traversal")
    expect(f?.confidence ?? "low").toBe("low")
  })
})

describe("py-taint — Django, FastAPI, cross-file", () => {
  it("Django view: request.GET into raw SQL and HttpResponse", async () => {
    const src = `from django.http import HttpResponse
from django.db import connection

def search(request):
    term = request.GET.get("q")
    with connection.cursor() as cursor:
        cursor.execute("SELECT * FROM app_item WHERE name = '" + term + "'")
    items = Item.objects.raw(f"SELECT * FROM app_item WHERE tag = '{term}'")
    return HttpResponse("<p>" + term + "</p>")
`
    const out = await rules({ "shop/views.py": src })
    expect(out).toContain("py-taint-sqli@shop/views.py:7")
    expect(out).toContain("py-taint-sqli@shop/views.py:8")
    expect(out).toContain("py-taint-xss@shop/views.py:9")
  })

  it("FastAPI query parameter and typed int", async () => {
    const src = `from fastapi import FastAPI
import os
app = FastAPI()

@app.get("/run")
def run(cmd: str, n: int = 1):
    os.system(cmd)
    os.system(f"sleep {n}")
`
    const out = await rules({ "main.py": src })
    expect(out).toContain("py-taint-cmdi@main.py:7")
    expect(out).not.toContain("py-taint-cmdi@main.py:8")
  })

  it("follows a value into the project's own function in another file", async () => {
    const route = `from flask import request\nfrom .repo import find_user\n@app.route("/u")\ndef u():\n    return find_user(request.args["name"])\n`
    const repo = `def find_user(name):\n    sql = "SELECT * FROM users WHERE name = '%s'" % name\n    return db.execute(sql)\n`
    const out = await run({ "app/routes.py": route, "app/repo.py": repo })
    const sqli = out.find((i) => i.rule === "py-taint-sqli")
    expect(sqli?.location).toBe("app/repo.py:3")
    expect(sqli?.confidence).toBe("medium")
  })

  it("tornado get_argument", async () => {
    const src = `import tornado.web, os\nclass H(tornado.web.RequestHandler):\n    def get(self):\n        f = self.get_argument("f")\n        with open(os.path.join("/data", f)) as fh:\n            self.write(fh.read())\n`
    expect(await rules({ "handlers.py": src })).toContain("py-taint-path-traversal@handlers.py:5")
  })

  it("library mode: a public function's text parameter, low confidence, SQL/shell/code only", async () => {
    const src = `import os, subprocess
def drop(table_name, n: int = 1):
    cursor.execute("DESCRIBE " + table_name)
    os.system("dot -Tpdf " + table_name)
    subprocess.run([table_name, "-x"])
    open(table_name).read()
    cursor.execute(f"SELECT * FROM t LIMIT {n}")
def _private(q):
    cursor.execute("SELECT " + q)
`
    const out = await run({ "lib/store.py": src })
    expect(out.map((i) => i.location).sort()).toEqual(["lib/store.py:3", "lib/store.py:4"])
    expect(out.every((i) => i.confidence === "low")).toBe(true)
  })
})

describe("py-taint — corpus false-positive shapes (review 2026-11-22)", () => {
  it("an upload object is not a path; its .filename is", async () => {
    const src = `from fastapi import FastAPI, UploadFile, File
app = FastAPI()
@app.post("/up")
async def up(file: UploadFile = File(...)):
    ext = Path(file.filename).suffix
    with open(UPLOAD_DIR / f"{uuid4()}{ext}", "wb") as fh:
        fh.write(await file.read())
    with open(os.path.join(UPLOAD_DIR, file.filename), "wb") as fh:
        pass
    with open(UPLOAD_DIR / f"{uuid4()}_{file.filename}", "wb") as fh:
        pass
`
    const out = await rules({ "api.py": src })
    expect(out).not.toContain("py-taint-path-traversal@api.py:6")
    expect(out).toContain("py-taint-path-traversal@api.py:8")
    expect(out).not.toContain("py-taint-path-traversal@api.py:10")
  })

  it("Flask FileStorage.save with the client's filename", async () => {
    const src = `from flask import request
@app.route("/u", methods=["POST"])
def u():
    f = request.files["doc"]
    f.save(os.path.join(UPLOADS, f.filename))
`
    expect(await rules({ "app.py": src })).toContain("py-taint-path-traversal@app.py:5")
  })

  it("one URL segment is low confidence for paths; :path is not", async () => {
    const src = `from fastapi import FastAPI
from fastapi.responses import FileResponse
app = FastAPI()
@app.get("/runs/{run_id}")
def run(run_id: str):
    return FileResponse(os.path.join(RUNS, run_id))
@app.get("/static/{p:path}")
def st(p: str):
    return FileResponse(os.path.join(STATIC, p))
`
    const out = await run({ "main.py": src })
    expect(out.find((i) => i.location === "main.py:6")?.confidence).toBe("low")
    expect(out.find((i) => i.location === "main.py:9")?.confidence).toBe("high")
  })

  it("tuple returns keep their positions", async () => {
    const src = `from flask import request
def build(name):
    where = "name = :name"
    params = {"name": name}
    return where, params
@app.route("/q")
def q():
    where, params = build(request.args["n"])
    db.execute(f"SELECT * FROM t WHERE {where}", params)
`
    expect(await rules({ "app.py": src })).not.toContain("py-taint-sqli@app.py:9")
  })

  it("SSRF: a fixed host in the variable's f-string is ours", async () => {
    const src = `import requests
from flask import request
@app.route("/w")
def w():
    topic = request.form["t"]
    url = f"https://{LANG}.wikipedia.org/wiki/{topic}"
    requests.get(url)
    target = f"{request.args['host']}/status"
    requests.get(target)
`
    const out = await rules({ "app.py": src })
    expect(out).not.toContain("py-taint-ssrf@app.py:7")
    expect(out).toContain("py-taint-ssrf@app.py:9")
  })

  it("redirecting to the request's own path is not open", async () => {
    const src = `from django.shortcuts import redirect
def v(request):
    return redirect(request.path)
`
    expect(await rules({ "views.py": src })).toEqual([])
  })

  it("a project validator or an allowlist reassignment guards the value", async () => {
    const src = `from flask import request
@app.route("/s")
def s():
    sort_by = request.args.get("sort", "rate")
    if sort_by not in {"rate", "p50"}:
        sort_by = "rate"
    name = request.args["name"]
    _validate_name(name)
    db.execute(f"SELECT * FROM t ORDER BY {sort_by}")
    db.execute(f"SELECT * FROM t WHERE n = '{name}'")
`
    const out = await run({ "app.py": src })
    expect(out.filter((i) => i.confidence !== "low").map((i) => i.location)).toEqual([])
  })
})

