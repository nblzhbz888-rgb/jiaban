<script setup lang="ts">
import type { ElectronWorkspaceCliProfile, ElectronWorkspaceTerminalSession } from '../../../shared/eventa'

import { useResizeObserver } from '@vueuse/core'
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from 'vue'

import { useDesktopLogger } from '../../composables/useDesktopLogger'
import { useIslandState } from './useIslandState'
import { useIslandWindowFrame } from './useIslandWindowFrame'

interface MonitorItem {
  id: string
  label: string
  value: string
}

const NORMALIZE_WHITESPACE_RE = /\s+/g
const SESSION_PATH_SPLIT_RE = /[\\/]/
const PROFILE_LABEL_SPLIT_RE = /\s+/
const COMPACT_SHELL_WIDTH = 328
const COMPACT_SHELL_HEIGHT = 40
const EXPANDED_CAPSULE_HEIGHT = 48
const EXPANDED_SHELL_BOTTOM_PADDING = 14
const OUTLINE_PULSE_DURATION_MS = 200

const {
  contextUsageLabel,
  currentToolLabel,
  feedLines,
  islandState,
  openWorkspace,
  pendingApproval,
  respondApproval,
  statusLabel,
  thinkingLabel,
} = useIslandState()

const isOpen = shallowRef(false)
const isOutlinePulsing = shallowRef(false)
const screenAvailWidth = shallowRef(1440)
const panelContentHeight = shallowRef(0)
const shellRef = useTemplateRef<HTMLDivElement>('shell')
const panelContentRef = useTemplateRef<HTMLDivElement>('panelContent')
const islandLog = useDesktopLogger('island-ui')

const panelVisible = computed(() => isOpen.value)
const shellExpanded = panelVisible
const hasPendingApproval = computed(() => Boolean(pendingApproval.value))
const expandedShellHeight = computed(() => {
  return Math.max(
    COMPACT_SHELL_HEIGHT,
    EXPANDED_CAPSULE_HEIGHT + panelContentHeight.value + EXPANDED_SHELL_BOTTOM_PADDING,
  )
})
const shellHeight = computed(() => {
  return shellExpanded.value ? expandedShellHeight.value : COMPACT_SHELL_HEIGHT
})

function normalizeLine(line: string) {
  return line.replace(NORMALIZE_WHITESPACE_RE, ' ').trim()
}

function getProfileLabel(profile?: ElectronWorkspaceCliProfile | null) {
  return profile === 'codex' ? 'Codex' : 'Claude'
}

function getSessionLabel(session: ElectronWorkspaceTerminalSession) {
  return session.cwd.split(SESSION_PATH_SPLIT_RE).pop() || session.cwd
}

function getSessionPathLabel(path: string) {
  const rootPath = islandState.value.rootPath
  if (!rootPath || path === rootPath) {
    return path
  }

  return path
    .replace(`${rootPath}/`, '')
    .replace(`${rootPath}\\`, '')
}

function getSessionReplyLine(session: ElectronWorkspaceTerminalSession) {
  return normalizeLine(session.lastOutputLine || 'Waiting for the next reply...')
}

const displaySessionId = shallowRef<string | null>(null)

function moveSessionToFront(
  sessions: ElectronWorkspaceTerminalSession[],
  preferredSessionId?: string | null,
) {
  if (!preferredSessionId) {
    return sessions
  }

  const preferredIndex = sessions.findIndex(session => session.id === preferredSessionId)
  if (preferredIndex <= 0) {
    return sessions
  }

  const [preferredSession] = sessions.splice(preferredIndex, 1)
  sessions.unshift(preferredSession)
  return sessions
}

const orderedSessions = computed(() => {
  const sessions = [...(islandState.value.sessions ?? [])]
  const pinnedSessionId = pendingApproval.value?.sessionId
    ?? displaySessionId.value
    ?? islandState.value.activeSessionId

  return moveSessionToFront(sessions, pinnedSessionId)
})

const { islandStyleVars, syncWindowFrame } = useIslandWindowFrame({
  hasPendingApproval,
  screenAvailWidth,
})

