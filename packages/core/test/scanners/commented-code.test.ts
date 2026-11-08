import { describe, it, expect } from "vitest"
import { commentedCodeScanner } from "../../src/index"
import { makeContext } from "../helpers"

describe("commentedCodeScanner", () => {
  it("flags a run of 3+ commented-out code lines", async () => {
    const ctx = makeContext({
      files: {
        "a.ts": [
          "function f() {",
          "  // const x = compute();",
          "  // doThing(x);",
          "  // return x + 1;",
          "  return 0",
          "}",
        ].join("\n"),
      },
    })
    const issues = await commentedCodeScanner.run(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].title).toContain("3 lines")
    expect(issues[0].location).toBe("a.ts:2")
  })

  it("does NOT flag ordinary prose comments", async () => {
    const ctx = makeContext({
      files: {
        "a.ts": [
          "// This function computes the thing.",
          "// It handles the edge cases too.",
          "// See the docs for more details.",
          "function f() { return 1 }",
        ].join("\n"),
      },
    })
    expect(await commentedCodeScanner.run(ctx)).toHaveLength(0)
  })

  it("does not flag a short (2-line) commented block", async () => {
    const ctx = makeContext({
      files: { "a.ts": "// const x = 1;\n// foo(x);\nconst y = 2\n" },
    })
    expect(await commentedCodeScanner.run(ctx)).toHaveLength(0)
  })

  it("skips eslint/ts directive comments", async () => {
    const ctx = makeContext({
      files: {
        "a.ts": [
          "// eslint-disable-next-line",
          "// @ts-expect-error something",
          "// prettier-ignore",
          "const y = 2",
        ].join("\n"),
      },
    })
    expect(await commentedCodeScanner.run(ctx)).toHaveLength(0)
  })
})

describe("commented-code — documentation examples", () => {
  const count = async (content: string) =>
    (await commentedCodeScanner.run(makeContext({ files: { "src/a.go": content } }))).length

  it("skips a Go doc example indented after the marker", async () => {
    expect(await count('// GetQuery returns a value.\n//\n//\tGET /?name=Manu&lastname=\n//\t("Manu", true) == c.GetQuery("name")\n//\t("", false) == c.GetQuery("id")\nfunc x() {}\n')).toBe(0)
  })
  it("skips an example introduced by a colon and bullet lists", async () => {
    expect(await count("// Testing for these options:\n// --inspect[=[host:]port]\n// --inspect-brk[=[host:]port]\n// --inspect-port=[host:]port\n")).toBe(0)
    expect(await count("// Order:\n//   * PreRun()\n//   * Run()\n//   * PostRun()\n")).toBe(0)
  })
  it("still flags plain commented-out statements", async () => {
    expect(await count("x := 1\n// a := foo();\n// b := bar(a);\n// baz(a, b);\n")).toBe(1)
  })
})

