/** Plain model text with clickable HTTPS citations; never render model HTML. */
export function AiAnswer({ text }: { text: string }) {
  return <>{text.split(/(https:\/\/[^\s)<>]+)/g).map((part, index) =>
    part.startsWith("https://")
      ? <a key={index} href={part} target="_blank" rel="noopener noreferrer" className="break-all underline underline-offset-2">{part}</a>
      : part,
  )}</>
}
