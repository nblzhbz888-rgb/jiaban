<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'

import type { ElectronWorkspaceTerminalOutputEvent, ElectronWorkspaceTerminalSession } from '../../../../shared/eventa'
import type { WorkbenchVariant } from './models'

import { useElectronEventaContext, useElectronEventaInvoke } from '@jiaban/electron-vueuse'
import { errorMessageFrom } from '@moeru/std'
import { useDebounceFn, useResizeObserver } from '@vueuse/core'
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui'
import { computed, nextTick, onMounted, onUnmounted, reactive, shallowRef, useTemplateRef, watch } from 'vue'

import {
  electronOpenDashboard,
  electronWorkspaceCreateTerminal,
  electronWorkspaceReadTerminal,
  electronWorkspaceResizeTerminal,
  electronWorkspaceTerminalOutput,
  electronWorkspaceWriteTerminal,
} from '../../../../shared/eventa'
import { buildEnvOverride, useCliProfiles } from './useCliProfiles'

import 'xterm/css/xterm.css'

const props = defineProps<{
  variant: WorkbenchVariant
  rootPath: string
  sessions: ElectronWorkspaceTerminalSession[]
  activeSessionId?: string | null
}>()

const emit = defineEmits<{
  'update:activeSessionId': [value: string | null]
}>()

interface TerminalQuickAction {
  id: string
  label: string
  description: string
  command: string
  icon: string
}

type XTermTerminal = import('xterm').Terminal
type XTermFitAddon = import('@xterm/addon-fit').FitAddon

interface TerminalLibrary {
  Terminal: typeof import('xterm').Terminal
  FitAddon: typeof import('@xterm/addon-fit').FitAddon
}

interface SessionTerminalController {
  sessionId: string
  viewport: HTMLDivElement | null
  terminal: XTermTerminal | null
  fitAddon: XTermFitAddon | null
  inputDisposable: { dispose: () => void } | null
  cursor: number
  outputFlushFrame: number | null
  pendingOutputChunks: string[]
  initialized: boolean
  initializing: Promise<void> | null
}

const TERMINAL_RESIZE_DEBOUNCE_MS = 80

const context = useElectronEventaContext()
const openDashboard = useElectronEventaInvoke(electronOpenDashboard)
const createTerminal = useElectronEventaInvoke(electronWorkspaceCreateTerminal)
const readTerminal = useElectronEventaInvoke(electronWorkspaceReadTerminal)
const writeTerminal = useElectronEventaInvoke(electronWorkspaceWriteTerminal)
const resizeTerminal = useElectronEventaInvoke(electronWorkspaceResizeTerminal)

const terminalBodyRef = useTemplateRef<HTMLDivElement>('terminalBody')
const terminalOutputCleanup = shallowRef<(() => void) | null>(null)
const pendingTerminalCommand = shallowRef<string | null>(null)
const controllerErrorMessages = reactive<Record<string, string>>({})
const controllerStatusLabels = reactive<Record<string, string>>({})
const terminalControllers = new Map<string, SessionTerminalController>()
let terminalLibraryPromise: Promise<TerminalLibrary> | null = null

const {
  loadProfiles,
  profiles,
  saveProfiles,
} = useCliProfiles()

const availableSessions = computed(() => {
  return [...props.sessions]
})

const currentSessionId = computed(() => {
  if (props.activeSessionId && props.sessions.some(session => session.id === props.activeSessionId)) {
    return props.activeSessionId
  }

  return availableSessions.value[0]?.id ?? null
})

const currentSessionSummary = computed(() => {
  if (!currentSessionId.value) {
    return null
  }

  return props.sessions.find(session => session.id === currentSessionId.value) ?? null
})

const activeProfile = computed<WorkbenchVariant>(() => {
  return currentSessionSummary.value?.profile === 'codex'
    ? 'codex'
    : props.variant
})

