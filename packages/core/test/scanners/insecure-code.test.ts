import { describe, it, expect } from "vitest"
import { insecureCodeScanner, literalRanges } from "../../src/index"
import { makeContext } from "../helpers"

/**
 * These cases come from running the scanner on this repository, where it
 * reported its own rule table. Security tooling, linters and documentation all
 * hold dangerous-looking text in strings and patterns; a scanner that cannot
 * tell a description of code from code flags every one of them.
 */
describe("literal handling", () => {
  it("ignores literal Function feature probes but preserves dynamic bodies", async () => {
    const issues = await insecureCodeScanner.run(makeContext({ files: {
      "src/probe.ts": 'new Function("return true");\nnew Function("value", body);',
    } }))
    expect(issues).toHaveLength(1)
    expect(issues[0].location).toBe("src/probe.ts:2")
    expect(issues[0].severity).toBe("critical")
  })

  it("ignores block comments and multiline documentation while retaining executable calls", async () => {
    const issues = await insecureCodeScanner.run(makeContext({ files: {
      "src/help.ts": [
        "/* Example of unsafe code:",
        "eval(payload)",
        "*/",
        "const help = `Example:",
        "new Function(payload)",
        "`;",
        "eval(payload)",
      ].join("\n"),
    } }))
    expect(issues).toHaveLength(1)
    expect(issues[0].location).toBe("src/help.ts:7")
  })

  it("does not call an interpolated executable path shell interpolation", async () => {
    const issues = await insecureCodeScanner.run(makeContext({ files: {
      "src/run.ts": "execFile(`${bin}/git`, ['status']);\nexec(`git ${argument}`);",
    } }))
    expect(issues).toHaveLength(1)
    expect(issues[0].location).toBe("src/run.ts:2")
  })

  it("does not interpret arbitrary verify options as JWT settings", async () => {
    const issues = await insecureCodeScanner.run(makeContext({ files: {
      "src/config.ts": "const build = { verify: false };\njwt.decode(token, { verify: false });\njwt.verify(token, key, { verify: false });",
    } }))
    expect(issues).toHaveLength(0)
  })

  it("does not flag dangerous text inside a regex literal", async () => {
    const issues = await insecureCodeScanner.run(
      makeContext({
        files: { "rules.ts": "const rule = { re: /rejectUnauthorized\\s*:\\s*false/g }\n" },
      }),
    )
    expect(issues).toHaveLength(0)
  })

  it("does not flag dangerous text inside a string", async () => {
    const issues = await insecureCodeScanner.run(
      makeContext({
        files: { "docs.ts": 'const help = "never use new Function() on user input"\n' },
      }),
    )
    expect(issues).toHaveLength(0)
  })

  it("still flags the real call on a line that also contains a string", async () => {
    // The guard must not become a blanket exemption for lines with quotes in.
    const issues = await insecureCodeScanner.run(
      makeContext({ files: { "a.ts": 'log("running"); eval(payload)\n' } }),
    )
    expect(issues).toHaveLength(1)
  })

  it("tells a regex literal from a division", () => {
    // Closes at 17, not the `/` at 14: that one is inside a character class.
    expect(literalRanges("const r = /ab[/]c/g")).toEqual([[10, 17]])
    expect(literalRanges("const x = a / b / c")).toEqual([]) // division, not a regex
    expect(literalRanges("const s = 'hi'")).toEqual([[10, 13]])
  })
})

/**
 * The interesting property of this scanner is not that it fires — it is that it
 * does NOT fire on the safe form of the same construct. Most rules therefore
 * come in pairs: the dangerous line and its innocent twin.
 */
