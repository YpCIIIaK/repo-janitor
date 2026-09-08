import type { Metadata } from "next"
import { DemoReport } from "@/components/repo-anti-rot/demo-report"

export const metadata: Metadata = {
  title: "Demo · Repo Janitor",
  description: "Explore a real before-and-after scan of a small educational project.",
}

export default function DemoPage() {
  return <DemoReport />
}
