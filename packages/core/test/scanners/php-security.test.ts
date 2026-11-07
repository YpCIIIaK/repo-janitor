import { describe, expect, it } from "vitest"
import { scanPhpSecurity } from "../../src/scanners/php-security"
const rules = (code: string) => scanPhpSecurity(code).map(hit => hit.rule.id)
describe("PHP request-to-sink coverage", () => {
  it("finds request-selected files and aliases", () => {
    expect(rules("$path = $_GET['file'];\n$alias = $path;\nreadfile($alias);")).toContain("php-path-traversal")
    expect(rules("file_get_contents($_POST['path']);")).toContain("php-path-traversal")
  })
  it("permits fixed paths, sanitized names, resets, comments and strings", () => {
    for (const code of ["readfile('/srv/data.txt');", "$path = basename($_GET['file']);\nreadfile($path);", "$path = $_GET['file'];\n$path = '/srv/static';\nreadfile($path);", "// readfile($_GET['file']);", "/*\nreadfile($_GET['file']);\n*/", "$example = 'readfile($_GET[file])';", "$path = $_GET['file'];\nfunction safe() {\nreadfile($path);\n}"]) expect(rules(code)).not.toContain("php-path-traversal")
  })
  it("requires tainted XML and explicit external entity options", () => {
    expect(rules("$xml = $_POST['xml'];\n$doc->loadXML($xml, LIBXML_NOENT | LIBXML_NONET);")).toContain("php-xxe")
    expect(rules("simplexml_load_string($_POST['xml'], 'SimpleXMLElement', LIBXML_DTDLOAD);")).toContain("php-xxe")
    for (const code of ["$doc->loadXML($_POST['xml']);", "simplexml_load_string('<root/>', 'SimpleXMLElement', LIBXML_NOENT);", "$doc->loadXML($_POST['xml'], LIBXML_NOENT | LIBXML_NO_XXE);"]) expect(rules(code)).not.toContain("php-xxe")
  })
  it("requires Twig and tainted template source, not template data", () => {
    expect(rules("$twig = new Twig\\Environment($loader);\n$template = $_GET['template'];\n$twig->createTemplate($template);")).toContain("php-ssti")
    for (const code of ["$twig = new Twig\\Environment($loader);\n$twig->render('page.twig', ['name' => $_GET['name']]);", "$twig = new Twig\\Environment($loader);\n$twig->createTemplate('Hello {{ name }}');", "$service->createTemplate($_GET['template']);"]) expect(rules(code)).not.toContain("php-ssti")
  })
})
