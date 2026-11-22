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
