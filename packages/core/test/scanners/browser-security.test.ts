import { describe, it, expect } from "vitest"
import { browserSecurityScanner } from "../../src/scanners/browser-security"
import { makeContext } from "../helpers"
const scan = (source: string, file = "src/client.ts") => browserSecurityScanner.run(makeContext({files:{[file]:source}}))
describe("browser trust boundary review", () => {
  it.each([
    'item.innerHTML = `<span>${config.site}</span>`;',
    'item["outerHTML"] = "<div>" + data.name + "</div>";',
    'item.insertAdjacentHTML("beforeend", payload.html);',
    'const markup = `<span>${config.site}</span>`; item.innerHTML = markup;',
  ])("finds structural dynamic HTML sinks: %s", async source => {
    const issues=await scan("const config={}; const data={}; const payload={}; const value=location.hash; " + source.replace(/config.site|data.name|payload.html/g,"value"))
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({rule:"browser-dynamic-html",confidence:"low",severity:"warning"})
    expect(issues[0].detail).toMatch(/not proof|not established|trust boundary/)
  })
  it.each([
    'item.innerHTML = "<p>fixed</p>";',
    'item.innerHTML = unknownMarkup;',
    'item.innerHTML = `<span>${config.site}</span>`;',
    'function f(location){item.innerHTML=location.hash}',
    'function f(localStorage){item.innerHTML=localStorage.getItem("x")}',
    'function f(chrome){chrome.storage.local.get("x",data=>{item.innerHTML=data.x})}',

    'const markup="<p>fixed</p>";item.innerHTML=markup;',
    'item.innerHTML = `<p>${42}</p>`;',
    'item.textContent = data.name;',
    'item.innerHTML = DOMPurify.sanitize(data.html);',
    'const html = DOMPurify.sanitize(data.html);item.innerHTML=html;',
    'item.innerHTML = policy.createHTML(data.html);',
    'const html = renderSafeMarkup(data);item.innerHTML=html;',
    'const text = "item.innerHTML = data.name";',
    '// item.innerHTML = data.name',
  ])("does not claim literal/text/helper results are unsafe: %s",async source => expect(await scan(source)).toEqual([]))
  it("traces extension storage through a collection callback to HTML",async()=>{
    const issues=await scan(`chrome.storage.local.get('configs',data=>{
      data.configs.forEach(config=>{item.innerHTML=\`<span>\${config.site}</span>\`})
    })`)
    expect(issues).toHaveLength(1)
    expect(issues[0].rule).toBe('browser-dynamic-html')
  })
  it("does not leak collection provenance to a shadowed callback parameter",async()=>{
    expect(await scan(`chrome.storage.local.get('configs',data=>{
      data.configs.forEach(config=>{function render(config){item.innerHTML=config.site}})
    })`)).toEqual([])
  })
  it("tracks stored text but excludes textContent and sanitization",async()=>{
    expect(await scan(`const value=localStorage.getItem('html');item.innerHTML=value`)).toHaveLength(1)
    expect(await scan(`const value=localStorage.getItem('html');item.textContent=value`)).toEqual([])
    expect(await scan(`const value=localStorage.getItem('html');const safe=DOMPurify.sanitize(value);item.innerHTML=safe`)).toEqual([])
  })
  it("follows query params to an origin check and outgoing target in nested callbacks",async () => {
    const issues=await scan(`function init(){
      const key='host';const params=new URLSearchParams(window.location.search);
      let allowed=params.get(key);
      if(allowed){localStorage.setItem('host',allowed)}else{allowed=localStorage.getItem('host')}
      window.addEventListener('message',event=>{if(event.origin===allowed){dispatch(event.data)}});
      return {send(data){window.top.postMessage(data,allowed)}};
    }`)
    expect(issues.filter(x=>x.rule==='browser-query-origin')).toHaveLength(2)
    expect(issues.every(x=>x.confidence==='low')).toBe(true)
  })
  it.each(['===','==','!==','!='])("recognizes %s comparisons in either direction",async op=>{
    expect(await scan(`const origin=location.hash;if(origin ${op} event.origin) accept();`)).toHaveLength(1)
  })
  it("tracks aliases and string composition",async()=>{
    expect(await scan(`const p=new URLSearchParams(document.location.search);const x=p.get('host');const origin=x||'https://default.invalid';window.parent.postMessage({},origin);`)).toHaveLength(1)
  })
  it.each([
    'const origin="https://trusted.invalid";if(event.origin===origin) accept();',
    'const p=new URLSearchParams("host=https://trusted.invalid");if(event.origin===p.get("host")) accept();',
    'const origin=validateOrigin(location.hash);if(event.origin===origin) accept();',
    'const origin=location.hash;function f(origin){if(event.origin===origin)accept()}',
    'const origin=location.hash;function f({origin}){if(event.origin===origin)accept()}',
    'const origin=location.hash;function f(){const origin="https://trusted.invalid";if(event.origin===origin)accept()}',
    'const p=new URLSearchParams(location.search);function f(p){if(event.origin===p.get("host"))accept()}',
    'const origin=location.hash;function f(){if(event.origin===origin)accept();let origin;}',
    'const origin=location.hash;window.parent.postMessage({origin},"https://trusted.invalid");',
    'const origin=location.hash;try{run()}catch(origin){if(event.origin===origin)accept()}',
    'function f(URLSearchParams){const p=new URLSearchParams(location.search);if(event.origin===p.get("host"))accept()}',
    'import URLSearchParams from "custom-params";const p=new URLSearchParams(location.search);if(event.origin===p.get("host"))accept()',
    'const origin=location.hash;worker.postMessage({},origin);',

    'const unrelated=location.hash;window.parent.postMessage({},config.origin);',
  ])("does not borrow unrelated or shadowed query provenance: %s",async source=>expect(await scan(source)).toEqual([]))
  it.each([
    'if(trusted.has(origin)){window.top.postMessage({},origin)}',
    'if(!trusted.has(origin))return;window.top.postMessage({},origin);',
    'if(!trusted.has(origin)){throw Error("untrusted")}if(event.origin===origin)accept();',
  ])("recognizes a literal exact-origin allowlist: %s",async body=>{
    expect(await scan(`function f(){const trusted=new Set(['https://trusted.invalid']);const origin=location.hash;${body}}`)).toEqual([])
  })
  it("does not treat arbitrary or wildcard sets as a trusted origin allowlist",async()=>{
    expect(await scan(`const trusted=new Set(['*']);const origin=location.hash;if(trusted.has(origin)){window.top.postMessage({},origin)}`)).toHaveLength(1)
  })
  it("retains a review item when validation might happen elsewhere",async()=>{
    const issues=await scan(`const origin=new URLSearchParams(location.search).get('host');if(allowed.has(origin)){window.top.postMessage({},origin)}`)
    expect(issues).toHaveLength(1)
    expect(issues[0].detail).toContain('allowlist')
    expect(issues[0].confidence).toBe('low')
  })
  it.each(['test/client.ts','fixtures/example.js','src/client.test.ts','dist/client.js','node_modules/client.ts'])("skips nonproduction %s",async file=>expect(await scan('x.innerHTML=data.html',file)).toEqual([]))
  it("skips malformed and unsupported files",async()=>{
    expect(await scan('broken syntax ! !')).toEqual([])
    expect(await scan('x.innerHTML=data.html','client.php')).toEqual([])
  })
  it("limits a file without fabricating high-confidence findings",async()=>{
    const issues=await scan('const html=location.hash;\n'+Array.from({length:100},(_,i)=>`x${i}.innerHTML=html;`).join('\n'))
    expect(issues).toHaveLength(60)
    expect(issues.every(x=>x.confidence==='low')).toBe(true)
  })
})