const terminalMeta = computed(() => {
  if (activeProfile.value === 'codex') {
    return {
      title: 'Codex Shell',
      description: '真实 PTY 会话，进入工作目录后自动尝试唤起 Codex CLI。',
      accentClass: 'accent-codex',
    }
  }

  return {
    title: 'Claude Shell',
    description: '真实 PTY 会话，进入工作目录后自动尝试唤起 Claude Code CLI。',
    accentClass: 'accent-claude',
  }
})

function getSessionMeta(session: ElectronWorkspaceTerminalSession) {
  const profileLabel = session.profile === 'codex' ? 'Codex' : 'Claude'
  const statusLabel = session.status === 'running'
    ? '运行中'
    : `已退出 (${session.exitCode ?? 0})`
  return `${profileLabel} · ${session.shell} · ${statusLabel}`
}

const terminalQuickActions = computed<TerminalQuickAction[]>(() => {
  const commonActions: TerminalQuickAction[] = [
    {
      id: 'continue-task',
      label: '继续当前任务',
      description: '基于当前上下文继续推进，不用你重新解释一遍。',
      command: '继续当前任务，先总结当前进度，再直接执行下一步。',
      icon: 'i-solar:playback-bold-duotone',
    },
    {
      id: 'explain-project',
      label: '解释项目结构',
      description: '先浏览当前目录，再总结主要模块和分工。',
      command: '先快速浏览当前目录结构，然后解释这个项目的主要模块和职责。',
      icon: 'i-solar:widget-3-bold-duotone',
    },
    {
      id: 'fix-error',
      label: '排查当前问题',
      description: '适合当前终端里已经出现报错或行为异常的时候。',
      command: '请先分析当前问题来源，给出最小修复方案，并直接开始处理。',
      icon: 'i-solar:danger-triangle-bold-duotone',
    },
    {
      id: 'summarize-work',
      label: '总结最近改动',
      description: '快速回顾当前工作区在做什么，以及接下来该做什么。',
      command: '请总结当前工作区最近的改动、现状风险和下一步建议。',
      icon: 'i-solar:notes-bold-duotone',
    },
  ]

  if (activeProfile.value !== 'claude') {
    return commonActions
  }

  return [
    ...commonActions,
    {
      id: 'resume',
      label: '继续上次工作',
      description: '恢复最近一次 Claude Code 会话，接着上一轮上下文继续。',
      command: '/resume',
      icon: 'i-solar:history-bold-duotone',
    },
    {
      id: 'plan',
      label: '计划模式',
      description: '先让 Claude 拆分任务、列步骤，再决定下一步执行。',
      command: '/plan',
      icon: 'i-solar:checklist-bold-duotone',
    },
    {
      id: 'diff',
      label: '查看改动',
      description: '快速查看当前工作区改动，适合提交前自查。',
      command: '/diff',
      icon: 'i-solar:document-text-bold-duotone',
    },
    {
      id: 'review',
      label: '代码审查',
      description: '按代码审查模式检查风险、回归和缺失测试。',
      command: '/review',
      icon: 'i-solar:code-circle-bold-duotone',
    },
    {
      id: 'security-review',
      label: '安全审查',
      description: '专门从权限、注入、泄漏和越权角度检查代码。',
      command: '/security-review',
      icon: 'i-solar:shield-check-bold-duotone',
    },
    {
      id: 'permissions',
      label: '权限设置',
      description: '查看和调整当前会话的权限策略与执行边界。',
      command: '/permissions',
      icon: 'i-solar:lock-keyhole-bold-duotone',
    },
    {
      id: 'mcp',
      label: 'MCP / 插件',
      description: '查看和管理当前接入的 MCP、插件和工具能力。',
      command: '/mcp',
      icon: 'i-solar:widget-5-bold-duotone',
    },
    {
      id: 'plugin',
      label: '插件命令',
      description: '直接进入插件管理命令视角。',
      command: '/plugin',
      icon: 'i-solar:puzzle-bold-duotone',
    },
    {
      id: 'compact',
      label: '压缩上下文',
      description: '在不直接清空会话的情况下收缩上下文，适合长对话后继续工作。',
      command: '/compact',
      icon: 'i-solar:archive-minimalistic-bold-duotone',
    },
  ]
})