describe("insecureCodeScanner", () => {
  async function run(files: Record<string, string>) {
    return insecureCodeScanner.run(makeContext({ files }))
  }

  it("flags eval() on a non-literal but not on a string literal", async () => {
    const bad = await run({ "src/a.ts": "const r = eval(userInput)\n" })
    expect(bad).toHaveLength(1)
    expect(bad[0].severity).toBe("critical")
    expect(bad[0].location).toBe("src/a.ts:1")

    // `eval("1+1")` is pointless, not dangerous — no attacker-controlled input
    // can reach it, so reporting it would be pure noise.
    expect(await run({ "src/b.ts": 'const r = eval("1+1")\n' })).toHaveLength(0)
  })

  it("flags a shell command built by interpolation but not a fixed one", async () => {
    const bad = await run({ "src/a.ts": "execSync(`git checkout ${branch}`)\n" })
    expect(bad).toHaveLength(1)
    expect(bad[0].title).toContain("Shell command")

    expect(await run({ "src/b.ts": 'execSync("git status")\n' })).toHaveLength(0)
    // The recommended fix must not itself be flagged.
    expect(await run({ "src/c.ts": 'execFile("git", ["checkout", branch])\n' })).toHaveLength(0)
  })

  it("flags interpolated SQL but not a parameterised query", async () => {
    const bad = await run({ "src/db.ts": "db.query(`SELECT * FROM users WHERE id = ${id}`)\n" })
    expect(bad).toHaveLength(1)
    expect(bad[0].severity).toBe("critical")

    expect(
      await run({ "src/ok.ts": 'db.query("SELECT * FROM users WHERE id = $1", [id])\n' }),
    ).toHaveLength(0)
  })

  it("flags disabled TLS verification in both spellings", async () => {
    const a = await run({ "src/a.ts": "const agent = new Agent({ rejectUnauthorized: false })\n" })
    expect(a).toHaveLength(1)
    expect(a[0].severity).toBe("critical")

    const b = await run({ "src/b.py": "requests.get(url, verify=False)\n" })
    expect(b).toHaveLength(1)
    expect(b[0].severity).toBe("critical")
  })

  it("flags Python shell=True and yaml.load, not their safe forms", async () => {
    const bad = await run({
      "app.py": "subprocess.run(cmd, shell=True)\ndata = yaml.load(text)\n",
    })
    expect(bad).toHaveLength(2)
    expect(bad.every((i) => i.severity === "critical")).toBe(true)

    const good = await run({
      "ok.py": "subprocess.run(['ls', '-la'])\ndata = yaml.safe_load(text)\nyaml.load(t, Loader=yaml.SafeLoader)\n",
    })
    expect(good).toHaveLength(0)
  })

  it("flags Math.random only when it produces something meant to be unguessable", async () => {
    const bad = await run({ "src/a.ts": "const sessionToken = Math.random().toString(36)\n" })
    expect(bad).toHaveLength(1)

    // Jitter, sampling and animation are the overwhelmingly common uses.
    expect(await run({ "src/b.ts": "const delay = Math.random() * 1000\n" })).toHaveLength(0)
  })

  it("skips matches inside comments — commented-out code is not running code", async () => {
    expect(await run({ "src/a.ts": "// const r = eval(userInput)\n" })).toHaveLength(0)
    expect(await run({ "app.py": "# subprocess.run(cmd, shell=True)\n" })).toHaveLength(0)
  })

  it("lowers severity in test files, where the pattern is often deliberate", async () => {
    const issues = await run({ "src/api.test.ts": "localStorage.setItem('token', t)\n" })
    expect(issues).toHaveLength(1)
    expect(issues[0].detail).toContain("test file")
  })

  it("skips fixture-server TLS, Content-MD5 and pickle round-trips in tests", async () => {
    expect(
      await run({
        "test/https.test.js": "new Agent({ rejectUnauthorized: false })\nconst h = createHash('md5')\n",
        "tests/test_pickle.py": "r = pickle.loads(pickle.dumps(p))\n",
      }),
    ).toHaveLength(0)
    // …but not in shipped code.
    expect(await run({ "src/api.ts": "new Agent({ rejectUnauthorized: false })\n" })).toHaveLength(1)
  })

  it("skips eval / new Function in tests — those are usually the thing under test", async () => {
    expect(await run({ "src/theme-init.test.ts": "new Function(script)()\n" })).toHaveLength(0)
    expect(await run({ "src/eval.test.ts": "eval(userInput)\n" })).toHaveLength(0)
  })

  it("ignores vendored and generated code, which is not ours to fix", async () => {
    expect(
      await run({
        "node_modules/lib/index.js": "eval(x)\n",
        "dist/bundle.js": "eval(x)\n",
        "vendor/thing.js": "eval(x)\n",
        "static/app.min.js": "eval(x)\n",
      }),
    ).toHaveLength(0)
  })

  it("reports one finding per line even when several rules match", async () => {
    const issues = await run({ "src/a.ts": "eval(new Function(src))\n" })
    expect(issues).toHaveLength(1)
  })

  it("attaches blame age so a fresh regression is distinguishable", async () => {
    const ctx = makeContext({
      files: { "src/a.ts": "const r = eval(userInput)\n" },
      blameAges: { "src/a.ts:1": 400 },
    })
    const issues = await insecureCodeScanner.run(ctx)
    expect(issues[0].ageDays).toBe(400)
  })

  it("produces stable ids so a snooze survives a rescan", async () => {
    const files = { "src/a.ts": "const r = eval(userInput)\n" }
    const first = await run(files)
    const second = await run(files)
    expect(first[0].id).toBe(second[0].id)
    expect(first[0].id).toContain("eval-dynamic")
  })

  it("does not claim token decoding alone proves an authentication bypass", async () => {
    expect(await run({ "src/auth.ts": "jwt.decode(token, { verify: false })\n" })).toHaveLength(0)
  })

  it("flags credentials written to localStorage", async () => {
    const bad = await run({ "src/a.ts": 'localStorage.setItem("authToken", value)\n' })
    expect(bad).toHaveLength(1)
    expect(bad[0].severity).toBe("warning")
    expect(await run({ "src/b.ts": 'localStorage.setItem("theme", "dark")\n' })).toHaveLength(0)
  })

  it("flags dynamic document.write but not a literal", async () => {
    const bad = await run({ "src/a.ts": "document.write(`<p>${name}</p>`)\n" })
    expect(bad).toHaveLength(1)
    expect(bad[0].id).toContain("document-write-dynamic")
    expect(await run({ "src/b.ts": 'document.write("<p>ok</p>")\n' })).toHaveLength(0)
  })
})

