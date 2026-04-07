import type { ElectronDashboardPresentationState } from '../../../shared/eventa'
import type { WorkbenchSidebarMode, WorkbenchVariant } from './ai-workbench/models'

import { useElectronEventaContext, useElectronEventaInvoke } from '@jiaban/electron-vueuse'
import { computed, onMounted, onUnmounted, shallowRef } from 'vue'

import {
  electronDashboardPresentationChanged,
  electronDashboardPresentationGet,
  electronDashboardPresentationSet,
} from '../../../shared/eventa'

function createDefaultPresentationState(): ElectronDashboardPresentationState {
  return {
    variant: 'claude',
    sidebarMode: null,
    activeSessionId: null,
  }
}

export function useDashboardPresentationState() {
  const context = useElectronEventaContext()
  const getPresentationState = useElectronEventaInvoke(electronDashboardPresentationGet)
  const setPresentationState = useElectronEventaInvoke(electronDashboardPresentationSet)

  const presentationState = shallowRef<ElectronDashboardPresentationState>(createDefaultPresentationState())
  const presentationPatchVersion = shallowRef(0)
  const cleanup = shallowRef<(() => void) | null>(null)

  async function loadPresentationState() {
    presentationState.value = await getPresentationState()
  }

  async function patchPresentationState(partial: Partial<ElectronDashboardPresentationState>) {
    const requestVersion = presentationPatchVersion.value + 1
    presentationPatchVersion.value = requestVersion
    presentationState.value = {
      ...presentationState.value,
      ...partial,
    }

    try {
      const nextState = await setPresentationState(partial)
      if (presentationPatchVersion.value === requestVersion) {
        presentationState.value = nextState
      }
    }
    catch (error) {
      if (presentationPatchVersion.value === requestVersion) {
        await loadPresentationState()
      }

      throw error
    }
  }

  async function setVariant(variant: WorkbenchVariant) {
    await patchPresentationState({ variant })
  }

  async function setSidebarMode(sidebarMode: WorkbenchSidebarMode | null) {
    await patchPresentationState({ sidebarMode })
  }

  async function setActiveSessionId(activeSessionId: string | null) {
    await patchPresentationState({ activeSessionId })
  }

  async function toggleSidebarMode(sidebarMode: WorkbenchSidebarMode) {
    await patchPresentationState({
      sidebarMode: presentationState.value.sidebarMode === sidebarMode ? null : sidebarMode,
    })
  }

  const activeWorkbenchId = computed<WorkbenchVariant>(() => presentationState.value.variant)
  const activeWorkbenchSidebarMode = computed<WorkbenchSidebarMode | null>(() => presentationState.value.sidebarMode)
  const activeSessionId = computed(() => presentationState.value.activeSessionId)
  const sidebarModeModel = computed<WorkbenchSidebarMode | null>({
    get: () => activeWorkbenchSidebarMode.value,
    set: value => void setSidebarMode(value),
  })

  onMounted(async () => {
    cleanup.value = context.value.on(electronDashboardPresentationChanged, (event) => {
      if (!event?.body) {
        return
      }

      presentationState.value = event.body
    })

    await loadPresentationState()
  })

  onUnmounted(() => {
    cleanup.value?.()
    cleanup.value = null
  })

  return {
    presentationState,
    activeWorkbenchId,
    activeWorkbenchSidebarMode,
    activeSessionId,
    sidebarModeModel,
    loadPresentationState,
    setVariant,
    setSidebarMode,
    setActiveSessionId,
    toggleSidebarMode,
  }
}
