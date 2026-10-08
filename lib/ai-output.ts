/** Reject recognizable reasoning/prompt echoes instead of displaying them as answers. */
export function isUsableAiText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    !/(<\/?think(?:ing)?>|here['’]s (?:a |my |the )?thinking process|analy[sz]e (?:the )?user['’]?s? request|chain.of.thought|\*\*(?:role|content requirements|provided data)\s*:)/i.test(value)
}

export const AI_FAILURE_MESSAGE =
  "AI analysis failed or returned an incomplete/invalid answer. Retry with Generate, or check the model and API key in Settings."
