"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScanRunner } from "./scan-runner"

export function NewScanDialog({
  open,
  onOpenChange,
  onOpenRepo,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenRepo?: (repoId: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New scan</DialogTitle>
          <DialogDescription>
            Paste public repository URLs, optionally pick which checks to run, then open the
            dashboard for the full report.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto thin-scrollbar pr-1">
          <ScanRunner
            onOpen={
              onOpenRepo
                ? (repoId) => {
                    onOpenRepo(repoId)
                    onOpenChange(false)
                  }
                : undefined
            }
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
