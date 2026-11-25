/**
 * Rendering for text that came from another person. The shape is the defence: our own header lines are the only
 * lines written flush left; every line of peer content is behind PREFIX, so no message can produce a line that
 * reads like a Duoza header, a request number, or a "--- END TASK ---" marker.
 */
export const PREFIX = "│ "

// Every line terminator Unicode knows: CRLF, CR, LF, VT, FF, FS/GS/RS, NEL, LS, PS.
// biome-ignore lint/suspicious/noControlCharactersInRegex: FS/GS/RS are line terminators we must split on.
const BREAKS = /\r\n|[\r\n\v\f\u001c-\u001e\u0085\u2028\u2029]/

// Control (Cc), format (Cf: zero-width, bidi overrides, BOM...) and lone surrogate (Cs) characters, tab excepted.
const INVISIBLE = /(?!\t)[\p{Cc}\p{Cf}\p{Cs}]/gu

/** Each control, format or lone-surrogate character (tab aside) shown as a middle dot. */
export function visible(line: string): string {
  return line.replace(INVISIBLE, "·")
}

/** Peer text as a block: one prefixed, visible line per source line. */
export function quoteBody(text: string): string {
  return text
    .split(BREAKS)
    .map((line) => PREFIX + visible(line))
    .join("\n")
}

/** A peer-supplied value placed inside one of our own lines: a single visible line. */
export function headerField(value: string): string {
  return visible(value.replace(/\s+/g, " ").trim())
}
