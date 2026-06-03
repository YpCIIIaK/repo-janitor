import type { Grade, ScanReport, Severity } from "../schema"
import { countBySeverity, sortIssues } from "./shared"

/**
 * Human-readable terminal report with ANSI colour. We hand-roll the escape codes
 * (no picocolors dependency) and disable them when output isn't a TTY or NO_COLOR
 * is set, so piping to a file stays clean.
 */
const useColor = process.stdout?.isTTY === true && !process.env.NO_COLOR

const ESC = (code: number, s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s)
const bold = (s: string) => ESC(1, s)
const dim = (s: string) => ESC(2, s)
const red = (s: string) => ESC(31, s)
const yellow = (s: string) => ESC(33, s)
const cyan = (s: string) => ESC(36, s)
const green = (s: string) => ESC(32, s)

const SEVERITY_COLOR: Record<Severity, (s: string) => string> = {
  critical: red,
  warning: yellow,
  info: cyan,
}

function gradeColor(grade: Grade): (s: string) => string {
  if (grade === "A" || grade === "B") return green
  if (grade === "C") return yellow
  return red
}

export function renderTerminal(report: ScanReport): string {
  const counts = countBySeverity(report.issues)
  const grade = gradeColor(report.grade)(bold(report.grade))

  const header = [
    bold(`${report.repo.owner}/${report.repo.name}`),
    `Health Score: ${bold(String(report.score))}/100  Grade: ${grade}`,
    `Issues: ${report.issues.length}  ` +
      `(${red(`${counts.critical} critical`)}, ${yellow(`${counts.warning} warning`)}, ${cyan(`${counts.info} info`)})`,
  ].join("\n")

  if (report.issues.length === 0) {
    return `${header}\n\n${green("No issues found — clean repo.")}`
  }

  const rows = sortIssues(report.issues)
    .map((i) => {
      const tag = SEVERITY_COLOR[i.severity](i.severity.toUpperCase().padEnd(8))
      const age = i.ageDays > 0 ? dim(` (${i.ageDays}d)`) : ""
      return `  ${tag} ${i.title}${age}\n           ${dim(i.location)}`
    })
    .join("\n")

  return `${header}\n\n${rows}`
}