const componentStyleVars = computed(() => ({
  ...islandStyleVars.value,
  '--island-shell-height': `${shellHeight.value}px`,
}))

const projectLabel = computed(() => islandState.value.projectName || 'Jiaban')
const compactProjectLabel = computed(() => {
  const firstToken = projectLabel.value.split(PROFILE_LABEL_SPLIT_RE)[0]
  return firstToken || projectLabel.value || 'Happy'
})
const compactSessionsLabel = computed(() => `${islandState.value.runningSessionCount}/${islandState.value.sessionCount} sessions`)

const activeSession = computed(() => {
  const currentSessionId = pendingApproval.value?.sessionId
    ?? displaySessionId.value
    ?? islandState.value.activeSessionId
  if (currentSessionId) {
    const matchedSession = orderedSessions.value.find(session => session.id === currentSessionId)
    if (matchedSession) {
      return matchedSession
    }
  }

  return orderedSessions.value[0] ?? null
})

const monitorItems = computed<MonitorItem[]>(() => {
  const items: MonitorItem[] = [
    { id: 'cwd', label: 'ROOT', value: projectLabel.value },
    { id: 'cli', label: 'CLI', value: getProfileLabel(activeSession.value?.profile ?? islandState.value.activeProfile) },
    { id: 'run', label: 'RUN', value: `${islandState.value.runningSessionCount}/${islandState.value.sessionCount}` },
  ]

  if (contextUsageLabel.value) {
    items.push({ id: 'ctx', label: 'CTX', value: contextUsageLabel.value })
  }

  return items
})

const panelHeadline = computed(() => {
  if (pendingApproval.value?.description) {
    return pendingApproval.value.description
  }

  if (currentToolLabel.value) {
    return currentToolLabel.value
  }

  return thinkingLabel.value
})

const activeSessionChips = computed(() => {
  if (!activeSession.value) {
    return []
  }

  return [
    getProfileLabel(activeSession.value.profile),
    activeSession.value.shell,
    activeSession.value.status === 'running' ? 'Running' : `Exited ${activeSession.value.exitCode ?? 0}`,
  ]
})

const spotlightReplyLine = computed(() => {
  if (activeSession.value?.lastOutputLine) {
    return getSessionReplyLine(activeSession.value)
  }

  const latestFeedLine = feedLines.value.at(-1)
  if (latestFeedLine) {
    return normalizeLine(latestFeedLine)
  }

  return ''
})

const showSpotlightReply = computed(() => {
  if (!spotlightReplyLine.value) {
    return false
  }

  return normalizeLine(spotlightReplyLine.value) !== normalizeLine(panelHeadline.value)
})

const permissionText = computed(() => {
  if (pendingApproval.value) {
    return `${pendingApproval.value.type.toUpperCase()}: ${pendingApproval.value.description}`
  }

  if (activeSession.value?.status === 'running') {
    return 'No pending approval. Click a session to continue in workspace.'
  }

  return 'No running session. Create a new Claude or Codex session to begin.'
})

const sessionRows = computed(() => orderedSessions.value.slice(0, 5))
const spotlightMeta = computed(() => {
  const session = activeSession.value
  return [
    session ? getSessionPathLabel(session.cwd) : islandState.value.rootPath || '~/workspace',
    currentToolLabel.value || null,
    permissionText.value,
  ].filter(Boolean) as string[]
})
const hiddenSessionCount = computed(() => Math.max(0, orderedSessions.value.length - sessionRows.value.length))

const showAllSessionsLabel = computed(() => {
  if (islandState.value.sessionCount <= 1) {
    return null
  }

  return `Open all ${islandState.value.sessionCount} sessions in workspace`
})

function updatePanelContentHeight() {
  const nextHeight = Math.ceil(panelContentRef.value?.scrollHeight ?? 0)
  if (nextHeight >= 0) {
    panelContentHeight.value = nextHeight
  }
}

function logPanelEvent(
  level: 'debug' | 'log' | 'warn' | 'error',
  message: string,
  details?: Record<string, string | number | boolean | null | undefined>,
) {
  const baseDetails = {
    isOpen: isOpen.value,
    sessionCount: islandState.value.sessionCount,
    runningSessionCount: islandState.value.runningSessionCount,
    activeSessionId: activeSession.value?.id ?? islandState.value.activeSessionId ?? null,
  }

  void islandLog[level](message, {
    ...baseDetails,
    ...details,
  }).catch(() => {})
}

