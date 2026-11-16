import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { STATS_CONTROL_NAME_RE, SECURITY_CONTROL_NAME_RE } from "./control-names.mjs"

// The control list is private data (benchmark/private.mjs pull); CI on the public repo has no copy.
const controlsFile = new URL("./reviews/2026-11-15-1-controls.json", import.meta.url)
test("all 56 frozen training controls remain in the statistics cohort", { skip: !existsSync(controlsFile) && "private data not pulled" }, () => {
  const controls = JSON.parse(readFileSync(controlsFile))
  assert.equal(Object.keys(controls).length, 56)
  for (const name of Object.keys(controls)) assert.equal(STATS_CONTROL_NAME_RE.test(name), true, name)
})

test("known Goat labs retain their name-based cohort membership", () => {
  for (const name of ["webgoat-webgoat", "owasp-owaspwebgoatphp", "owasp-igoat-swift", "bridgecrewio-cfngoat", "bridgecrewio-terragoat", "owasp-nodegoat", "owasp-railsgoat", "rhinosecuritylabs-cloudgoat", "madhuakula-kubernetes-goat", "soham7-dev-aspgoat"]) {
    assert.equal(STATS_CONTROL_NAME_RE.test(name), true, name)
    assert.equal(SECURITY_CONTROL_NAME_RE.test(name), true, name)
  }
})

test("unrelated names containing goat are not labelled deliberately vulnerable labs", () => {
  for (const name of ["kdudkov-goatak", "arp242-goatcounter", "guacsec-goatrodeo"]) {
    assert.equal(STATS_CONTROL_NAME_RE.test(name), false, name)
    assert.equal(SECURITY_CONTROL_NAME_RE.test(name), false, name)
  }
})
