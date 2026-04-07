const ANSI_OSC_RE = /\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g
const ANSI_ESCAPE_RE = /[\u001B\u009B][[\]()#;?]*(?:\d{1,4}(?:;\d{0,4})*)?[\dA-ORZcf-nqry=><~]/g
const CONTROL_CHAR_RE = /[\u0000-\u0008\u000B-\u001F\u007F]/g
const CARRIAGE_RETURN_RE = /\r/g
const COLLAPSE_WHITESPACE_RE = /\s+/g
const MEANINGFUL_TERMINAL_CHAR_RE = /[A-Z\u4E00-\u9FFF0-9/\\]/i
const TERMINAL_NOISE_LINE_RE = /^(?:[A-Z]?\d+(?:[;:][\d?A-Z\\/-]+)*|[>›·•=:;|\\/_\-+~`"'()[\]{}]+)$/i
const TERMINAL_SUMMARY_NOISE_LINE_RES = [
  /^claude code\b/i,
  /^codex\b/i,
  /^(?:sonnet|opus|gpt-\d[\w.-]*)\b/i,
  /\bapi usage billing\b/i,
  /^\[workspace\]\b/i,
  /^\s*(?:\/|~\/|[a-z]:[\\/])/i,
  /^no pending approval\b/i,
  /^image in clipboard\b/i,
  /^\[process exited with code \d+\]$/i,
  /^(?:allow once|deny|bypass permissions|manually approve|auto-accept)\b/i,
] as const

function normalizeTerminalWhitespace(text: string) {
  return text.replace(CARRIAGE_RETURN_RE, '\n')
}

export function stripTerminalControlSequences(text: string) {
  return normalizeTerminalWhitespace(text)
    .replace(ANSI_OSC_RE, '')
    .replace(ANSI_ESCAPE_RE, '')
    .replace(CONTROL_CHAR_RE, '')
}

export function normalizeTerminalLine(text: string) {
  return stripTerminalControlSequences(text)
    .replace(COLLAPSE_WHITESPACE_RE, ' ')
    .trim()
}

function normalizeComparableTerminalLine(text: string) {
  return normalizeTerminalLine(text).toLocaleLowerCase()
}

export function isMeaningfulTerminalLine(text: string) {
  if (!text || text.length < 2) {
    return false
  }

  if (TERMINAL_NOISE_LINE_RE.test(text)) {
    return false
  }

  return MEANINGFUL_TERMINAL_CHAR_RE.test(text)
}

export function extractReadableTerminalLines(text: string) {
  return normalizeTerminalWhitespace(text)
    .split('\n')
    .map(normalizeTerminalLine)
    .filter(Boolean)
}

export function extractMeaningfulTerminalLines(text: string) {
  return extractReadableTerminalLines(text)
    .filter(isMeaningfulTerminalLine)
}

export function extractLastMeaningfulTerminalLine(text: string) {
  return extractMeaningfulTerminalLines(text).at(-1) ?? null
}

function isTerminalSummaryLine(line: string, excludedLines: Set<string>) {
  const comparableLine = normalizeComparableTerminalLine(line)
  if (!comparableLine) {
    return false
  }

  if (excludedLines.has(comparableLine)) {
    return false
  }

  return !TERMINAL_SUMMARY_NOISE_LINE_RES.some(pattern => pattern.test(line))
}

export function extractTerminalSummaryLine(text: string, options?: {
  excludeLines?: Array<string | null | undefined>
}) {
  const meaningfulLines = extractMeaningfulTerminalLines(text)
  const excludedLines = new Set(
    (options?.excludeLines ?? [])
      .map(line => line ? normalizeComparableTerminalLine(line) : '')
      .filter(Boolean),
  )

  for (let index = meaningfulLines.length - 1; index >= 0; index -= 1) {
    const line = meaningfulLines[index]
    if (isTerminalSummaryLine(line, excludedLines)) {
      return line
    }
  }

  return null
}