const activeTerminalStatus = computed(() => {
  if (!currentSessionId.value) {
    return availableSessions.value.length === 0 ? '暂无会话' : '正在连接...'
  }

  if (controllerStatusLabels[currentSessionId.value]) {
    return controllerStatusLabels[currentSessionId.value]
  }

  const session = currentSessionSummary.value
  if (!session) {
    return '正在连接...'
  }

  return session.status === 'running'
    ? '运行中'
    : `已退出 (${session.exitCode ?? 0})`
})

const activeTerminalErrorMessage = computed(() => {
  if (!currentSessionId.value) {
    return ''
  }

  return controllerErrorMessages[currentSessionId.value] ?? ''
})

function createTerminalController(sessionId: string): SessionTerminalController {
  return {
    sessionId,
    viewport: null,
    terminal: null,
    fitAddon: null,
    inputDisposable: null,
    cursor: 0,
    outputFlushFrame: null,
    pendingOutputChunks: [],
    initialized: false,
    initializing: null,
  }
}

function getTerminalController(sessionId: string) {
  const existingController = terminalControllers.get(sessionId)
  if (existingController) {
    return existingController
  }

  const nextController = createTerminalController(sessionId)
  terminalControllers.set(sessionId, nextController)
  return nextController
}

function updateControllerStatus(session: ElectronWorkspaceTerminalSession) {
  controllerStatusLabels[session.id] = session.status === 'running'
    ? '运行中'
    : `已退出 (${session.exitCode ?? 0})`
}

function cancelControllerOutputFlush(controller: SessionTerminalController) {
  if (controller.outputFlushFrame == null) {
    return
  }

  window.cancelAnimationFrame(controller.outputFlushFrame)
  controller.outputFlushFrame = null
}

function clearControllerPendingOutput(controller: SessionTerminalController) {
  cancelControllerOutputFlush(controller)
  controller.pendingOutputChunks = []
}

function flushControllerOutput(controller: SessionTerminalController) {
  controller.outputFlushFrame = null

  if (!controller.terminal || controller.pendingOutputChunks.length === 0) {
    controller.pendingOutputChunks = []
    return
  }

  controller.terminal.write(controller.pendingOutputChunks.join(''))
  controller.pendingOutputChunks = []
}

function queueControllerOutput(sessionId: string, chunk: string) {
  const controller = terminalControllers.get(sessionId)
  if (!controller || !controller.terminal || !chunk) {
    return
  }

  controller.pendingOutputChunks.push(chunk)
  if (controller.outputFlushFrame != null) {
    return
  }

  controller.outputFlushFrame = window.requestAnimationFrame(() => {
    flushControllerOutput(controller)
  })
}

async function loadTerminalLibrary() {
  if (!terminalLibraryPromise) {
    terminalLibraryPromise = Promise.all([
      import('xterm'),
      import('@xterm/addon-fit'),
    ]).then(([xtermModule, fitAddonModule]) => ({
      Terminal: xtermModule.Terminal,
      FitAddon: fitAddonModule.FitAddon,
    }))
  }

  return await terminalLibraryPromise
}

async function createControllerTerminal(sessionId: string) {
  const controller = getTerminalController(sessionId)

  if (controller.terminal || !controller.viewport) {
    return controller
  }

  const { Terminal, FitAddon } = await loadTerminalLibrary()
  const terminal = new Terminal({
    convertEol: true,
    cursorBlink: true,
    fontFamily: '"DM Mono", "SFMono-Regular", Consolas, monospace',
    fontSize: 12,
    lineHeight: 1.28,
    scrollback: 5000,
    theme: {
      background: '#111111',
      foreground: '#f5f5f5',
      cursor: '#f5f5f5',
      selectionBackground: 'rgba(255,255,255,0.2)',
    },
  })

  const fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.open(controller.viewport)

  controller.terminal = terminal
  controller.fitAddon = fitAddon
  controller.inputDisposable = terminal.onData((data) => {
    void writeTerminal({
      sessionId,
      data,
    }).catch((error) => {
      controllerErrorMessages[sessionId] = errorMessageFrom(error) ?? '终端写入失败'
    })
  })

  return controller
}