function getShellFrameSize() {
  const shellBounds = shellRef.value?.getBoundingClientRect()

  return {
    width: Math.max(COMPACT_SHELL_WIDTH, Math.ceil(shellBounds?.width ?? COMPACT_SHELL_WIDTH)),
    height: Math.max(COMPACT_SHELL_HEIGHT, Math.ceil(shellBounds?.height ?? COMPACT_SHELL_HEIGHT)),
  }
}

async function syncShellWindowFrame() {
  await nextTick()
  await syncWindowFrame(getShellFrameSize())
}

function isSessionPending(session: ElectronWorkspaceTerminalSession) {
  return pendingApproval.value?.sessionId === session.id
}

watch(
  () => ({
    sessionIds: (islandState.value.sessions ?? []).map(session => session.id),
    activeSessionId: islandState.value.activeSessionId ?? null,
    approvalSessionId: pendingApproval.value?.sessionId ?? null,
  }),
  ({ sessionIds, activeSessionId, approvalSessionId }) => {
    if (approvalSessionId && sessionIds.includes(approvalSessionId)) {
      displaySessionId.value = approvalSessionId
      return
    }

    if (displaySessionId.value && sessionIds.includes(displaySessionId.value)) {
      return
    }

    if (activeSessionId && sessionIds.includes(activeSessionId)) {
      displaySessionId.value = activeSessionId
      return
    }

    displaySessionId.value = sessionIds[0] ?? null
  },
  { immediate: true },
)

useResizeObserver(shellRef, () => {
  void syncShellWindowFrame()
})

useResizeObserver(panelContentRef, () => {
  updatePanelContentHeight()
})

const animationTimerIds = new Set<number>()
let animationGeneration = 0

function clearAnimationTimers() {
  for (const timerId of animationTimerIds) {
    window.clearTimeout(timerId)
  }
  animationTimerIds.clear()
}

function startAnimationCycle() {
  clearAnimationTimers()
  animationGeneration += 1
  return animationGeneration
}

function scheduleAnimationStep(generation: number, delay: number, callback: () => void) {
  const timerId = window.setTimeout(() => {
    animationTimerIds.delete(timerId)

    if (generation !== animationGeneration) {
      return
    }

    callback()
  }, delay)

  animationTimerIds.add(timerId)
}

async function syncMeasuredFrame(generation?: number) {
  await nextTick()

  if (generation !== undefined && generation !== animationGeneration) {
    return
  }

  updatePanelContentHeight()

  if (generation !== undefined && generation !== animationGeneration) {
    return
  }

  await syncWindowFrame(getShellFrameSize())
}

function pulseOutline(generation: number) {
  isOutlinePulsing.value = false

  window.requestAnimationFrame(() => {
    if (generation !== animationGeneration) {
      return
    }

    isOutlinePulsing.value = true

    scheduleAnimationStep(generation, OUTLINE_PULSE_DURATION_MS, () => {
      isOutlinePulsing.value = false
    })
  })
}

async function openPanel() {
  const generation = startAnimationCycle()
  logPanelEvent('log', 'panel open requested', {
    panelContentHeight: panelContentHeight.value,
    hasPendingApproval: hasPendingApproval.value,
  })
  pulseOutline(generation)

  updatePanelContentHeight()
  isOpen.value = true
  void syncMeasuredFrame(generation)
}

function closePanel(reason = 'manual') {
  if (!isOpen.value) {
    return
  }

  logPanelEvent('log', 'panel close requested', { reason })
  const generation = startAnimationCycle()
  isOpen.value = false
  void syncMeasuredFrame(generation)
}

async function togglePanel() {
  logPanelEvent('debug', 'panel toggle clicked', {
    nextAction: panelVisible.value ? 'close' : 'open',
  })

  if (panelVisible.value) {
    closePanel('toggle')
    return
  }

  await openPanel()
}

