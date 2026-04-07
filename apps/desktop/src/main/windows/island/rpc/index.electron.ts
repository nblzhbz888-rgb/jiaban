import type { BrowserWindow } from 'electron'

import type { I18n } from '../../../libs/i18n'
import type { ServerChannel } from '../../../services/runtime/channel-server'
import type { DashboardWindowManager } from '../../dashboard'
import type { IslandStateStore } from '../state'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/main'
import { ipcMain } from 'electron'

import {
  electronIslandGetState,
  electronIslandRespondApproval,
  electronIslandStateChanged,
  electronIslandSubscribeTerminal,
  electronIslandUpdateState,
  electronOpenDashboard,
} from '../../../../shared/eventa'
import { setupBaseWindowElectronInvokes } from '../../shared/window'

// Global reference to terminal write function set by the dashboard
let globalWriteTerminal: ((sessionId: string, data: string) => void) | null = null

export function setGlobalWriteTerminal(fn: (sessionId: string, data: string) => void) {
  globalWriteTerminal = fn
}

export async function respondToIslandApproval(params: {
  islandState: IslandStateStore
  payload?: {
    sessionId: string
    response: 'allow' | 'deny'
  }
}) {
  if (!params.payload?.sessionId) {
    return
  }

  const response = params.payload.response === 'allow' ? 'y\n' : 'n\n'
  if (globalWriteTerminal) {
    await globalWriteTerminal(params.payload.sessionId, response)
  }

  params.islandState.setPendingApproval(undefined)
}

export function syncIslandTerminalSubscription(params: {
  islandState: IslandStateStore
  sessionId?: string
}) {
  if (!params.sessionId) {
    return
  }

  params.islandState.setActiveSession(params.sessionId)
  params.islandState.clearFeedLines()
}

export async function setupIslandWindowElectronInvokes(params: {
  window: BrowserWindow
  dashboardWindow: DashboardWindowManager
  islandState: IslandStateStore
  i18n: I18n
  serverChannel: ServerChannel
}) {
  ipcMain.setMaxListeners(0)

  const { context } = createContext(ipcMain, params.window)

  const stopSync = params.islandState.subscribe((state) => {
    context.emit(electronIslandStateChanged, state)
  })

  params.window.on('closed', () => {
    stopSync()
  })

  await setupBaseWindowElectronInvokes({
    context,
    window: params.window,
    serverChannel: params.serverChannel,
    i18n: params.i18n,
  })

  defineInvokeHandler(context, electronIslandGetState, () => params.islandState.getState())

  defineInvokeHandler(context, electronIslandUpdateState, (partial) => {
    if (partial) {
      params.islandState.patchState(partial)
    }
  })

  defineInvokeHandler(context, electronIslandRespondApproval, async payload => respondToIslandApproval({
    islandState: params.islandState,
    payload,
  }))

  defineInvokeHandler(context, electronIslandSubscribeTerminal, payload => syncIslandTerminalSubscription({
    islandState: params.islandState,
    sessionId: payload?.sessionId,
  }))

  defineInvokeHandler(context, electronOpenDashboard, async payload => params.dashboardWindow.openWindow(payload))
}