describe("commented-code — input schemas and complete documentation blocks", () => {
  const scan = (path: string, source: string) => commentedCodeScanner.run(makeContext({ files: { [path]: source } }))

  it("ignores XML input schemas in Java parser documentation", async () => {
    expect(await scan("src/XMLConfigBuilder.java", [
      '// <dataSource type="POOLED">',
      '//   <property name="driver" value="${driver}"/>',
      '//   <property name="url" value="${url}"/>',
      '// </dataSource>',
      'void parse() {}',
    ].join("\n"))).toHaveLength(0)
    expect(await scan("src/XMLMapperBuilder.java", [
      '// Identifier ("resultMap[userResultMap]")',
      '// <resultMap id="userResultMap" type="User">',
      '//   <id property="id" column="user_id"/>',
      '//   <result property="username" column="username"/>',
      '// </resultMap>',
    ].join("\n"))).toHaveLength(0)
  })

  it("ignores the commented SQL schema explaining a binary Go test fixture", async () => {
    expect(await scan("replication/row_event_test.go", [
      'func TestEnum(t *testing.T) {',
      '// CREATE TABLE numbers (',
      '// id int auto_increment,',
      "// num ENUM('0', '1', '256')",
      '',
      '// ),',
      '// primary key(id)',
      '// );',
      'data := []byte("fixture")',
      '}',
    ].join("\n"))).toHaveLength(0)
  })

  it("does not read apparent line comments inside block documentation as code", async () => {
    expect(await scan("source/index.ts", [
      '/**',
      '@example',
      '```',
      'console.log(tasks);',
      '// }, {',
      "//   id: 'next',",
      '//   priority: 1,',
      '//   startTime: 123,',
      '// }]',
      '```',
      '*/',
      'function tasks() {}',
    ].join("\n"))).toHaveLength(0)
  })

  it("keeps an example introduction across multiple runs in one comment paragraph", async () => {
    expect(await scan("src/runtime.js", [
      '// This transform is used like this:',
      '// var mark = signature()',
      '//',
      '// function Hello() {',
      '//   const value = useState(0);',
      '//   mark();',
      '//   return value;',
      '// }',
      '//',
      '// mark(',
      '//   Hello,',
      "//   'state(value)',",
      '//   () => [useState],',
      '// );',
    ].join("\n"))).toHaveLength(0)
  })

  it("keeps genuine disabled implementations and JSX even beside ordinary comments", async () => {
    expect(await scan("src/parser.java", [
      '/** Parse a documented input. */',
      '// Parser old = new Parser();',
      '// old.parse(input);',
      '// return old.result();',
    ].join("\n"))).toHaveLength(1)
    expect(await scan("src/View.tsx", [
      '// const view = <section title="old">;',
      '// const child = <span role="text">;',
      '// return <Widget value="old"/>;',
    ].join("\n"))).toHaveLength(1)
  })

  it("does not turn comment markers inside strings or line comments into block comments", async () => {
    expect(await scan("src/parser.ts", [
      'const marker = "/*";',
      '// legacy.start(); /* old annotation',
      '// legacy.parse(input);',
      '// legacy.end();',
      '// legacy.cleanup();',
    ].join("\n"))).toHaveLength(1)
  })
})

it("preserves disabled implementations using samples or followed by sample-stream prose", async () => {
  const cases = {
    "src/analysis.js": "// const samples = collect();\n// print(samples);\n// return samples;\n",
    "src/histogram.go": "// numBuckets := 1\n// for i := range bounds {\n// bounds[i] = make([]float64, numBuckets)\n// }\n// A histogram counts observations in a sample stream.\n",
  }
  for (const [path, source] of Object.entries(cases)) {
    expect(await commentedCodeScanner.run(makeContext({ files: { [path]: source } }))).toHaveLength(1)
  }
})


describe("commented-code — non-code table grammar", () => {
  const scan = (file: string, lines: string[]) => commentedCodeScanner.run(makeContext({ files: { [file]: lines.join("\n") } }))
  it("ignores bit-field equations rather than treating numeric equalities as assignments", async () => {
    expect(await scan("replication/time.go", [
      "// year*13+month = 25611 = 0b110010000001011",
      "// day = 1 = 0b00001", "// hour = 0 = 0b00000", "// minute = 0 = 0b000000",
    ])).toHaveLength(0)
  })
  it("ignores type placeholder tables and numbered index-to-container diagrams", async () => {
    expect(await scan("src/decl.go", [
      "// [int], [int] := range [string]", "// [int], [value] := range [slice or array]",
      "// [key], [value] := range [map]", "// [value], [nil] := range [chan]",
    ])).toHaveLength(0)
    expect(await scan("src/util_test.go", [
      "// Index 0 -> init container 0 (empty)", "// Index 1 -> init container 1 (empty)",
      "// Index 2 -> regular container 0 (has device, regularIdx = 2 - 2 = 0)",
    ])).toHaveLength(0)
  })
  it("ignores ASCII field layouts and annotated numeric key-code tables", async () => {
    expect(await scan("src/Image.cc", [
      '// Read the IFD0 ("Image File Directory 0")',
      "// | NN |                     n entries in directory (2 bytes)",
      "// | TT | tt | nnnn | vvvv |  entry: tag (2b), data type (2b),",
      "//                             n components (4b), value/offset (4b)",
    ])).toHaveLength(0)
    expect(await scan("src/tcell_test.go", [
      "// KeyBackspace2 is alias for KeyDEL = 0x7F (ASCII) (allegedly unused by Windows)",
      "// KeyDelete = 0x2E (VK_DELETE constant in Windows)",
      "// KeyBackspace is alias for KeyBS = 0x08 (ASCII) (implicit alias with KeyCtrlH)",
    ])).toHaveLength(0)
  })
  it("preserves valid Go assignments, C++ bitwise expressions, and JS arrows", async () => {
    expect(await scan("src/worker.go", [
      "// count := 1", "// for index, value := range values {", "// process(index, value);", "// }",
    ])).toHaveLength(1)
    expect(await scan("src/flags.cpp", [
      "// auto flags = FIRST | SECOND;", "// flags |= THIRD;", "// return flags;",
    ])).toHaveLength(1)
    expect(await scan("src/worker.js", [
      "// const fn = value => value + 1;", "// const key = 0x7F;", "// return fn(key);",
    ])).toHaveLength(1)
  })
})