async function handleApprovalResponse(response: 'allow' | 'deny') {
  logPanelEvent('log', 'approval response sent', { response })
  await respondApproval(response)
  closePanel('approval-response')
}

async function handleOpenWorkspace() {
  logPanelEvent('log', 'open workspace requested')
  closePanel('open-workspace')
  await openWorkspace()
}

async function handleOpenSession(session: ElectronWorkspaceTerminalSession) {
  logPanelEvent('log', 'open session requested', {
    sessionId: session.id,
    profile: session.profile ?? 'unknown',
    cwd: session.cwd,
  })
  displaySessionId.value = session.id
  closePanel('open-session')
  await openWorkspace({
    sessionId: session.id,
    variant: session.profile,
  })
}

async function handleCreateSession(profile: ElectronWorkspaceCliProfile) {
  logPanelEvent('log', 'create session requested', { profile })
  closePanel('create-session')
  await openWorkspace({
    variant: profile,
    createSession: true,
  })
}

function handleWindowBlur() {
  logPanelEvent('debug', 'window blur received')
  closePanel('window-blur')
}

function handleWindowKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    logPanelEvent('debug', 'escape pressed')
    closePanel('escape')
  }
}

function updateScreenMetrics() {
  screenAvailWidth.value = window.screen.availWidth || window.innerWidth || 1440
}

onMounted(() => {
  updateScreenMetrics()
  updatePanelContentHeight()
  void syncShellWindowFrame()

  window.addEventListener('blur', handleWindowBlur)
  window.addEventListener('keydown', handleWindowKeydown)
  window.addEventListener('resize', updateScreenMetrics)
})

onBeforeUnmount(() => {
  clearAnimationTimers()
  window.removeEventListener('blur', handleWindowBlur)
  window.removeEventListener('keydown', handleWindowKeydown)
  window.removeEventListener('resize', updateScreenMetrics)
})
</script>