describe("insecure-code — 100-repo benchmark false positives", () => {
  const run = (files: Record<string, string>) => insecureCodeScanner.run(makeContext({ files }))

  it.each([
    ["src/url.ts", "const g = /^(?<p>[^:]+):/v.exec(`${url.pathname}${url.search}`)?.groups\n"],
    ["src/db.ts", "db.exec(`create TABLE if not exists ${ddl};`, cb)\n"],
    ["src/ws.js", "const digest = createHash('sha1').update(key + GUID).digest('base64')\n"],
    ["src/md5.ts", "return createHash('md5').update(bytes).digest()\n"],
    ["src/tbtools.py", "class C:\n    def eval(self, code: str):\n        return self.console.eval(code)\n"],
    ["src/_make.py", "bytecode = compile(script, filename, 'exec')\neval(bytecode, globs, locs)\n"],
    ["tests/test_black.py", "py3_only = \"exec(x, end=y)\"\n"],
    ["src/jsx/types.ts", "interface A {\n  dangerouslySetInnerHTML?: {\n    __html: string\n  }\n}\n"],
    ["src/Style.jsx", "<style dangerouslySetInnerHTML={{\n  __html: `.a { color: red }`\n}} />\n"],
    ["examples/ssl.js", "new WebSocket(url, { rejectUnauthorized: false })\n"],
    ["scripts/bump.js", "execSync(`npm version ${version}`)\n"],
    ["test/data/jquery-3.7.1.js", "tmp.innerHTML = wrap[1] + x + wrap[2];\n"],
  ])("ignores %s", async (file, code) => {
    expect(await run({ [file]: code })).toEqual([])
  })

  it("still flags a real shell interpolation and a password hashed with MD5", async () => {
    expect(await run({ "src/run.js": "exec(`git clone ${url}`)\n" })).toHaveLength(1)
    expect(await run({ "src/auth.js": "const password = createHash('md5').update(pw).digest('hex')\n" })).toHaveLength(1)
    expect(await run({ "src/v.py": "eval(user_input)\n" })).toHaveLength(1)
  })
})

describe("insecure-code — taint-gated confidence", () => {
  const scan = async (files: Record<string, string>) =>
    (await insecureCodeScanner.run(makeContext({ files }))).map((i) => `${i.id.split("-src")[0]} ${i.confidence}`)

  it("vouches for an injection only when untrusted input is in sight", async () => {
    expect(
      await scan({
        "src/a.js": "app.get('/x', (req, res) => {\n  const n = req.query.name\n  exec(`ls ${n}`)\n})\n",
        "src/b.js": "function build(dir) {\n  exec(`ls ${dir}`)\n}\n",
      }),
    ).toEqual(["insecure-exec-interpolated high", "insecure-exec-interpolated low"])
  })
})

