import type { ElectronDashboardOpenPayload, ElectronIslandState } from '../../../shared/eventa'

import { useElectronEventaContext, useElectronEventaInvoke } from '@jiaban/electron-vueuse'
import { computed, onMounted, onUnmounted, shallowRef, watch } from 'vue'

import {
  electronIslandGetState,
  electronIslandRespondApproval,
  electronIslandStateChanged,
  electronIslandSubscribeTerminal,
  electronIslandUpdateState,
  electronOpenDashboard,
} from '../../../shared/eventa'

function createDefaultIslandState(): ElectronIslandState {
  return {
    projectName: 'Jiaban',
    rootPath: '',
    activeProfile: null,
    sessionCount: 0,
    runningSessionCount: 0,
    status: 'idle',
    updatedAt: Date.now(),
    modelName: 'Jiaban',
  }
}

export function useIslandState() {
  const context = useElectronEventaContext()
  const getIslandState = useElectronEventaInvoke(electronIslandGetState)
  const openDashboard = useElectronEventaInvoke(electronOpenDashboard)
  const respondApprovalInvoke = useElectronEventaInvoke(electronIslandRespondApproval)
  const subscribeTerminalInvoke = useElectronEventaInvoke(electronIslandSubscribeTerminal)
  const updateStateInvoke = useElectronEventaInvoke(electronIslandUpdateState)

  const islandState = shallowRef<ElectronIslandState>(createDefaultIslandState())
  const isIslandStateLoading = shallowRef(false)
  const islandStateCleanup = shallowRef<(() => void) | null>(null)

  const statusLabel = computed(() => islandState.value.status === 'working' ? '编码中' : '待命中')
  const profileLabel = computed(() => {
    // Prefer modelName if available (e.g. "Opus 4.6")
    if (islandState.value.modelName) {
      return islandState.value.modelName
    }
    if (islandState.value.activeProfile === 'claude') {
      return 'Claude'
    }
    if (islandState.value.activeProfile === 'codex') {
      return 'Codex'
    }
    return 'Jiaban'
  })
  const sessionLabel = computed(() => {
    if (islandState.value.sessionCount === 0) {
      return '还没有终端会话'
    }
    return `${islandState.value.runningSessionCount}/${islandState.value.sessionCount} 个会话运行中`
  })
  const contextUsageLabel = computed(() => {
    const usage = islandState.value.contextUsage
    if (usage === undefined || usage === null) {
      return null
    }
    return `${Math.round(usage)}%`
  })
  const thinkingLabel = computed(() => islandState.value.currentThinkingMessage || '思考中...')
  const currentToolLabel = computed(() => islandState.value.currentTool || null)
  const feedLines = computed(() => islandState.value.feedLines ?? [])
  const pendingApproval = computed(() => islandState.value.pendingApproval ?? null)

  async function loadIslandState() {
    isIslandStateLoading.value = true
    try {
      islandState.value = await getIslandState()
    }
    finally {
      isIslandStateLoading.value = false
    }
  }

  async function openWorkspace(payload?: ElectronDashboardOpenPayload) {
    await openDashboard(payload ?? {})
  }

  async function respondApproval(response: 'allow' | 'deny') {
    const sessionId = islandState.value.pendingApproval?.sessionId
      ?? islandState.value.activeSessionId
    if (!sessionId) {
      return
    }
    await respondApprovalInvoke({ sessionId, response })
    // Clear pending approval locally
    updateStateInvoke({ pendingApproval: undefined })
  }

  async function subscribeTerminal(sessionId: string) {
    await subscribeTerminalInvoke({ sessionId })
  }

  onMounted(async () => {
    islandStateCleanup.value = context.value.on(electronIslandStateChanged, (event) => {
      if (!event?.body) {
        return
      }
      islandState.value = event.body
    })

    await loadIslandState()
  })

  watch(() => islandState.value.activeSessionId, async (activeSessionId, previousSessionId) => {
    if (!activeSessionId || activeSessionId === previousSessionId) {
      return
    }

    await subscribeTerminal(activeSessionId)
  })

  onUnmounted(() => {
    islandStateCleanup.value?.()
    islandStateCleanup.value = null
  })

  return {
    islandState,
    isIslandStateLoading,
    loadIslandState,
    openWorkspace,
    respondApproval,
    subscribeTerminal,
    profileLabel,
    sessionLabel,
    statusLabel,
    contextUsageLabel,
    thinkingLabel,
    currentToolLabel,
    feedLines,
    pendingApproval,
  }
}