<template>
  <div class="coding-island" :style="componentStyleVars">
    <div
      ref="shell"
      :class="[
        'coding-island__shell',
        {
          'coding-island__shell--open': shellExpanded,
          'coding-island__shell--pulse': isOutlinePulsing,
        },
      ]"
    >
      <button
        class="coding-island__topline"
        type="button"
        :aria-expanded="panelVisible"
        @click="void togglePanel()"
      >
        <span class="coding-island__topline-content">
          <span class="coding-island__topline-left">
            <span class="coding-island__wave">
              <span class="coding-island__wave-bar coding-island__wave-bar--1" />
              <span class="coding-island__wave-bar coding-island__wave-bar--2" />
              <span class="coding-island__wave-bar coding-island__wave-bar--3" />
              <span class="coding-island__wave-bar coding-island__wave-bar--4" />
            </span>
          </span>

          <span class="coding-island__topline-project">
            {{ compactProjectLabel }}
          </span>

          <span
            :class="[
              'coding-island__topline-status',
              islandState.status === 'working' ? 'coding-island__topline-status--working' : 'coding-island__topline-status--idle',
            ]"
          >
            {{ statusLabel }}
          </span>

          <span class="coding-island__topline-sessions">
            {{ compactSessionsLabel }}
          </span>
        </span>
      </button>

      <div ref="panelContent" class="coding-island__panel-content">
        <section class="coding-island__panel">
          <header class="coding-island__header">
            <div class="coding-island__monitor">
              <button class="coding-island__gear" type="button" @click="void handleOpenWorkspace()">
                <span class="i-lucide:settings-2" />
              </button>

              <div
                v-for="item in monitorItems"
                :key="item.id"
                class="coding-island__monitor-item"
              >
                <span class="coding-island__monitor-label">{{ item.label }}</span>
                <span class="coding-island__monitor-value">{{ item.value }}</span>
              </div>
            </div>
          </header>

          <section class="coding-island__spotlight">
            <div class="coding-island__spotlight-title-row">
              <span class="coding-island__thread-mark">
                <span class="coding-island__thread-mark-dot coding-island__thread-mark-dot--a" />
                <span class="coding-island__thread-mark-dot coding-island__thread-mark-dot--b" />
                <span class="coding-island__thread-mark-dot coding-island__thread-mark-dot--c" />
              </span>

              <span class="coding-island__spotlight-title">
                {{ projectLabel }} · {{ panelHeadline }}
              </span>

              <span class="coding-island__thread-chips">
                <span
                  v-for="chip in activeSessionChips"
                  :key="chip"
                  class="coding-island__thread-chip"
                >
                  {{ chip }}
                </span>
              </span>
            </div>

            <div v-if="showSpotlightReply" class="coding-island__spotlight-reply">
              {{ spotlightReplyLine }}
            </div>

            <div class="coding-island__spotlight-meta">
              <span
                v-for="item in spotlightMeta"
                :key="item"
                class="coding-island__spotlight-meta-item"
              >
                {{ item }}
              </span>
            </div>
          </section>

          <section class="coding-island__session-card">
            <div class="coding-island__session-card-head">
              <span class="coding-island__session-card-title">Sessions</span>
              <span class="coding-island__session-card-meta">
                {{ islandState.runningSessionCount }}/{{ islandState.sessionCount }} running
              </span>
            </div>

            <div v-if="sessionRows.length > 0" class="coding-island__session-list">
              <button
                v-for="session in sessionRows"
                :key="session.id"
                :class="[
                  'coding-island__session-item',
                  activeSession?.id === session.id ? 'coding-island__session-item--active' : '',
                  isSessionPending(session) ? 'coding-island__session-item--pending' : '',
                ]"
                type="button"
                @click="void handleOpenSession(session)"
              >
                <div class="coding-island__session-main">
                  <span class="coding-island__session-name">
                    {{ getSessionLabel(session) }}
                  </span>
                  <span class="coding-island__session-status">
                    {{ getProfileLabel(session.profile) }} · {{ session.status === 'running' ? 'running' : `exited ${session.exitCode ?? 0}` }}
                  </span>
                </div>

                <div class="coding-island__session-path">
                  {{ getSessionPathLabel(session.cwd) }}
                </div>

                <div class="coding-island__session-output">
                  {{ getSessionReplyLine(session) }}
                </div>
              </button>
            </div>

            <div v-else class="coding-island__session-empty">
              No live sessions yet. Create one to start coding.
            </div>

            <div v-if="hiddenSessionCount > 0" class="coding-island__session-more">
              +{{ hiddenSessionCount }} more sessions in workspace
            </div>
          </section>

          <div class="coding-island__actions">
            <button
              v-if="pendingApproval"
              class="coding-island__action coding-island__action--ghost"
              type="button"
              @click="void handleApprovalResponse('deny')"
            >
              Deny
            </button>
            <button
              v-if="pendingApproval"
              class="coding-island__action coding-island__action--ice"
              type="button"
              @click="void handleApprovalResponse('allow')"
            >
              Allow Once
            </button>
            <button
              v-if="pendingApproval"
              class="coding-island__action coding-island__action--gold coding-island__action--workspace"
              type="button"
              @click="void handleOpenWorkspace()"
            >
              Open Workspace
            </button>

            <button
              v-else
              class="coding-island__action coding-island__action--ice coding-island__action--workspace"
              type="button"
              @click="void handleOpenWorkspace()"
            >
              Open Workspace
            </button>
            <button
              v-if="!pendingApproval"
              class="coding-island__action coding-island__action--gold"
              type="button"
              @click="void handleCreateSession('claude')"
            >
              New Claude
            </button>
            <button
              v-if="!pendingApproval"
              class="coding-island__action coding-island__action--hot"
              type="button"
              @click="void handleCreateSession('codex')"
            >
              New Codex
            </button>
          </div>

          <button
            v-if="showAllSessionsLabel"
            class="coding-island__sessions-link"
            type="button"
            @click="void handleOpenWorkspace()"
          >
            {{ showAllSessionsLabel }}
          </button>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.coding-island {
  --shell-fill:
    radial-gradient(circle at 18% -12%, rgba(76, 110, 255, 0.18) 0%, rgba(76, 110, 255, 0) 28%),
    linear-gradient(180deg, rgba(12, 14, 21, 0.995) 0%, rgba(5, 7, 11, 0.995) 100%);
  --shell-border: rgba(255, 255, 255, 0.055);
  position: relative;
  display: flex;
  width: 100%;
  min-height: 100%;
  align-items: flex-start;
  justify-content: center;
  overflow: visible;
  pointer-events: none;
}

