import { describe, it, expect } from "vitest"
import { guardedNearby } from "../../src/scanners/php-taint/index"
import { DB_RECEIVER } from "../../src/scanners/php-taint/model"

describe("php-taint — precision levers (deep-PHP review 2026-11-17)", () => {
  it("an allowlist lookup on the same key bounds the value; isset() on the superglobal does not", () => {
    const allow = `} elseif (!isset($formats[$_POST['format']])) {\n echo 'bad';\n} else {\n echo $_POST['format'];\n`
    expect(guardedNearby(allow, 4, "$_POST['format']", "xss")).toBe(true)
    const presence = `if (isset($_POST['username'])) {\n $usr = $_POST['username'];\n $mysqli->query($sql);\n`
    expect(guardedNearby(presence, 3, "$_POST['username']", "sql")).toBe(false)
  })
  it("a redirect checked against the site's own host is not open", () => {
    const same = `$referer = request()->headers->get('referer');\nif (parse_url($referer, PHP_URL_HOST) === request()->getHost()) {\n return redirect($referer);\n`
    expect(guardedNearby(same, 3, "request()->headers->get('referer')", "redirect")).toBe(true)
  })
  it("DB receivers are judged by whole words, not substrings", () => {
    expect(DB_RECEIVER.test("$this->db")).toBe(true)
    expect(DB_RECEIVER.test("$entityManager")).toBe(true)
    expect(DB_RECEIVER.test("$mysqli")).toBe(true)
    expect(DB_RECEIVER.test("$this->measurementFamilyRepository")).toBe(false)
    expect(DB_RECEIVER.test("$this->emailRepository")).toBe(false)
  })
})

describe("php-taint — numbers by declaration", () => {
  const run = async (src: string) => (await (await import("../../src/scanners/php-taint")).phpTaintScanner.run((await import("../helpers")).makeContext({ files: { "a.php": src } }))).map((i) => `${i.rule}@${i.location}`)

  it("an int-typed parameter is a number inside the function", async () => {
    const src = `<?php\nfunction del(int $id, string $name) {\n  global $db;\n  $db->query("DELETE FROM t WHERE id = " . $id);\n  $db->query("DELETE FROM t WHERE name = '" . $name . "'");\n}\ndel($_GET['id'], $_GET['name']);\n`
    const out = await run(src)
    expect(out.filter((r) => r.startsWith("php-taint-sqli"))).toHaveLength(1)
  })

  it("sprintf: %d and %2$u print numbers, %s keeps text", async () => {
    const src = `<?php\n$q = sprintf('SELECT * FROM t WHERE id = %d AND u = %2$u', $_GET['id'], $_GET['u']);\nmysqli_query($c, $q);\n$r = sprintf("SELECT * FROM t WHERE n = '%s' AND id = %d", $_GET['n'], $_GET['id']);\nmysqli_query($c, $r);\n`
    expect(await run(src)).toEqual(["php-taint-sqli@a.php:5"])
  })
})