describe("insecure-code — PHP and Java injections (DVWA, WebGoat)", () => {
  const scan = async (files: Record<string, string>) =>
    (await insecureCodeScanner.run(makeContext({ files }))).map((i) => `${i.rule ?? i.id.split("-src")[0]} ${i.confidence}`)

  it("finds the textbook PHP injections with request input in sight", async () => {
    const out = await scan({
      "src/low.php":
        "<?php\n$id = $_GET['id'];\n$query = \"SELECT first_name FROM users WHERE user_id = '$id';\";\n" +
        "$result = mysqli_query($conn, $query);\n$cmd = shell_exec('ping -c 4 ' . $_REQUEST['ip']);\n" +
        "include($_GET['page']);\necho 'Hello ' . $_GET['name'];\n",
    })
    expect(out.map((o) => o.split(" ")[0]).sort()).toEqual(
      expect.arrayContaining([
        expect.stringContaining("sql-interpolated"),
        expect.stringContaining("exec-interpolated"),
        expect.stringContaining("php-include-user-input"),
        expect.stringContaining("php-reflected-xss"),
      ]),
    )
    expect(out.every((o) => o.endsWith("high"))).toBe(true)
  })

  it("finds Java SQL concatenation next to request.getParameter", async () => {
    const out = await scan({
      "src/Lesson.java":
        "String name = request.getParameter(\"name\");\n" +
        "ResultSet rs = stmt.executeQuery(\"SELECT * FROM users WHERE name = '\" + name + \"'\");\n",
    })
    expect(out).toEqual([expect.stringMatching(/sql-interpolated.* high$/)])
  })

  it("leaves a prepared statement alone", async () => {
    const out = await scan({
      "src/Ok.java": 'PreparedStatement ps = c.prepareStatement("SELECT * FROM users WHERE name = ?");\nps.setString(1, name);\n',
    })
    expect(out).toEqual([])
  })
})

describe("insecure-code — Ruby, Go and C# injections (RailsGoat, govwa, WebGoat.NET)", () => {
  const scan = async (files: Record<string, string>) =>
    (await insecureCodeScanner.run(makeContext({ files }))).map((i) => `${i.rule ?? i.id} ${i.confidence}`)

  it("finds Rails SQL interpolation, shell and dispatch with params in sight", async () => {
    const out = await scan({
      "app/controllers/users_controller.rb":
        "def show\n  @user = User.where(\"id = '#{params[:id]}'\").first\n  `ping #{params[:host]}`\n" +
        "  klass = params[:type].constantize\nend\n",
    })
    expect(out.map((o) => o.split(" ")[0])).toEqual(
      expect.arrayContaining([
        expect.stringContaining("sql-interpolated"),
        expect.stringContaining("exec-interpolated"),
        expect.stringContaining("ruby-dynamic-dispatch"),
      ]),
    )
    expect(out.every((o) => o.endsWith("high"))).toBe(true)
  })

  it("leaves instance_eval blocks and placeholders alone", async () => {
    const out = await scan({
      "lib/dsl.rb": "config.instance_eval do\n  x = 1\nend\nUser.where(\"name = ?\", name)\n",
    })
    expect(out).toEqual([])
  })

  it("finds Go Sprintf SQL next to r.FormValue", async () => {
    const out = await scan({
      "handler.go":
        'id := r.FormValue("id")\nquery := fmt.Sprintf("SELECT * FROM users WHERE id = %s", id)\nrows, _ := db.Query(query)\n',
    })
    expect(out).toEqual([expect.stringMatching(/sql-interpolated.* high$/)])
  })

  it("finds C# SqlCommand concatenation next to Request.Query", async () => {
    const out = await scan({
      "Controllers/Users.cs":
        'var name = Request.Query["name"];\nvar cmd = new SqlCommand("SELECT * FROM Users WHERE Name = \'" + name + "\'", conn);\n',
    })
    expect(out).toEqual([expect.stringMatching(/sql-interpolated.* high$/)])
  })
})

