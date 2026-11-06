import { redirect } from "next/navigation"

/** `/stats` is the name people guess for the State of open source page. */
export default function StatsAlias() {
  redirect("/state")
}
