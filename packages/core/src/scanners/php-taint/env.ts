/**
 * Variable environment with copy-on-write branches.
 *
 * Copying the whole env at every if/else and loop made the analysis cost
 * branches × variables: a Dolibarr page holds thousands of variables from
 * main.inc.php and runs hundreds of branches. Here a fork moves the env's own
 * entries into a frozen layer both sides share, and each side writes into its
 * own empty layer. Merging two branches only looks at the keys written below
 * their nearest shared layer.
 *
 * Invariant: only frozen layers have children. A leaf handed to the analysis
 * is never anybody's parent, so writing to it can never leak into another branch.
 */
const DEL: unique symbol = Symbol("deleted")
/** A chain longer than this is flattened at the next fork: lookups stay short. */
const MAX_DEPTH = 24
const rootOf = (k: string) => k.replace(/(?:\[|->)[^]*$/, "")

export class Env<V> {
  private own = new Map<string, V | typeof DEL>()
  private parent: Env<V> | null
  private depth: number

  constructor(parent: Env<V> | null = null) {
    this.parent = parent
    this.depth = parent ? parent.depth + 1 : 0
  }

  get(k: string): V | undefined {
    const mine = this.own.get(k)
    if (mine !== undefined) return mine === DEL ? undefined : mine
    for (let e = this.parent; e; e = e.parent) {
      const v = e.own.get(k)
      if (v !== undefined) return v === DEL ? undefined : v
    }
    return undefined
  }

  has(k: string): boolean {
    return this.get(k) !== undefined
  }

  set(k: string, v: V): this {
    this.own.set(k, v)
    return this
  }

  delete(k: string): void {
    if (this.parent?.has(k)) this.own.set(k, DEL)
    else this.own.delete(k)
  }

  clear(): void {
    this.own = new Map()
    this.parent = null
    this.depth = 0
  }

  /** Every live entry, from the root down (a snapshot: writing while iterating is safe). */
  flat(): Map<string, V> {
    const layers: Env<V>[] = [this, ...this.ancestors()]
    const out = new Map<string, V>()
    for (let i = layers.length - 1; i >= 0; i--) {
      for (const [k, v] of layers[i].own) {
        if (v === DEL) out.delete(k)
        else out.set(k, v)
      }
    }
    return out
  }

  [Symbol.iterator](): IterableIterator<[string, V]> {
    return this.flat()[Symbol.iterator]()
  }

  /** Frozen layers only: their keys grouped by root variable (`a` for `a[k]`, `a->p`). */
  private roots: Map<string, string[]> | null = null

  /** Live keys whose root variable is the root of `key` (`$a[x]`, `$a->p` for `a`). */
  keysUnder(key: string): string[] {
    const root = rootOf(key)
    const seen = new Set<string>()
    for (const k of this.own.keys()) if (rootOf(k) === root) seen.add(k)
    for (const e of this.ancestors()) {
      if (!e.roots) {
        e.roots = new Map()
        for (const k of e.own.keys()) {
          const r = rootOf(k)
          const list = e.roots.get(r) ?? []
          list.push(k)
          e.roots.set(r, list)
        }
      }
      for (const k of e.roots.get(root) ?? []) seen.add(k)
    }
    return [...seen].filter((k) => this.get(k) !== undefined)
  }

  /** A branch: the returned env starts equal to this one; writes to either stay apart. */
  fork(): Env<V> {
    if (this.depth >= MAX_DEPTH) {
      const all = this.flat()
      this.parent = null
      this.depth = 0
      this.own = all
    }
    if (this.own.size || !this.parent) {
      const frozen = new Env<V>(this.parent)
      frozen.own = this.own
      this.parent = frozen
      this.depth = frozen.depth + 1
      this.own = new Map()
    }
    return new Env<V>(this.parent)
  }

  /** Keys written in this env's layers below `stop` (exclusive). */
  private writtenAbove(stop: Env<V> | null, into: Set<string>) {
    for (const k of this.own.keys()) into.add(k)
    for (let e = this.parent; e && e !== stop; e = e.parent) for (const k of e.own.keys()) into.add(k)
  }

  private ancestors(): Env<V>[] {
    const out: Env<V>[] = []
    for (let e = this.parent; e; e = e.parent) out.push(e)
    return out
  }

  /**
   * Join of branch envs: a key keeps every value any branch gave it. `combine`
   * merges two values; values shared by reference are taken as they are.
   */
  static join<V extends unknown[]>(envs: Env<V>[], combine: (a: V, b: V) => V): Env<V> {
    if (!envs.length) return new Env<V>()
    if (envs.length === 1) return envs[0]
    // The nearest layer every branch shares: below it they may differ, above it they are equal.
    const others = envs.slice(1).map((e) => new Set(e.ancestors()))
    const base = envs[0].ancestors().find((a) => others.every((s) => s.has(a))) ?? null
    const keys = new Set<string>()
    for (const e of envs) e.writtenAbove(base, keys)
    const out = new Env<V>(base)
    for (const k of keys) {
      let joined: V | undefined
      let present = false
      for (const e of envs) {
        const v = e.get(k)
        if (v === undefined) continue
        present = true
        if (!v.length || joined === v) continue
        joined = joined?.length ? combine(joined, v) : v
      }
      if (present) out.own.set(k, joined ?? ([] as unknown as V))
      else if (base?.has(k)) out.own.set(k, DEL)
    }
    return out
  }
}