describe("insecure-code — Python SQL and SSRF (VAmPI, SSRF lab)", () => {
  const scan = async (files: Record<string, string>) =>
    (await insecureCodeScanner.run(makeContext({ files }))).map((i) => `${i.rule ?? i.id} ${i.confidence}`)

  it("finds an f-string query fed by the request", async () => {
    const out = await scan({
      "api/users.py":
        "username = request.args.get('name')\nuser_query = f\"SELECT * FROM users WHERE username = '{username}'\"\n" +
        "db.session.execute(text(user_query))\n",
    })
    expect(out).toEqual([expect.stringMatching(/sql-interpolated.* high$/)])
  })

  it("leaves a bound-parameter query alone", async () => {
    expect(await scan({ "api/ok.py": 'cur.execute("SELECT * FROM users WHERE name = %s", (name,))\n' })).toEqual([])
  })

  it("finds SSRF when a request URL reaches the fetch", async () => {
    const out = await scan({
      "app/fetch.php": "<?php\n$url = $_POST['url'];\necho file_get_contents($url);\n",
      "src/proxy.js": "app.get('/p', async (req, res) => {\n  const r = await fetch(req.query.target)\n})\n",
    })
    expect(out.sort()).toEqual([expect.stringMatching(/ssrf.* high$/), expect.stringMatching(/ssrf.* high$/)])
  })

  it("keeps a library's fetch of its own variable at low confidence", async () => {
    const out = await scan({ "src/client.js": "export function get(url) {\n  return fetch(url)\n}\n" })
    expect(out).toEqual([expect.stringMatching(/ssrf.* low$/)])
  })
})

describe("insecure-code — cross-file taint", () => {
  const scan = async (files: Record<string, string>) =>
    (await insecureCodeScanner.run(makeContext({ files }))).map((i) => `${i.location} ${i.confidence}`)

  it("links a model's f-string SQL to a view that passes request input (VAmPI)", async () => {
    const out = await scan({
      "models/user_model.py":
        "class User:\n    @staticmethod\n    def get_user(username):\n" +
        "        user_query = f\"SELECT * FROM users WHERE username = '{username}'\"\n" +
        "        return db.session.execute(text(user_query))\n",
      "api_views/users.py":
        "def get_by_username(username):\n    user = User.get_user(request.args.get('name'))\n    return user\n",
    })
    expect(out).toEqual(["models/user_model.py:4 high"])
  })

  it("links a C# helper to a WebForms page reading a TextBox (WebGoat.NET)", async () => {
    const out = await scan({
      "Code/DatabaseUtilities.cs":
        "public class DatabaseUtilities {\n    public string GetEmailByUserID(string userid)\n    {\n" +
        "        string sql = \"SELECT Email FROM UserList WHERE UserID = '\" + userid + \"'\";\n        return DoScalar(sql);\n    }\n}\n",
      "Content/Lookup.aspx.cs": "protected void btn_Click(object s, EventArgs e) {\n    lblEmail.Text = du.GetEmailByUserID(txtUserID.Text);\n}\n",
    })
    expect(out).toEqual(["Code/DatabaseUtilities.cs:4 high"])
  })

  it("stays low when no caller passes request input", async () => {
    const out = await scan({
      "models/report.py":
        "def monthly_report(table_name):\n    q = f\"SELECT * FROM {table_name} WHERE month = 1\"\n    return db.execute(q)\n",
      "jobs/cron.py": "def nightly():\n    monthly_report('orders')\n",
    })
    expect(out).toEqual(["models/report.py:2 low"])
  })
})

describe("insecure-code false-positive clusters (benchmark batch 12–15)", () => {
  const run = async (files: Record<string, string>) => (await insecureCodeScanner.run(makeContext({ files }))).map((i) => i.id)
  it("ignores a method named eval on an object", async () => {
    expect(await run({ "app/models/lock.rb": "def take(key)\n  LUA_HGET_DEL.eval(redis, keys: [key])\nend\n" })).toEqual([])
  })
  it("ignores new Function for an imported Function class", async () => {
    expect(await run({ "index.ts": 'import { Function } from "@pulumi/aws/cloudfront"\nexport const f = new Function(name, state, opts)\n' })).toEqual([])
  })
  it("ignores readObject on a JSON reader", async () => {
    expect(await run({ "src/Main.java": "class M { void r(JsonReader reader) { JsonObject o = reader.readObject(); } }\n" })).toEqual([])
  })
  it("ignores a BinaryFormatter that only serialises", async () => {
    expect(await run({ "Save.cs": "var f = new BinaryFormatter();\nf.Serialize(stream, data);\n" })).toEqual([])
  })
  it("ignores ruamel.yaml load and literal shell=True commands", async () => {
    expect(await run({
      "a.py": "from ruamel.yaml import YAML\nyaml = YAML()\ndata = yaml.load(stream)\n",
      "b.py": 'import subprocess\nsubprocess.run("hl-smi", shell=True)\n',
    })).toEqual([])
  })
})