async function fitController(sessionId: string) {
  const controller = terminalControllers.get(sessionId)
  if (!controller?.terminal || !controller.fitAddon) {
    return
  }

  controller.fitAddon.fit()

  if (controller.terminal.cols > 0 && controller.terminal.rows > 0) {
    await resizeTerminal({
      sessionId,
      cols: controller.terminal.cols,
      rows: controller.terminal.rows,
    }).catch(() => {})
  }
}

function scheduleControllerFit(sessionId: string) {
  window.requestAnimationFrame(() => {
    void fitController(sessionId)
  })
}

async function syncControllerOutput(sessionId: string, options?: { reset?: boolean }) {
  const controller = getTerminalController(sessionId)
  if (!controller.terminal) {
    return
  }

  try {
    if (options?.reset) {
      clearControllerPendingOutput(controller)
      controller.cursor = 0
      controller.terminal.reset()
    }

    const result = await readTerminal({
      sessionId,
      cursor: options?.reset ? 0 : controller.cursor,
    })

    controller.cursor = result.cursor
    updateControllerStatus(result.session)

    if (result.chunks.length > 0) {
      queueControllerOutput(sessionId, result.chunks.join(''))
    }
  }
  catch (error) {
    controllerStatusLabels[sessionId] = '连接异常'
    controllerErrorMessages[sessionId] = errorMessageFrom(error) ?? '终端会话恢复失败'
    throw error
  }
}

async function ensureControllerInitialized(sessionId: string, options?: { focus?: boolean }) {
  const controller = getTerminalController(sessionId)

  if (controller.initialized) {
    if (options?.focus !== false) {
      controller.terminal?.focus()
    }
    return
  }

  if (controller.initializing) {
    await controller.initializing
    if (options?.focus !== false) {
      controller.terminal?.focus()
    }
    return
  }

  controller.initializing = (async () => {
    await nextTick()
    await createControllerTerminal(sessionId)

    if (!controller.terminal) {
      return
    }

    controllerErrorMessages[sessionId] = ''
    controllerStatusLabels[sessionId] = '正在连接...'

    await syncControllerOutput(sessionId, { reset: true })

    controller.initialized = true
    scheduleControllerFit(sessionId)

    if (options?.focus !== false) {
      controller.terminal.focus()
    }

    await flushPendingTerminalCommand(sessionId)
  })().finally(() => {
    controller.initializing = null
  })

  await controller.initializing
}

async function runQuickAction(action: TerminalQuickAction) {
  pendingTerminalCommand.value = action.command

  if (currentSessionSummary.value?.status === 'running' && currentSessionId.value) {
    await flushPendingTerminalCommand(currentSessionId.value)
    return
  }

  await createAndAttachTerminalSession()
}

async function createAndAttachTerminalSession(profile = activeProfile.value) {
  try {
    await loadProfiles()
    await saveProfiles()
  }
  catch (error) {
    if (currentSessionId.value) {
      controllerStatusLabels[currentSessionId.value] = '配置异常'
      controllerErrorMessages[currentSessionId.value] = errorMessageFrom(error) ?? 'API 配置同步失败'
    }
    return
  }

  const currentController = currentSessionId.value
    ? terminalControllers.get(currentSessionId.value)
    : null

  const session = await createTerminal({
    cwd: props.rootPath,
    cols: Math.max(currentController?.terminal?.cols ?? 120, 120),
    rows: Math.max(currentController?.terminal?.rows ?? 32, 32),
    profile,
    envOverride: buildEnvOverride(profiles, profile),
  })

  updateControllerStatus(session)
  emit('update:activeSessionId', session.id)
}

