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
      <DialogContent className="max-h-[85vh] overflow-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New scan</DialogTitle>
          <DialogDescription>
            Paste one or more public repository URLs. Results are saved automatically and appear in
            the sidebar — or open one straight in the dashboard.
          </DialogDescription>
        </DialogHeader>
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
      </DialogContent>
    </Dialog>
  )
}
