import { describe, it, expect } from "vitest"
import { scanSource } from "../../src/index"
import { confidenceOf } from "../../src/confidence"

const rules = (src: string, lang: Parameters<typeof scanSource>[1]) => scanSource(src, lang).map((h) => h.rule.id)

/** One vulnerable and one safe shape per rule, taken from GitHub-advisory fixes. */
describe("insecure-code — harvested sink rules (Nov 2026)", () => {
  it("py-xxe: lxml parser without resolve_entities=False, ElementTree on a response", () => {
    expect(rules(`from lxml import etree\noxml_parser = etree.XMLParser(remove_blank_text=True)\n`, "py")).toContain("py-xxe")
    expect(rules(`from lxml import etree\noxml_parser = etree.XMLParser(remove_blank_text=True, resolve_entities=False)\n`, "py")).not.toContain("py-xxe")
    expect(rules(`import xml.etree.ElementTree as xml\nroot = xml.fromstring(resp.content)\n`, "py")).toContain("py-xxe")
    expect(rules(`from defusedxml import ElementTree as safe_xml\nroot = safe_xml.fromstring(resp.content)\n`, "py")).not.toContain("py-xxe")
    expect(rules(`from xml.dom.minidom import parseString\ndoc = parseString(stream.read())\n`, "py")).toContain("py-xxe")
    expect(rules(`from lxml import etree\ntree = etree.parse(xmlf, parser=parser2)\n`, "py")).not.toContain("py-xxe")
    // Not an XML module: json, a project's own parse().
    expect(rules(`import json\ndata = json.parse(body)\nresult = parser.parse(text)\n`, "py")).not.toContain("py-xxe")
  })

  it("py-unsafe-deserialization: torch.load without weights_only, shelve", () => {
    expect(rules(`import torch\nstate_dict = torch.load(join(a, b), map_location="cpu")\n`, "py")).toContain("py-unsafe-deserialization")
    expect(rules(`import torch\nstate_dict = torch.load(join(a, b), weights_only=True)\n`, "py")).not.toContain("py-unsafe-deserialization")
    expect(rules(`import shelve\nwith shelve.open(str(location)) as sh:\n    pass\n`, "py")).toContain("py-unsafe-deserialization")
  })

  it("py-random-for-secret: OTP and password from random, not from secrets", () => {
    expect(rules(`import random\ndef generate_nonce(length=8):\n    return ''.join([str(random.randint(0, 9)) for i in range(length)])\n`, "py")).toContain("py-random-for-secret")
    expect(rules(`import random\nPasseoPassword = ''.join(random.sample(password, length))\n`, "py")).toContain("py-random-for-secret")
    expect(rules(`import random\ndef pick_color():\n    return random.choice(COLORS)\n`, "py")).not.toContain("py-random-for-secret")
    expect(rules(`import random\nrandom.shuffle(tokens)\n`, "py")).not.toContain("py-random-for-secret")
    expect(rules(`import numpy as np\ntoken = np.random.choice(vocab)\n`, "py")).not.toContain("py-random-for-secret")
  })

  it("sql-builder-interpolated: gorm Where with Sprintf, hand-quoted '%s'", () => {
    const head = `import (\n\t"fmt"\n\t"gorm.io/gorm"\n)\n`
    expect(rules(`${head}db.Where(fmt.Sprintf("name = '%s'", name)).Find(&u)\n`, "go")).toContain("sql-builder-interpolated")
    expect(rules(`${head}db.Where("name = ?", name).Find(&u)\n`, "go")).not.toContain("sql-builder-interpolated")
    expect(rules(`import "database/sql"\nfunc f() { values += fmt.Sprintf("'%s',", value) }\n`, "go")).toContain("sql-builder-interpolated")
    // No database in the file: a log message is not SQL.
    expect(rules(`import "fmt"\nmsg := fmt.Sprintf("user '%s' not found", name)\n`, "go")).not.toContain("sql-builder-interpolated")
  })

  it("go-archive-path-traversal: zip entry name joined onto the target dir", () => {
    const vuln = `import "archive/zip"\nfunc x() {\n\toutfile, err := os.Create(filepath.Join(tempdir, f.Name))\n}\n`
    expect(rules(vuln, "go")).toContain("go-archive-path-traversal")
    const safe = `import "archive/zip"\nfunc x() {\n\tn := filepath.Join(p, f.Name)\n\tif !strings.HasPrefix(n, p) { return }\n}\n`
    expect(rules(safe, "go")).not.toContain("go-archive-path-traversal")
  })

  it("java-code-injection: SpEL on a computed string unless the context is restricted", () => {
    const head = "import org.springframework.expression.spel.standard.SpelExpressionParser;\n"
    expect(rules(`${head}Object v = parser.parseExpression(expr).getValue(ctx);\n`, "java")).toContain("java-code-injection")
    expect(rules(`${head}import org.springframework.expression.spel.support.SimpleEvaluationContext;\nObject v = parser.parseExpression(expr).getValue(SimpleEvaluationContext.forReadOnlyDataBinding().build());\n`, "java")).not.toContain("java-code-injection")
    expect(rules(`${head}Object v = parser.parseExpression("1 + 1").getValue();\n`, "java")).not.toContain("java-code-injection")
  })

  it("new rules start at low confidence until labelled", () => {
    expect(confidenceOf("insecure-py-xxe")).toBe("low")
    expect(confidenceOf("insecure-sql-builder-interpolated")).toBe("low")
    expect(confidenceOf("insecure-never-heard-of")).toBe("medium")
  })
})

describe("insecure-code — sink rule precision levers (corpus review 2026-11-21)", () => {
  it("py-xxe: stdlib parser on a local file or tool reply is not reported; on a response it is", () => {
    expect(rules(`import xml.etree.ElementTree as ET\nroot = ET.fromstring(xml_text)\n`, "py")).not.toContain("py-xxe")
    expect(rules(`from xml.etree import ElementTree\ntree = ElementTree.parse(file_path)\n`, "py")).not.toContain("py-xxe")
    expect(rules(`import xml.etree.ElementTree as ET\nroot = ET.fromstring(resp.content)\n`, "py")).toContain("py-xxe")
    expect(rules(`from lxml import etree\ntree = etree.parse(xmlf)\n`, "py")).toContain("py-xxe")
  })
  it("a //nolint:gosec or # nosec directive on the line above counts as reviewed", () => {
    const go = `import "archive/zip"\nfunc x() {\n\t//nolint:gosec\n\tfilePath := filepath.Join(dstDir, f.Name)\n}\n`
    expect(rules(go, "go")).not.toContain("go-archive-path-traversal")
    expect(rules(`import pickle\n# nosec B301\ndata = pickle.loads(blob)\n`, "py")).not.toContain("py-pickle-load")
  })
})