.coding-island__shell {
  box-sizing: border-box;
  position: relative;
  display: flex;
  width: var(--island-shell-compact-width);
  height: var(--island-shell-height);
  border-radius: 999px;
  padding: 2px 12px;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  background: var(--shell-fill);
  box-shadow: 0 18px 36px rgba(0, 0, 0, 0.34);
  transform: translateZ(0);
  transform-origin: center top;
  backface-visibility: hidden;
  overflow: clip;
  pointer-events: auto;
  will-change: width, height, padding, border-radius, background, box-shadow;
  transition:
    width 0.32s cubic-bezier(0.2, 0.9, 0.2, 1),
    height 0.32s cubic-bezier(0.2, 0.9, 0.2, 1),
    padding 0.32s cubic-bezier(0.2, 0.9, 0.2, 1),
    border-radius 0.32s cubic-bezier(0.2, 0.9, 0.2, 1),
    box-shadow 0.32s cubic-bezier(0.2, 0.9, 0.2, 1),
    background 0.32s cubic-bezier(0.2, 0.9, 0.2, 1);
}

.coding-island__shell::before,
.coding-island__shell::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  opacity: 1;
  pointer-events: none;
  transition: opacity 0.24s cubic-bezier(0.22, 1, 0.36, 1);
}

.coding-island__shell::before {
  border: 1px solid var(--shell-border);
}

.coding-island__shell::after {
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.02);
}

.coding-island__shell--pulse::before {
  animation: coding-island-outline-pulse 0.2s ease-out both;
}

.coding-island__shell--open {
  width: var(--island-shell-expanded-width);
  border-radius: 26px;
  box-shadow: 0 24px 52px rgba(0, 0, 0, 0.34);
  padding: 0 18px 14px;
}

.coding-island__topline {
  position: relative;
  z-index: 4;
  display: flex;
  width: 100%;
  min-height: 36px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  cursor: pointer;
  padding: 0 10px;
  outline: none;
  pointer-events: auto;
  -webkit-tap-highlight-color: transparent;
  transform: translateZ(0);
  transform-origin: center top;
  backface-visibility: hidden;
  will-change: height, padding;
  transition:
    height 0.32s cubic-bezier(0.2, 0.9, 0.2, 1),
    padding 0.32s cubic-bezier(0.2, 0.9, 0.2, 1);
}

.coding-island__shell--open .coding-island__topline {
  height: 48px;
  padding: 0 12px;
}

.coding-island__topline:focus,
.coding-island__topline:focus-visible {
  outline: none;
}

.coding-island__topline-content {
  display: inline-flex;
  min-width: 0;
  max-width: 100%;
  align-items: center;
  gap: 8px;
  overflow: hidden;
  color: rgba(249, 250, 255, 0.98);
  font-family: 'DM Sans', ui-sans-serif, system-ui, sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1;
  white-space: nowrap;
}

.coding-island__topline-left {
  display: inline-flex;
  flex: none;
  align-items: center;
}

.coding-island__topline-project,
.coding-island__topline-status,
.coding-island__topline-sessions {
  flex: none;
  white-space: nowrap;
}

.coding-island__topline-project {
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
}

.coding-island__topline-status--working,
.coding-island__topline-sessions {
  color: #86d86d;
}

.coding-island__topline-status--idle {
  color: rgba(188, 194, 205, 0.82);
}

.coding-island__wave {
  display: inline-flex;
  height: 12px;
  align-items: end;
  gap: 2px;
}

