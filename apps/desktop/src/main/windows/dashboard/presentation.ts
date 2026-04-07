import type {
  ElectronDashboardPresentationState,
  ElectronDashboardSidebarMode,
  ElectronWorkspaceCliProfile,
} from '../../../shared/eventa'

const VALID_SIDEBAR_MODES = new Set<Exclude<ElectronDashboardSidebarMode, null>>([
  'api-config',
  'environment-install',
  'cli-install',
])

function normalizeVariant(variant?: ElectronWorkspaceCliProfile | null): ElectronWorkspaceCliProfile {
  return variant === 'codex' ? 'codex' : 'claude'
}

function normalizeSidebarMode(sidebarMode?: ElectronDashboardSidebarMode): ElectronDashboardSidebarMode {
  if (sidebarMode && VALID_SIDEBAR_MODES.has(sidebarMode)) {
    return sidebarMode
  }

  return null
}

function normalizePresentationState(
  state?: Partial<ElectronDashboardPresentationState> | null,
): ElectronDashboardPresentationState {
  return {
    variant: normalizeVariant(state?.variant),
    sidebarMode: normalizeSidebarMode(state?.sidebarMode),
    activeSessionId: typeof state?.activeSessionId === 'string' && state.activeSessionId
      ? state.activeSessionId
      : null,
  }
}

export interface DashboardPresentationStore {
  getState: () => ElectronDashboardPresentationState
  patchState: (partial: Partial<ElectronDashboardPresentationState>) => ElectronDashboardPresentationState
  subscribe: (listener: (state: ElectronDashboardPresentationState) => void) => () => void
}

export function createDashboardPresentationStore(
  initialState?: Partial<ElectronDashboardPresentationState>,
): DashboardPresentationStore {
  let state = normalizePresentationState(initialState)
  const listeners = new Set<(state: ElectronDashboardPresentationState) => void>()

  function emitState() {
    for (const listener of listeners) {
      listener(state)
    }
  }

  function patchState(partial: Partial<ElectronDashboardPresentationState>) {
    state = normalizePresentationState({ ...state, ...partial })
    emitState()
    return state
  }

  function subscribe(listener: (state: ElectronDashboardPresentationState) => void) {
    listeners.add(listener)
    listener(state)

    return () => {
      listeners.delete(listener)
    }
  }

  return {
    getState: () => state,
    patchState,
    subscribe,
  }
}
