"use client"

import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useLocale } from "@/components/i18n/locale-provider"
import type {
  BadgeMessage,
  BadgeStyle,
  EmbedSize,
  WidgetOptions,
  WidgetTheme,
} from "@/lib/widget-options"

/**
 * Shared controls for badge / card / embed appearance.
 * Choices land in the README URL query so pasted snippets stay customized.
 */
export function WidgetCustomize({
  value,
  onChange,
}: {
  value: WidgetOptions
  onChange: (next: WidgetOptions) => void
}) {
  const { t } = useLocale()

  function patch(partial: Partial<WidgetOptions>) {
    onChange({ ...value, ...partial })
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
      <div>
        <p className="text-sm font-medium">{t("share.widgetTitle")}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {t("share.widgetLead")}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">{t("share.widgetTheme")}</Label>
          <Select
            value={value.theme}
            onValueChange={(v) => patch({ theme: v as WidgetTheme })}
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dark">{t("share.widgetThemeDark")}</SelectItem>
              <SelectItem value="light">{t("share.widgetThemeLight")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">{t("share.widgetEmbedSize")}</Label>
          <Select
            value={value.size}
            onValueChange={(v) => patch({ size: v as EmbedSize })}
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="compact">{t("share.widgetSizeCompact")}</SelectItem>
              <SelectItem value="roomy">{t("share.widgetSizeRoomy")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">{t("share.widgetBadgeStyle")}</Label>
          <Select
            value={value.style}
            onValueChange={(v) => patch({ style: v as BadgeStyle })}
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="flat">flat</SelectItem>
              <SelectItem value="flat-square">flat-square</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">{t("share.widgetBadgeMessage")}</Label>
          <Select
            value={value.message}
            onValueChange={(v) => patch({ message: v as BadgeMessage })}
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="grade-score">{t("share.widgetMsgBoth")}</SelectItem>
              <SelectItem value="grade">{t("share.widgetMsgGrade")}</SelectItem>
              <SelectItem value="score">{t("share.widgetMsgScore")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="widget-label" className="text-xs">
            {t("share.widgetBadgeLabel")}
          </Label>
          <Input
            id="widget-label"
            value={value.label}
            maxLength={40}
            onChange={(e) => patch({ label: e.target.value.slice(0, 40) })}
            className="h-8 font-mono text-xs"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-3">
        {(
          [
            ["headline", "share.widgetShowHeadline"],
            ["chips", "share.widgetShowChips"],
            ["meta", "share.widgetShowMeta"],
          ] as const
        ).map(([key, labelKey]) => (
          <label key={key} className="flex items-center gap-2 text-xs">
            <Switch
              checked={value[key]}
              onCheckedChange={(on) => patch({ [key]: on })}
            />
            {t(labelKey)}
          </label>
        ))}
      </div>
    </div>
  )
}
