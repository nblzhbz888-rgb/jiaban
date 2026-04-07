import type { ElectronIslandPendingApproval, ElectronIslandState } from '../../../shared/eventa'

import { basename } from 'node:path'

function getProjectName(rootPath: string) {
  if (!rootPath) {
    return 'Jiaban'
  }

  return basename(rootPath) || rootPath
}

function normalizeIslandState(state: ElectronIslandState): ElectronIslandState {
  const runningSessionCount = Math.max(0, state.runningSessionCount)

  return {
    ...state,
    projectName: getProjectName(state.rootPath),
    runningSessionCount,
    sessionCount: Math.max(runningSessionCount, state.sessionCount),
    status: runningSessionCount > 0 ? 'working' : 'idle',
    updatedAt: Date.now(),
  }
}

export function createDefaultIslandState(rootPath = ''): ElectronIslandState {
  return normalizeIslandState({
    projectName: getProjectName(rootPath),
    rootPath,
    activeProfile: null,
    sessionCount: 0,
    runningSessionCount: 0,
    status: 'idle',
    updatedAt: Date.now(),
    modelName: 'Jiaban',
  })
}

export interface IslandStateStore {
  getState: () => ElectronIslandState
  subscribe: (listener: (state: ElectronIslandState) => void) => () => void
  updateState: (nextState: ElectronIslandState) => void
  patchState: (partial: Partial<ElectronIslandState>) => void
  setActiveSession: (sessionId: string | undefined) => void
  setThinkingMessage: (message: string | undefined) => void
  setPendingApproval: (approval: ElectronIslandPendingApproval | undefined) => void
  appendFeedLine: (line: string) => void
  clearFeedLines: () => void
  setContextUsage: (usage: number | undefined) => void
  setTokenUsage: (input: number | undefined, output: number | undefined) => void
  setCurrentTool: (tool: string | undefined) => void
  setModelName: (name: string | undefined) => void
  getActiveSessionId: () => string | undefined
}

const MAX_FEED_LINES = 20

export function createIslandStateStore(initialState?: ElectronIslandState): IslandStateStore {
  let state = normalizeIslandState(initialState ?? createDefaultIslandState())
  const listeners = new Set<(state: ElectronIslandState) => void>()

  function emitState() {
    for (const listener of listeners) {
      listener(state)
    }
  }

  function updateState(nextState: ElectronIslandState) {
    state = normalizeIslandState(nextState)
    emitState()
  }

  function patchState(partial: Partial<ElectronIslandState>) {
    state = normalizeIslandState({ ...state, ...partial })
    emitState()
  }

  function subscribe(listener: (state: ElectronIslandState) => void) {
    listeners.add(listener)
    listener(state)

    return () => {
      listeners.delete(listener)
    }
  }

  function setActiveSession(sessionId: string | undefined) {
    patchState({ activeSessionId: sessionId })
  }

  function setThinkingMessage(message: string | undefined) {
    patchState({ currentThinkingMessage: message })
  }

  function setPendingApproval(approval: ElectronIslandPendingApproval | undefined) {
    patchState({ pendingApproval: approval })
  }

  function appendFeedLine(line: string) {
    const lines = [...(state.feedLines ?? []), line]
    if (lines.length > MAX_FEED_LINES) {
      lines.splice(0, lines.length - MAX_FEED_LINES)
    }
    patchState({ feedLines: lines })
  }

  function clearFeedLines() {
    patchState({ feedLines: [] })
  }

  function setContextUsage(usage: number | undefined) {
    patchState({ contextUsage: usage })
  }

  function setTokenUsage(input: number | undefined, output: number | undefined) {
    patchState({ inputTokens: input, outputTokens: output })
  }

  function setCurrentTool(tool: string | undefined) {
    patchState({ currentTool: tool })
  }

  function setModelName(name: string | undefined) {
    patchState({ modelName: name })
  }

  function getActiveSessionId() {
    return state.activeSessionId
  }

  return {
    getState: () => state,
    subscribe,
    updateState,
    patchState,
    setActiveSession,
    setThinkingMessage,
    setPendingApproval,
    appendFeedLine,
    clearFeedLines,
    setContextUsage,
    setTokenUsage,
    setCurrentTool,
    setModelName,
    getActiveSessionId,
  }
}
