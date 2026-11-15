import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { STATS_CONTROL_NAME_RE, SECURITY_CONTROL_NAME_RE } from "./control-names.mjs"

test("all 56 frozen training controls remain in the statistics cohort", () => {
  const controls = JSON.parse(readFileSync(new URL("./reviews/2026-11-15-1-controls.json", import.meta.url)))
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
