/** Hide comments and quoted literals without changing offsets or line numbers.
 * Raw Rust/C++ strings are consumed as a unit; Rust lifetimes remain code. */
export function maskNativeSource(source: string): string {
  const chars = source.split("")
  const hide = (start: number, end: number) => { for (let k = start; k < end; k++) if (chars[k] !== "\n" && chars[k] !== "\r") chars[k] = " " }
  let i = 0
  while (i < source.length) {
    const start = i
    if (source.startsWith("//", i)) { const end = source.indexOf("\n", i); i = end < 0 ? source.length : end; hide(start, i); continue }
    if (source.startsWith("/*", i)) {
      let depth = 1; i += 2
      while (i < source.length && depth) {
        if (source.startsWith("/*", i)) { depth++; i += 2 }
        else if (source.startsWith("*/", i)) { depth--; i += 2 }
        else i++
      }
      hide(start, i); continue
    }
    const rust = /^(?:br|r)(#{0,255})"/.exec(source.slice(i))
    const cpp = /^R"([^\s()\\]{0,16})\(/.exec(source.slice(i))
    if (rust || cpp) {
      const open = (rust ?? cpp)![0], close = rust ? `"${rust[1]}` : `)${cpp![1]}"`
      const end = source.indexOf(close, i + open.length)
      i = end < 0 ? source.length : end + close.length; hide(start, i); continue
    }
    if (source[i] === '"' || (source[i] === "'" && /^'(?:\\.|[^'\\\n])'/.test(source.slice(i)))) {
      const quote = source[i++]
      while (i < source.length) { if (source[i] === "\\") { i += 2; continue }; if (source[i++] === quote) break }
      hide(start, Math.min(i, source.length)); continue
    }
    i++
  }
  return chars.join("")
}