function getPreferredSessionId() {
  return currentSessionId.value ?? props.sessions[0]?.id ?? null
}

async function ensureSessionAvailable(options?: {
  preferredSessionId?: string | null
  createIfMissing?: boolean
  focus?: boolean
}) {
  const preferredSessionId = options?.preferredSessionId
    ?? currentSessionId.value
    ?? getPreferredSessionId()

  if (preferredSessionId) {
    await ensureControllerInitialized(preferredSessionId, { focus: options?.focus })
    return
  }

  if (options?.createIfMissing === false) {
    return
  }

  await createAndAttachTerminalSession()
}

async function flushPendingTerminalCommand(sessionId = currentSessionId.value) {
  if (!pendingTerminalCommand.value || !sessionId) {
    return
  }

  const session = props.sessions.find(item => item.id === sessionId)
  if (!session || session.status !== 'running') {
    return
  }

  const command = pendingTerminalCommand.value
  pendingTerminalCommand.value = null
  terminalControllers.get(sessionId)?.terminal?.focus()

  try {
    await writeTerminal({
      sessionId,
      data: `${command}\r`,
    })
  }
  catch (error) {
    controllerErrorMessages[sessionId] = errorMessageFrom(error) ?? '终端写入失败'
  }
}

async function createNewSession() {
  if (!currentSessionSummary.value && props.sessions.length === 0) {
    await createAndAttachTerminalSession()
    return
  }

  await openDashboard({
    variant: activeProfile.value,
    createSession: true,
  })
}

function handleTerminalOutputEvent(payload?: ElectronWorkspaceTerminalOutputEvent) {
  if (!payload) {
    return
  }

  updateControllerStatus(payload.session)

  const controller = terminalControllers.get(payload.sessionId)
  if (!controller?.initialized || !controller.terminal) {
    return
  }

  controller.cursor += 1
  queueControllerOutput(payload.sessionId, payload.chunk)
}

function registerSessionViewport(
  sessionId: string,
  element: Element | ComponentPublicInstance | null,
) {
  const controller = getTerminalController(sessionId)
  const resolvedElement = element instanceof HTMLDivElement
    ? element
    : element && '$el' in element && element.$el instanceof HTMLDivElement
      ? element.$el
      : null

  controller.viewport = resolvedElement

  if (controller.viewport && currentSessionId.value === sessionId) {
    void ensureControllerInitialized(sessionId, { focus: false })
  }
}

function disposeController(sessionId: string) {
  const controller = terminalControllers.get(sessionId)
  if (!controller) {
    return
  }

  clearControllerPendingOutput(controller)
  controller.inputDisposable?.dispose()
  controller.inputDisposable = null
  controller.terminal?.dispose()
  controller.terminal = null
  controller.fitAddon?.dispose()
  controller.fitAddon = null
  controller.viewport = null
  controller.initialized = false
  controller.initializing = null
  delete controllerErrorMessages[sessionId]
  delete controllerStatusLabels[sessionId]
  terminalControllers.delete(sessionId)
}

async function syncSessionControllers() {
  const liveSessionIds = new Set(props.sessions.map(session => session.id))

  for (const sessionId of Array.from(terminalControllers.keys())) {
    if (!liveSessionIds.has(sessionId)) {
      disposeController(sessionId)
    }
  }

  for (const session of props.sessions) {
    updateControllerStatus(session)
  }
}

const fitAllControllersDebounced = useDebounceFn(() => {
  void Promise.all(
    Array.from(terminalControllers.keys()).map(async sessionId => fitController(sessionId)),
  )
}, TERMINAL_RESIZE_DEBOUNCE_MS)

useResizeObserver(terminalBodyRef, () => {
  fitAllControllersDebounced()
})

