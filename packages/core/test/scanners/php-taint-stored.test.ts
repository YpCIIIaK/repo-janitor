import { describe, it, expect } from "vitest"
import { phpTaintScanner } from "../../src/scanners/php-taint"
import { makeContext } from "../helpers"

const write = (escape: string) =>
  `<?php\n$name = ${escape}($_POST['name']);\nmysqli_query($conn, "INSERT INTO guestbook (name) VALUES ('" . mysqli_real_escape_string($conn, $name) . "')");\n`
const read = `<?php\n$result = mysqli_query($conn, "SELECT name FROM guestbook");\nwhile ($row = mysqli_fetch_row($result)) {\n  echo "<p>" . $row[0] . "</p>";\n}\n`

describe("php-taint — stored XSS (DVWA xss_s)", () => {
  it("request data written to a table and echoed when read back is reported, with both halves in the flow", async () => {
    const issues = await phpTaintScanner.run(makeContext({ files: { "sign.php": write("trim"), "book.php": read } }))
    const xss = issues.find((i) => i.rule === "php-taint-xss" && i.location.startsWith("book.php"))
    expect(xss).toBeDefined()
    const texts = (xss?.flow ?? []).map((s) => s.text)
    expect(texts.some((t) => /INSERT INTO guestbook/.test(t))).toBe(true)
    expect(texts.some((t) => /SELECT … FROM guestbook/.test(t))).toBe(true)
  })
  it("HTML-escaped before it is stored: nothing to report", async () => {
    const issues = await phpTaintScanner.run(makeContext({ files: { "sign.php": write("htmlspecialchars"), "book.php": read } }))
    expect(issues.some((i) => i.rule === "php-taint-xss" && i.location.startsWith("book.php"))).toBe(false)
  })
})
