import type { IslandStateStore } from './state'

import {
  extractMeaningfulTerminalLines,
  extractReadableTerminalLines,
} from '../shared/terminal-text'

const MODEL_OPUS_RE = /Opus\s+[\d.]+(?:\s+\(1M context\))?/i
const MODEL_CLAUDE_CODE_RE = /Claude Code v[\d.]+/i
const MODEL_CODEX_RE = /\bCodex\b/i
const CONTEXT_USAGE_RE = /(\d{1,3})%\s*\/\s*1M/i
const PERCENTAGE_RE = /\b(\d{1,3})%\b/
const TOOL_PREFIX_RE = /^(?:Edit|Read|Write|Bash|Plan|Search|Patch)\b/i
const APPROVAL_RE = /Allow Once|Deny|Bypass Permissions|Manually Approve|Auto-accept/i
const APPROVAL_RESOLVED_RE = /approved|denied|permission granted|continuing/i

export function syncIslandStateFromTerminalChunk(params: {
  islandState: IslandStateStore
  chunk: string
  sessionId: string
}) {
  const readableLines = extractReadableTerminalLines(params.chunk)
  const meaningfulLines = extractMeaningfulTerminalLines(params.chunk)
  const activeSessionId = params.islandState.getActiveSessionId()
  const isFocusedSession = !activeSessionId || activeSessionId === params.sessionId

  if (readableLines.length === 0) {
    return
  }

  const joined = meaningfulLines.join(' ')
  const latestLine = meaningfulLines.at(-1) ?? readableLines.at(-1)

  const modelMatch = joined.match(MODEL_OPUS_RE)
    ?? joined.match(MODEL_CLAUDE_CODE_RE)
    ?? joined.match(MODEL_CODEX_RE)

  if (APPROVAL_RE.test(joined)) {
    params.islandState.setActiveSession(params.sessionId)
    params.islandState.setPendingApproval({
      id: `approval-${Date.now()}`,
      sessionId: params.sessionId,
      type: 'general',
      description: latestLine ?? 'Pending approval',
      codePreview: meaningfulLines.slice(-5).join('\n'),
    })
  }

  const shouldSyncForegroundState = isFocusedSession || params.islandState.getActiveSessionId() === params.sessionId
  if (!shouldSyncForegroundState) {
    return
  }

  for (const line of meaningfulLines.slice(-8)) {
    params.islandState.appendFeedLine(line)
  }

  if (modelMatch?.[0]) {
    params.islandState.setModelName(modelMatch[0])
  }

  const usageMatch = joined.match(CONTEXT_USAGE_RE) ?? joined.match(PERCENTAGE_RE)
  if (usageMatch?.[1]) {
    params.islandState.setContextUsage(Number(usageMatch[1]))
  }

  const toolMatch = meaningfulLines.find(line => TOOL_PREFIX_RE.test(line))
  if (toolMatch) {
    params.islandState.setCurrentTool(toolMatch)
  }

  if (latestLine) {
    params.islandState.setThinkingMessage(latestLine.slice(0, 160))
  }

  if (APPROVAL_RESOLVED_RE.test(joined)) {
    const activeApproval = params.islandState.getState().pendingApproval
    if (!activeApproval?.sessionId || activeApproval.sessionId === params.sessionId) {
      params.islandState.setPendingApproval(undefined)
    }
  }
}
