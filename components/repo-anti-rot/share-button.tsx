"use client"

import { Share2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useLocale } from "@/components/i18n/locale-provider"
import { ShareBox } from "./share-box"

/**
 * Share action for the dashboard toolbar.
 *
 * The consent box also sits under a finished scan in `ScanRunner`, but that view
 * is unmounted the moment the first report is saved — the app switches from the
 * welcome screen to the dashboard, taking the results with it. So the affordance
 * has to exist where the user actually lands, next to Export and Rescan, or the
 * first-ever scan has no way to be shared at all.
 *
 * A popover rather than a bare button: publishing needs the consent text in view
 * at the moment of the decision, not on a page the user has already left.
 *
 * This is the one place in the otherwise-English dashboard that is translated,
 * and deliberately so — see the boundary rules in `lib/i18n.ts`. Agreeing to
 * something you cannot read is not consent, so the consent rule outranks the
 * "dashboard is English" rule rather than being an exception to it.
 */
export function ShareButton({ report }: { report: unknown }) {
  const { t } = useLocale()

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Share2 className="size-4" />
          {t("share.action")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <ShareBox report={report} />
      </PopoverContent>
    </Popover>
  )
}