describe("commented-code — Kubebuilder markers", () => {
  it.each(["// ", "//"])("preserves CRD generator directives with %s spacing", async (prefix) => {
    const source = [
      '+kubebuilder:object:root=true',
      '+kubebuilder:resource:scope=Cluster',
      '+kubebuilder:printcolumn:name="Members",type="string",JSONPath=".spec.members",description="community members"',
      '+kubebuilder:printcolumn:name="Age",type="date",JSONPath=".metadata.creationTimestamp",description="Age"',
    ].map(body => prefix + body).join("\n")
    expect(await commentedCodeScanner.run(makeContext({ files: { "api/types.go": source } }))).toHaveLength(0)
  })

  it.each(["+kubebuilders:", "+kubebuilderExtra:", "+other:", "+value = "])("retains code-like blocks beginning with %s", async (prefix) => {
    const source = ["first=1;", "second=2;", "third=3;"].map(body => "// " + prefix + body).join("\n")
    expect(await commentedCodeScanner.run(makeContext({ files: { "api/types.go": source } }))).toHaveLength(1)
  })

  it("still reports actual commented code beside CRD markers", async () => {
    const source = [
      "// +kubebuilder:object:root=true",
      "// old := load();",
      "// update(old);",
      "// persist(old);",
      "type Cluster struct {}",
    ].join("\n")
    const issues = await commentedCodeScanner.run(makeContext({ files: { "api/types.go": source } }))
    expect(issues).toHaveLength(1)
    expect(issues[0].location).toBe("api/types.go:2")
  })
})


describe("commented-code — non-host documentation notation", () => {
  const scan = async (source: string, file = "src/parser.go") =>
    commentedCodeScanner.run(makeContext({ files: { [file]: source } }))

  it("preserves SMTP ABNF grammar with numeric terminals", async () => {
    expect(await scan([
      '// esmtp-param = esmtp-keyword ["=" esmtp-value]',
      '// esmtp-keyword = (ALPHA / DIGIT) *(ALPHA / DIGIT / "-")',
      '// esmtp-value = 1*(%d33-60 / %d62-126)',
      'func parse() {}',
    ].join("\n"))).toHaveLength(0)
  })

  it("preserves Redis Lua parameter maps immediately before embedded scripts", async () => {
    expect(await scan([
      '// KEYS[1] = data:{<id>} (LIST)',
      '// KEYS[2] = consumers:{<id>} (SET)',
      '// ARGV[1] = consumerID',
      '//',
      '// Returns: array of strings.',
      'var script = redis.NewScript(`return ARGV[1]`)',
    ].join("\n"))).toHaveLength(0)
  })

  it("preserves labelled UTF bit-layout equations", async () => {
    expect(await scan([
      '// UTF-16 high surrogate: 110110xxxxxxxxxx (10 bits)',
      '// UTF-16 low surrogate: 110111yyyyyyyyyy (10 bits)',
      '// Unicode code point: 00010000000000000000 + xxxxxxxxxxyyyyyyyyyy (21 bits)',
    ].join("\n"), "src/Utf8.kt")).toHaveLength(0)
  })

  it("retains array assignments without Redis embedded-script context", async () => {
    expect(await scan('// KEYS[1] = first;\n// KEYS[2] = second;\n// ARGV[1] = third;\nfunc run() {}')).toHaveLength(1)
  })

  it("retains ordinary code alongside grammar words and bit-width prose", async () => {
    expect(await scan('// grammar = ALPHA;\n// bits = compute(10);\n// emit(bits);')).toHaveLength(1)
  })
})