onMounted(async () => {
  terminalOutputCleanup.value = context.value.on(electronWorkspaceTerminalOutput, (event) => {
    handleTerminalOutputEvent(event?.body)
  })

  await loadProfiles()
  await syncSessionControllers()
  await ensureSessionAvailable({ createIfMissing: false, focus: false })
})

watch(currentSessionId, (nextSessionId, previousSessionId) => {
  if (!nextSessionId) {
    void ensureSessionAvailable({ createIfMissing: false, focus: false })
    return
  }

  void ensureSessionAvailable({
    preferredSessionId: nextSessionId,
    createIfMissing: false,
    focus: previousSessionId != null,
  })
  scheduleControllerFit(nextSessionId)
}, { immediate: true })

watch(() => props.sessions.map(session => session.id).join('|'), async () => {
  await syncSessionControllers()
}, { immediate: true })

watch(() => props.sessions.map(session => `${session.id}:${session.status}:${session.exitCode ?? ''}`).join('|'), () => {
  for (const session of props.sessions) {
    updateControllerStatus(session)
  }
}, { immediate: true })

watch(() => props.rootPath, async (nextRootPath, previousRootPath) => {
  if (nextRootPath === previousRootPath) {
    return
  }

  await ensureSessionAvailable({ createIfMissing: false, focus: false })
})

onUnmounted(() => {
  pendingTerminalCommand.value = null
  terminalOutputCleanup.value?.()
  terminalOutputCleanup.value = null

  for (const sessionId of Array.from(terminalControllers.keys())) {
    disposeController(sessionId)
  }
})
</script>

<template>
  <div class="terminal-panel">
    <!-- Header -->
    <div class="terminal-header">
      <div class="terminal-header-left">
        <span class="terminal-title">{{ terminalMeta.title }}</span>
        <span class="terminal-status-badge">
          {{ currentSessionSummary ? getSessionMeta(currentSessionSummary) : `shell · ${activeTerminalStatus}` }}
        </span>
      </div>

      <div class="terminal-header-right">
        <span class="terminal-hint">
          输入 <code class="terminal-code">/model</code> 切换模型
        </span>

        <DropdownMenuRoot v-if="terminalQuickActions.length > 0">
          <DropdownMenuTrigger as-child>
            <button
              class="terminal-action-btn"
              type="button"
              title="快捷输入"
            >
              <div class="i-solar:bolt-bold-duotone" />
              <span>快捷输入</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuPortal>
            <DropdownMenuContent
              align="end"
              :side-offset="8"
              :class="[
                'terminal-quick-menu z-50 w-[320px] max-h-[min(70vh,560px)] overflow-y-auto rounded-xl border border-neutral-200 bg-white p-1 shadow-xl',
                'dark:border-neutral-700 dark:bg-neutral-900',
              ]"
            >
              <DropdownMenuItem
                v-for="action in terminalQuickActions"
                :key="action.id"
                :class="[
                  'group relative mb-1 flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 outline-none transition-colors last:mb-0 hover:bg-neutral-100 data-[highlighted]:bg-neutral-100',
                  'dark:hover:bg-neutral-800 dark:data-[highlighted]:bg-neutral-800',
                ]"
                @select="void runQuickAction(action)"
              >
                <div class="mt-0.5 shrink-0 text-base text-neutral-500 dark:text-neutral-300" :class="action.icon" />
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <div class="truncate text-sm text-neutral-800 font-medium dark:text-neutral-100">
                      {{ action.label }}
                    </div>
                    <code class="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-300">
                      {{ action.command }}
                    </code>
                  </div>
                  <div class="mt-1 text-xs text-neutral-500 leading-5 dark:text-neutral-400">
                    {{ action.description }}
                  </div>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenuPortal>
        </DropdownMenuRoot>

        <button
          class="terminal-action-btn"
          type="button"
          @click="void createNewSession()"
        >
          新会话
        </button>
      </div>
    </div>

    <!-- Error -->
    <div
      v-if="activeTerminalErrorMessage"
      class="terminal-error"
    >
      {{ activeTerminalErrorMessage }}
    </div>

    <!-- Terminal Body -->
    <div ref="terminalBody" class="terminal-body">
      <div class="terminal-viewports">
        <div
          v-for="session in availableSessions"
          :key="session.id"
          :ref="element => registerSessionViewport(session.id, element)"
          :class="[
            'terminal-viewport',
            currentSessionId === session.id ? 'terminal-viewport--active' : '',
          ]"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.terminal-panel {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.75);
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  border: 1px solid rgba(0, 0, 0, 0.06);
}