.coding-island__wave-bar {
  width: 3px;
  border-radius: 999px;
  background: linear-gradient(180deg, #8dbdff 0%, #4e73ff 100%);
  box-shadow: 0 0 10px rgba(84, 124, 255, 0.58);
  animation: coding-island-wave 1.12s ease-in-out infinite;
}

.coding-island__wave-bar--1 { height: 5px; animation-delay: 0s; }
.coding-island__wave-bar--2 { height: 8px; animation-delay: 0.12s; }
.coding-island__wave-bar--3 { height: 11px; animation-delay: 0.24s; }
.coding-island__wave-bar--4 { height: 7px; animation-delay: 0.36s; }

.coding-island__monitor-label,
.coding-island__monitor-value,
.coding-island__session-status,
.coding-island__session-path,
.coding-island__session-output,
.coding-island__action,
.coding-island__sessions-link {
  font-family: 'DM Mono', 'SFMono-Regular', Consolas, monospace;
}

.coding-island__panel {
  position: relative;
  z-index: 2;
  display: flex;
  width: 100%;
  flex-direction: column;
  overflow: visible;
  padding: 0;
  transform-origin: center top;
  will-change: transform, opacity;
}

.coding-island__panel-content {
  box-sizing: border-box;
  flex: none;
  width: 100%;
  pointer-events: auto;
}

.coding-island__header {
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  gap: 12px;
  padding: 4px 2px 10px;
}

.coding-island__monitor {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: flex-end;
  gap: 12px;
}

.coding-island__gear {
  display: inline-flex;
  height: 24px;
  width: 24px;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: rgba(214, 220, 232, 0.82);
  cursor: pointer;
  padding: 0;
}

.coding-island__monitor-item {
  display: flex;
  min-width: 42px;
  max-width: 96px;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}

.coding-island__monitor-label {
  font-size: 10px;
  color: rgba(137, 147, 165, 0.66);
  line-height: 1;
}

.coding-island__monitor-value {
  max-width: 100%;
  overflow: hidden;
  font-size: 11px;
  color: rgba(230, 237, 246, 0.92);
  line-height: 1.15;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.coding-island__spotlight,
.coding-island__session-card {
  border: 1px solid rgba(255, 255, 255, 0.045);
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(12, 14, 19, 0.92) 0%, rgba(8, 10, 14, 0.88) 100%);
}

.coding-island__spotlight {
  margin-bottom: 10px;
  padding: 12px 14px;
}

.coding-island__spotlight-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.coding-island__thread-mark {
  position: relative;
  display: inline-flex;
  height: 14px;
  width: 16px;
  flex: none;
}

.coding-island__thread-mark-dot {
  position: absolute;
  border-radius: 5px;
  background: linear-gradient(180deg, #ffbf58 0%, #ff8b2b 100%);
  box-shadow: 0 0 10px rgba(255, 164, 74, 0.46);
}

.coding-island__thread-mark-dot--a {
  left: 0;
  top: 5px;
  height: 6px;
  width: 6px;
}

.coding-island__thread-mark-dot--b {
  left: 5px;
  top: 1px;
  height: 8px;
  width: 8px;
}

.coding-island__thread-mark-dot--c {
  right: 0;
  bottom: 0;
  height: 5px;
  width: 5px;
}

.coding-island__spotlight-title {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: rgba(238, 241, 248, 0.9);
  font-family: 'DM Sans', ui-sans-serif, system-ui, sans-serif;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.coding-island__thread-chips {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 6px;
}

.coding-island__thread-chip {
  display: inline-flex;
  align-items: center;
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(193, 200, 213, 0.8);
  font-family: 'DM Sans', ui-sans-serif, system-ui, sans-serif;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  padding: 4px 8px;
}

.coding-island__spotlight-reply {
  margin-top: 9px;
  overflow: hidden;
  color: rgba(224, 229, 238, 0.9);
  font-family: 'DM Sans', ui-sans-serif, system-ui, sans-serif;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  text-wrap: pretty;
  word-break: break-word;
}

.coding-island__spotlight-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
}

.coding-island__spotlight-meta-item {
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  border: 1px solid rgba(255, 255, 255, 0.045);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(173, 182, 196, 0.82);
  font-family: 'DM Mono', 'SFMono-Regular', Consolas, monospace;
  font-size: 10px;
  line-height: 1;
  padding: 5px 8px;
}

.coding-island__session-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 10px;
  padding: 12px;
}

.coding-island__session-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.coding-island__session-card-title {
  color: rgba(242, 246, 251, 0.95);
  font-family: 'DM Sans', ui-sans-serif, system-ui, sans-serif;
  font-size: 13px;
  font-weight: 700;
}

.coding-island__session-card-meta,
.coding-island__session-more,
.coding-island__session-empty {
  color: rgba(150, 159, 175, 0.72);
  font-size: 11px;
}

.coding-island__session-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.coding-island__session-item {
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: 13px;
  background: rgba(255, 255, 255, 0.025);
  cursor: pointer;
  padding: 9px 11px;
  text-align: left;
  transition:
    border-color 0.16s ease,
    background 0.16s ease,
    transform 0.16s ease;
}

.coding-island__session-item:hover {
  border-color: rgba(128, 166, 255, 0.24);
  background: rgba(128, 166, 255, 0.08);
}

.coding-island__session-item--active {
  border-color: rgba(109, 155, 255, 0.32);
  background: rgba(109, 155, 255, 0.12);
}

.coding-island__session-item--pending {
  border-color: rgba(240, 179, 71, 0.34);
}

.coding-island__session-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.coding-island__session-name {
  min-width: 0;
  overflow: hidden;
  color: rgba(243, 246, 252, 0.94);
  font-family: 'DM Sans', ui-sans-serif, system-ui, sans-serif;
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.coding-island__session-status,
.coding-island__session-path,
.coding-island__session-output {
  font-size: 10px;
  line-height: 1.35;
}

.coding-island__session-status {
  color: rgba(166, 174, 190, 0.8);
}

.coding-island__session-path {
  margin-top: 3px;
  color: rgba(128, 137, 153, 0.74);
}

.coding-island__session-output {
  margin-top: 5px;
  overflow: hidden;
  color: rgba(213, 219, 230, 0.84);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.coding-island__actions {
  display: flex;
  align-items: stretch;
  gap: 8px;
  margin-top: 4px;
}

.coding-island__action {
  min-width: 0;
  flex: 1 1 0;
  border: none;
  border-radius: 12px;
  color: rgba(20, 22, 27, 0.92);
  cursor: pointer;
  font-family: 'DM Sans', ui-sans-serif, system-ui, sans-serif;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  padding: 11px 8px;
  white-space: nowrap;
}

.coding-island__action--workspace {
  flex: 1.28 1.28 0;
}

.coding-island__action--ghost {
  background: linear-gradient(180deg, #f4d3d3 0%, #dfb2b2 100%);
}

.coding-island__action--ice {
  background: linear-gradient(180deg, #e8f4ff 0%, #d1e8ff 100%);
}

.coding-island__action--gold {
  background: linear-gradient(180deg, #efb63a 0%, #df9f1c 100%);
}

.coding-island__action--hot {
  background: linear-gradient(180deg, #d76851 0%, #bc4b39 100%);
}

.coding-island__action--danger {
  flex: 0.92 0.92 0;
  background: linear-gradient(180deg, #6a2e33 0%, #4c171d 100%);
  color: rgba(255, 241, 244, 0.96);
}

.coding-island__sessions-link {
  margin-top: 8px;
  align-self: center;
  border: none;
  background: transparent;
  color: rgba(133, 140, 154, 0.7);
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  padding: 2px 0 0;
}

@media (max-width: 760px) {
  .coding-island__header,
  .coding-island__spotlight-title-row,
  .coding-island__session-main {
    flex-wrap: wrap;
  }

  .coding-island__monitor,
  .coding-island__thread-chips {
    width: 100%;
  }
}

@keyframes coding-island-wave {
  0%, 100% {
    transform: scaleY(0.82);
    opacity: 0.8;
  }
  50% {
    transform: scaleY(1.14);
    opacity: 1;
  }
}

@keyframes coding-island-outline-pulse {
  0% {
    opacity: 0.08;
    box-shadow: inset 0 0 0 rgba(255, 255, 255, 0);
  }
  35% {
    opacity: 0.92;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
  }
  100% {
    opacity: 0.18;
    box-shadow: inset 0 0 0 rgba(255, 255, 255, 0);
  }
}
</style>
