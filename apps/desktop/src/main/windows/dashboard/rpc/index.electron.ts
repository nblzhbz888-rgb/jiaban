import type { BrowserWindow } from 'electron'

import type { I18n } from '../../../libs/i18n'
import type { ServerChannel } from '../../../services/runtime/channel-server'
import type { IslandStateStore } from '../../island/state'
import type { DashboardPresentationStore } from '../presentation'
import type { createDashboardWorkspaceService } from '../workspace'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/main'
import { ipcMain } from 'electron'

import {
  electronDashboardPresentationChanged,
  electronDashboardPresentationGet,
  electronDashboardPresentationSet,
  electronIslandGetState,
  electronIslandRespondApproval,
  electronIslandStateChanged,
  electronIslandSubscribeTerminal,
  electronIslandUpdateState,
  electronOpenMainDevtools,
  electronWorkspaceCloseTerminal,
  electronWorkspaceCreateDirectory,
  electronWorkspaceCreateFile,
  electronWorkspaceCreateTerminal,
  electronWorkspaceDeleteEntry,
  electronWorkspaceGetCliProfiles,
  electronWorkspaceGetRevision,
  electronWorkspaceGetRoot,
  electronWorkspaceGetSetupStatus,
  electronWorkspaceListDirectory,
  electronWorkspacePickRoot,
  electronWorkspaceReadFile,
  electronWorkspaceReadTerminal,
  electronWorkspaceRenameEntry,
  electronWorkspaceResizeTerminal,
  electronWorkspaceRunSetupAction,
  electronWorkspaceSetCliProfiles,
  electronWorkspaceTerminalOutput,
  electronWorkspaceWriteFile,
  electronWorkspaceWriteTerminal,
} from '../../../../shared/eventa'
import { respondToIslandApproval, syncIslandTerminalSubscription } from '../../island/rpc/index.electron'
import { setupBaseWindowElectronInvokes } from '../../shared/window'

async function setupDashboardSharedElectronInvokes(params: {
  window: BrowserWindow
  i18n: I18n
  serverChannel: ServerChannel
  presentationState: DashboardPresentationStore
  islandState: IslandStateStore
}) {
  ipcMain.setMaxListeners(0)

  const { context } = createContext(ipcMain, params.window)
  const stopSync = params.presentationState.subscribe((state) => {
    context.emit(electronDashboardPresentationChanged, state)
  })
  const stopIslandStateSync = params.islandState.subscribe((state) => {
    context.emit(electronIslandStateChanged, state)
  })

  params.window.on('closed', () => {
    stopSync()
    stopIslandStateSync()
  })

  await setupBaseWindowElectronInvokes({
    context,
    window: params.window,
    serverChannel: params.serverChannel,
    i18n: params.i18n,
  })

  defineInvokeHandler(context, electronOpenMainDevtools, () => params.window.webContents.openDevTools({ mode: 'detach' }))
  defineInvokeHandler(context, electronDashboardPresentationGet, () => params.presentationState.getState())
  defineInvokeHandler(context, electronDashboardPresentationSet, partial => params.presentationState.patchState(partial ?? {}))
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

  return context
}

export async function setupDashboardWindowPresentationInvokes(params: {
  window: BrowserWindow
  i18n: I18n
  serverChannel: ServerChannel
  presentationState: DashboardPresentationStore
  islandState: IslandStateStore
}) {
  await setupDashboardSharedElectronInvokes(params)
}

export async function setupDashboardWindowElectronInvokes(params: {
  window: BrowserWindow
  i18n: I18n
  serverChannel: ServerChannel
  presentationState: DashboardPresentationStore
  islandState: IslandStateStore
  workspaceService: Awaited<ReturnType<typeof createDashboardWorkspaceService>>
}) {
  const context = await setupDashboardSharedElectronInvokes(params)

  const stopTerminalOutputSync = params.workspaceService.subscribeTerminalOutput((payload) => {
    context.emit(electronWorkspaceTerminalOutput, payload)
  })

  params.window.on('closed', () => {
    stopTerminalOutputSync()
  })

  defineInvokeHandler(context, electronWorkspaceGetRoot, () => params.workspaceService.getRoot())
  defineInvokeHandler(context, electronWorkspacePickRoot, () => params.workspaceService.pickRoot(params.window))
  defineInvokeHandler(context, electronWorkspaceGetRevision, () => params.workspaceService.getRevision())
  defineInvokeHandler(context, electronWorkspaceListDirectory, payload => params.workspaceService.listDirectory(payload?.path))
  defineInvokeHandler(context, electronWorkspaceReadFile, payload => params.workspaceService.readWorkspaceFile(payload.path))
  defineInvokeHandler(context, electronWorkspaceWriteFile, payload => params.workspaceService.writeWorkspaceFile(payload.path, payload.content))
  defineInvokeHandler(context, electronWorkspaceCreateFile, payload => params.workspaceService.createFile(payload.path))
  defineInvokeHandler(context, electronWorkspaceCreateDirectory, payload => params.workspaceService.createDirectory(payload.path))
  defineInvokeHandler(context, electronWorkspaceRenameEntry, payload => params.workspaceService.renameEntry(payload.path, payload.nextPath))
  defineInvokeHandler(context, electronWorkspaceDeleteEntry, payload => params.workspaceService.deleteEntry(payload.path))
  defineInvokeHandler(context, electronWorkspaceCreateTerminal, payload => params.workspaceService.createTerminal(payload))
  defineInvokeHandler(context, electronWorkspaceReadTerminal, payload => params.workspaceService.readTerminal(payload.sessionId, payload.cursor))
  defineInvokeHandler(context, electronWorkspaceWriteTerminal, payload => params.workspaceService.writeTerminal(payload.sessionId, payload.data))
  defineInvokeHandler(context, electronWorkspaceResizeTerminal, payload => params.workspaceService.resizeTerminal(payload.sessionId, payload.cols, payload.rows))
  defineInvokeHandler(context, electronWorkspaceCloseTerminal, payload => params.workspaceService.closeTerminal(payload.sessionId))
  defineInvokeHandler(context, electronWorkspaceGetCliProfiles, () => params.workspaceService.getCliProfiles())
  defineInvokeHandler(context, electronWorkspaceSetCliProfiles, payload => params.workspaceService.setCliProfiles(payload))
  defineInvokeHandler(context, electronWorkspaceGetSetupStatus, () => params.workspaceService.getSetupStatus())
  defineInvokeHandler(context, electronWorkspaceRunSetupAction, payload => params.workspaceService.runSetupAction(payload.action))
}
