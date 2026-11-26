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

describe("php-taint — stored XSS through model fields", () => {
  const xssIn = async (files: Record<string, string>, file: string) =>
    (await phpTaintScanner.run(makeContext({ files }))).filter((i) => i.rule === "php-taint-xss" && i.location.startsWith(file))

  it("a setter fed from the request, a getter echoed elsewhere", async () => {
    const save = `<?php\n$site = Site::current();\n$site->setSiteName($_POST['site_name']);\n$site->save();\n`
    const show = `<?php\n$site = Site::current();\necho '<h1>' . $site->getSiteName() . '</h1>';\n`
    const found = await xssIn({ "settings/save.php": save, "views/header.php": show }, "views/header.php")
    expect(found).toHaveLength(1)
    expect(found[0].confidence).toBe("medium")
    expect((found[0].flow ?? []).some((s) => /setSiteName|->SiteName/i.test(s.text))).toBe(true)
  })

  it("keyed set/getValue and an ORM create with an array, read as a property", async () => {
    const save = `<?php\n$album->setValue('pho_name', $_POST['name']);\n$album->save();\nPost::create(['title' => $request->input('title'), 'id' => $_GET['id']]);\n`
    const show = `<?php\necho "<td>" . $album->getValue('pho_name') . "</td>";\necho "<h2>{$post->title}</h2>";\necho $post->id;\n`
    const found = await xssIn({ "save.php": save, "list.php": show }, "list.php")
    expect(found.map((i) => i.location).sort()).toEqual(["list.php:2", "list.php:3"])
  })

  it("escaped on output, escaped before storing, or never from the request: nothing", async () => {
    const save = `<?php\n$site->setSiteName($_POST['n']);\n$page->setHeading(htmlspecialchars($_POST['h']));\n$page->setFooter('static text');\n`
    const show = `<?php\necho htmlspecialchars($site->getSiteName());\necho $page->getHeading();\necho $page->getFooter();\n`
    expect(await xssIn({ "save.php": save, "show.php": show }, "show.php")).toEqual([])
  })
})

describe("php-taint — model fields: only what is saved, only on models", () => {
  const xssIn = async (files: Record<string, string>, file: string) =>
    (await phpTaintScanner.run(makeContext({ files }))).filter((i) => i.rule === "php-taint-xss" && i.location.startsWith(file))

  it("runtime config, view objects and unsaved objects are not storage", async () => {
    const save = `<?php\nAmpConfig::set('site_charset', $_GET['c'], true);\n$view->pageTitle = $_GET['t'];\n$draft->setDraftTitle($_POST['d']);\n`
    const show = `<?php\necho AmpConfig::get('site_charset');\necho $view->pageTitle;\necho $draft->getDraftTitle();\n`
    expect(await xssIn({ "save.php": save, "show.php": show }, "show.php")).toEqual([])
  })
})
