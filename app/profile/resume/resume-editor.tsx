"use client"

import { useMemo, useState } from "react"

import { RESUME_WIDTH, renderResumeCardSvg, type ResumeCardData } from "@/lib/resume-card"

/**
 * The resume card editor.
 *
 * The generator is a pure function with no Node imports, so it runs here in the
 * browser and the preview is a re-render rather than a request. That is the
 * whole reason the preview can update on every keystroke without a spinner.
 *
 * Nothing is saved. This project stores nothing per person — see
 * `lib/session.ts` — so the output of this page is a file you download, not a
 * row somewhere. Reloading loses your edits, which is stated on the page rather
 * than discovered.
 */

const input =
  "w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
const label = "text-muted-foreground mb-1 block text-xs font-medium"

function Field({
  title,
  value,
  onChange,
  rows,
  placeholder,
}: {
  title: string
  value: string
  onChange: (v: string) => void
  rows?: number
  placeholder?: string
}) {
  return (
    <label className="block">
      <span className={label}>{title}</span>
      {rows ? (
        <textarea
          className={input}
          rows={rows}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className={input}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details open className="rounded-lg border p-4">
      <summary className="cursor-pointer text-sm font-semibold">{title}</summary>
      <div className="mt-4 space-y-3">{children}</div>
    </details>
  )
}

function RowTools({ onRemove, onAdd }: { onRemove?: () => void; onAdd?: () => void }) {
  return (
    <div className="flex gap-2">
      {onRemove ? (
        <button type="button" onClick={onRemove} className="text-muted-foreground text-xs underline">
          remove
        </button>
      ) : null}
      {onAdd ? (
        <button type="button" onClick={onAdd} className="text-xs underline">
          add
        </button>
      ) : null}
    </div>
  )
}

export function ResumeEditor({ initial }: { initial: ResumeCardData }) {
  const [data, setData] = useState<ResumeCardData>(initial)

  // Regenerating on every keystroke is affordable because the generator is pure
  // string building — no measurement, no DOM, no network.
  const svg = useMemo(() => renderResumeCardSvg(data), [data])

  const patch = (part: Partial<ResumeCardData>) => setData((d) => ({ ...d, ...part }))

  const download = () => {
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${data.handle || "resume"}-card.svg`
    a.click()
    // Revoking immediately can cancel the download in some browsers; a tick is
    // enough and the object is small.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={download}
            className="bg-foreground text-background rounded-lg px-4 py-2 text-sm font-semibold"
          >
            Download SVG
          </button>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(svg)}
            className="rounded-lg border px-4 py-2 text-sm font-medium"
          >
            Copy SVG
          </button>
          <button
            type="button"
            onClick={() => setData(initial)}
            className="text-muted-foreground rounded-lg border px-4 py-2 text-sm font-medium"
          >
            Reset
          </button>
        </div>
        <p className="text-muted-foreground text-xs">
          Nothing is saved — this page keeps no copy of your edits. Download the
          SVG before you leave.
        </p>

        <Section title="Header">
          <Field title="Handle" value={data.handle} onChange={(handle) => patch({ handle })} />
          <Field title="Headline" value={data.headline} onChange={(headline) => patch({ headline })} />
          <Field title="Subtitle" value={data.subtitle} onChange={(subtitle) => patch({ subtitle })} />
          <Field
            title="Availability pill (empty hides it)"
            value={data.availability}
            onChange={(availability) => patch({ availability })}
          />
          <Field title="Summary" rows={3} value={data.summary} onChange={(summary) => patch({ summary })} />
        </Section>

        <Section title="Stats">
          {data.stats.map((stat, i) => (
            <div key={i} className="space-y-2 rounded-md border p-3">
              <div className="grid grid-cols-2 gap-2">
                <Field
                  title="Value"
                  value={stat.value}
                  onChange={(v) =>
                    patch({ stats: data.stats.map((s, j) => (i === j ? { ...s, value: v } : s)) })
                  }
                />
                <Field
                  title="Label"
                  value={stat.label}
                  onChange={(v) =>
                    patch({ stats: data.stats.map((s, j) => (i === j ? { ...s, label: v } : s)) })
                  }
                />
              </div>
              <Field
                title="Note"
                value={stat.note ?? ""}
                onChange={(v) => patch({ stats: data.stats.map((s, j) => (i === j ? { ...s, note: v } : s)) })}
              />
              <RowTools onRemove={() => patch({ stats: data.stats.filter((_, j) => j !== i) })} />
            </div>
          ))}
          <RowTools
            onAdd={() => patch({ stats: [...data.stats, { value: "0", label: "label", note: "" }] })}
          />
        </Section>

        <Section title="Tech stack">
          {data.stack.map((group, gi) => (
            <div key={gi} className="space-y-2 rounded-md border p-3">
              <Field
                title="Group"
                value={group.group}
                onChange={(v) =>
                  patch({ stack: data.stack.map((g, j) => (gi === j ? { ...g, group: v } : g)) })
                }
              />
              {group.items.map((item, ii) => (
                <div key={ii} className="flex items-center gap-2">
                  <input
                    className={input}
                    value={item.name}
                    onChange={(e) =>
                      patch({
                        stack: data.stack.map((g, j) =>
                          gi === j
                            ? {
                                ...g,
                                items: g.items.map((it, k) =>
                                  ii === k ? { ...it, name: e.target.value } : it,
                                ),
                              }
                            : g,
                        ),
                      })
                    }
                  />
                  <input
                    type="color"
                    className="h-9 w-10 shrink-0 rounded border bg-transparent"
                    value={item.color}
                    onChange={(e) =>
                      patch({
                        stack: data.stack.map((g, j) =>
                          gi === j
                            ? {
                                ...g,
                                items: g.items.map((it, k) =>
                                  ii === k ? { ...it, color: e.target.value } : it,
                                ),
                              }
                            : g,
                        ),
                      })
                    }
                  />
                  <button
                    type="button"
                    className="text-muted-foreground shrink-0 text-xs underline"
                    onClick={() =>
                      patch({
                        stack: data.stack.map((g, j) =>
                          gi === j ? { ...g, items: g.items.filter((_, k) => k !== ii) } : g,
                        ),
                      })
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              <RowTools
                onRemove={() => patch({ stack: data.stack.filter((_, j) => j !== gi) })}
                onAdd={() =>
                  patch({
                    stack: data.stack.map((g, j) =>
                      gi === j ? { ...g, items: [...g.items, { name: "New", color: "#8b95a3" }] } : g,
                    ),
                  })
                }
              />
            </div>
          ))}
          <RowTools
            onAdd={() =>
              patch({ stack: [...data.stack, { group: "Group", items: [{ name: "New", color: "#8b95a3" }] }] })
            }
          />
        </Section>

        <Section title="Focus areas">
          {data.focus.map((item, i) => (
            <div key={i} className="space-y-2 rounded-md border p-3">
              <div className="flex gap-2">
                <div className="grow">
                  <Field
                    title="Title"
                    value={item.title}
                    onChange={(v) =>
                      patch({ focus: data.focus.map((f, j) => (i === j ? { ...f, title: v } : f)) })
                    }
                  />
                </div>
                <input
                  type="color"
                  className="mt-5 h-9 w-10 shrink-0 rounded border bg-transparent"
                  value={item.color}
                  onChange={(e) =>
                    patch({
                      focus: data.focus.map((f, j) => (i === j ? { ...f, color: e.target.value } : f)),
                    })
                  }
                />
              </div>
              <Field
                title="Note"
                value={item.note}
                onChange={(v) => patch({ focus: data.focus.map((f, j) => (i === j ? { ...f, note: v } : f)) })}
              />
              <RowTools onRemove={() => patch({ focus: data.focus.filter((_, j) => j !== i) })} />
            </div>
          ))}
          <RowTools
            onAdd={() =>
              patch({ focus: [...data.focus, { title: "Area", note: "what it means", color: "#5aa9ff" }] })
            }
          />
        </Section>

        <Section title="Projects">
          {data.projects.map((project, i) => (
            <div key={i} className="space-y-2 rounded-md border p-3">
              <div className="flex gap-2">
                <div className="grow">
                  <Field
                    title="Title"
                    value={project.title}
                    onChange={(v) =>
                      patch({ projects: data.projects.map((p, j) => (i === j ? { ...p, title: v } : p)) })
                    }
                  />
                </div>
                <input
                  type="color"
                  className="mt-5 h-9 w-10 shrink-0 rounded border bg-transparent"
                  value={project.color}
                  onChange={(e) =>
                    patch({
                      projects: data.projects.map((p, j) =>
                        i === j ? { ...p, color: e.target.value } : p,
                      ),
                    })
                  }
                />
              </div>
              <Field
                title="Meta"
                value={project.meta}
                onChange={(v) =>
                  patch({ projects: data.projects.map((p, j) => (i === j ? { ...p, meta: v } : p)) })
                }
              />
              <Field
                title="Body"
                rows={3}
                value={project.body}
                onChange={(v) =>
                  patch({ projects: data.projects.map((p, j) => (i === j ? { ...p, body: v } : p)) })
                }
              />
              <Field
                title="Tags (comma separated, first 4 shown)"
                value={project.tags.join(", ")}
                onChange={(v) =>
                  patch({
                    projects: data.projects.map((p, j) =>
                      i === j
                        ? { ...p, tags: v.split(",").map((t) => t.trim()).filter(Boolean) }
                        : p,
                    ),
                  })
                }
              />
              <RowTools onRemove={() => patch({ projects: data.projects.filter((_, j) => j !== i) })} />
            </div>
          ))}
          <RowTools
            onAdd={() =>
              patch({
                projects: [
                  ...data.projects,
                  { title: "Project", meta: "when", body: "what it was", tags: [], color: "#8b95a3" },
                ],
              })
            }
          />
        </Section>

        <Section title="Education & about">
          <Field
            title="Degree"
            value={data.education.degree}
            onChange={(v) => patch({ education: { ...data.education, degree: v } })}
          />
          <Field
            title="Place & year"
            value={data.education.place}
            onChange={(v) => patch({ education: { ...data.education, place: v } })}
          />
          <Field
            title="Notes (one per line)"
            rows={2}
            value={data.education.notes.join("\n")}
            onChange={(v) => patch({ education: { ...data.education, notes: v.split("\n") } })}
          />
          <Field
            title="Certificates (one per line)"
            rows={2}
            value={data.education.certificates.join("\n")}
            onChange={(v) =>
              patch({ education: { ...data.education, certificates: v.split("\n").filter(Boolean) } })
            }
          />
          <Field title="About" rows={3} value={data.about} onChange={(about) => patch({ about })} />
          <Field
            title="Hobbies (comma separated)"
            value={data.hobbies.join(", ")}
            onChange={(v) =>
              patch({ hobbies: v.split(",").map((h) => h.trim()).filter(Boolean) })
            }
          />
        </Section>

        <Section title="Contact">
          <Field
            title="Title"
            value={data.contact.title}
            onChange={(v) => patch({ contact: { ...data.contact, title: v } })}
          />
          <Field
            title="Note"
            value={data.contact.note}
            onChange={(v) => patch({ contact: { ...data.contact, note: v } })}
          />
          {data.links.map((link, i) => (
            <div key={i} className="flex items-end gap-2 rounded-md border p-3">
              <div className="grow space-y-2">
                <Field
                  title="Label"
                  value={link.label}
                  onChange={(v) =>
                    patch({ links: data.links.map((l, j) => (i === j ? { ...l, label: v } : l)) })
                  }
                />
                <Field
                  title="Value"
                  value={link.value}
                  onChange={(v) =>
                    patch({ links: data.links.map((l, j) => (i === j ? { ...l, value: v } : l)) })
                  }
                />
              </div>
              <input
                type="color"
                className="h-9 w-10 shrink-0 rounded border bg-transparent"
                value={link.color}
                onChange={(e) =>
                  patch({ links: data.links.map((l, j) => (i === j ? { ...l, color: e.target.value } : l)) })
                }
              />
              <button
                type="button"
                className="text-muted-foreground shrink-0 pb-2 text-xs underline"
                onClick={() => patch({ links: data.links.filter((_, j) => j !== i) })}
              >
                ×
              </button>
            </div>
          ))}
          <RowTools
            onAdd={() =>
              patch({ links: [...data.links, { label: "Label", value: "value", color: "#5aa9ff" }] })
            }
          />
        </Section>
      </div>

      <div className="lg:sticky lg:top-8 lg:self-start">
        <div className="text-muted-foreground mb-2 text-xs">
          Live preview · {RESUME_WIDTH}px wide
        </div>
        <div
          className="overflow-hidden rounded-xl border [&>svg]:h-auto [&>svg]:w-full"
          // Built here by our own pure function; every field it renders goes
          // through its escaper.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>
  )
}