:global(html.dark) .terminal-panel {
  background: rgba(20, 20, 20, 0.85);
  border-color: rgba(255, 255, 255, 0.06);
}

/* ===== Header ===== */
.terminal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.8);
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
}

:global(html.dark) .terminal-header {
  background: rgba(30, 30, 30, 0.9);
  border-bottom-color: rgba(255, 255, 255, 0.06);
}

.terminal-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.terminal-title {
  font-size: 11px;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.6);
  letter-spacing: 0.02em;
  flex-shrink: 0;
}

:global(html.dark) .terminal-title {
  color: rgba(255, 255, 255, 0.55);
}

.terminal-status-badge {
  font-size: 10px;
  color: rgba(0, 0, 0, 0.35);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

:global(html.dark) .terminal-status-badge {
  color: rgba(255, 255, 255, 0.3);
}

.terminal-header-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.terminal-hint {
  font-size: 10px;
  color: rgba(0, 0, 0, 0.3);
  white-space: nowrap;
}

:global(html.dark) .terminal-hint {
  color: rgba(255, 255, 255, 0.25);
}

.terminal-code {
  font-family: inherit;
  font-size: 10px;
}

.terminal-action-btn {
  height: 24px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 10px;
  border-radius: 7px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: rgba(255, 255, 255, 0.5);
  color: rgba(0, 0, 0, 0.5);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 100ms ease;
  font-family: inherit;
}

:global(html.dark) .terminal-action-btn {
  border-color: rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.45);
}

.terminal-action-btn:hover {
  background: rgba(0, 0, 0, 0.06);
  color: rgba(0, 0, 0, 0.75);
}

:global(html.dark) .terminal-action-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.8);
}

/* ===== Error ===== */
.terminal-error {
  padding: 6px 12px;
  font-size: 11px;
  color: rgba(252, 165, 165, 0.9);
  background: rgba(239, 68, 68, 0.1);
  flex-shrink: 0;
}

/* ===== Body ===== */
.terminal-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: #111111;
  border-radius: 0 0 11px 11px;
  position: relative;
}

.terminal-viewports {
  position: relative;
  flex: 1;
  min-height: 0;
}

.terminal-viewport {
  position: absolute;
  inset: 0;
  overflow: hidden;
  padding: 4px 8px 8px;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}

.terminal-viewport--active {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
}

/* Quick menu override */
:global(.terminal-quick-menu) {
  border-radius: 12px !important;
}

:global(.terminal-quick-menu .reka-ui-PopperContent) {
  border-radius: 12px;
}

.terminal-panel {
  border-radius: 24px;
  background: rgba(10, 13, 22, 0.88);
  border-color: rgba(255, 255, 255, 0.06);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

.terminal-header {
  min-height: 56px;
  padding-inline: 16px;
  background: rgba(11, 14, 24, 0.94);
  border-bottom-color: rgba(255, 255, 255, 0.06);
}

.terminal-title,
.terminal-status-badge,
.terminal-hint,
.terminal-action-btn {
  color: rgba(220, 228, 247, 0.74);
}

.terminal-action-btn {
  border-color: rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.05);
}

.terminal-action-btn:hover {
  background: rgba(255, 255, 255, 0.11);
  color: rgba(248, 250, 255, 0.96);
}

.terminal-body {
  border-radius: 0 0 23px 23px;
  background: rgba(8, 10, 17, 0.98);
}

.terminal-viewport {
  padding: 8px 12px 12px;
}
</style>
