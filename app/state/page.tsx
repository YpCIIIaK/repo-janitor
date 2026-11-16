import { headers } from "next/headers"
import StatePage from "@/components/repo-anti-rot/state-page"
import { localRescanEnabled } from "@/lib/local-rescan-access"

/** Local controls are advertised only by the loopback launcher. */
export default async function Page() {
  return <StatePage localRescan={localRescanEnabled(await headers())} />
}
