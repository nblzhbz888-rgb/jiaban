import type { BrowserWindowConstructorOptions, Rectangle } from 'electron'
import type { InferOutput } from 'valibot'

import type { ElectronDashboardOpenPayload, ElectronWorkspaceCliProfile } from '../../../shared/eventa'
import type { I18n } from '../../libs/i18n'
import type { ServerChannel } from '../../services/runtime/channel-server'
import type { IslandStateStore } from '../island/state'

import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import clickDragPlugin from 'electron-click-drag-plugin'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/main'
import { defu } from 'defu'
import { BrowserWindow, ipcMain, screen, shell } from 'electron'
import { isLinux, isMacOS } from 'std-env'
import { array, number, object, optional, string } from 'valibot'

import icon from '../../../../resources/icon.png?asset'

import { electronStartDraggingWindow } from '../../../shared/eventa'
import { baseUrl, getElectronMainDirname, load, withHashRoute } from '../../libs/electron/location'
import { createConfig } from '../../libs/electron/persistence'
import { createReusableWindow } from '../../libs/electron/window-manager'
import { setGlobalWriteTerminal } from '../island/rpc/index.electron'
import { syncIslandStateFromTerminalChunk } from '../island/sync-terminal-chunk'
import { toggleWindowShow } from '../shared'
import { createDashboardPresentationStore } from './presentation'
import { setupDashboardWindowElectronInvokes } from './rpc/index.electron'
import { createDashboardWorkspaceService } from './workspace'

const appConfigSchema = object({
  windows: optional(array(object({
    title: optional(string()),
    tag: string(),
    x: optional(number()),
    y: optional(number()),
    width: optional(number()),
    height: optional(number()),
  }))),
})

type AppConfig = InferOutput<typeof appConfigSchema>
type DashboardWorkspaceService = Awaited<ReturnType<typeof createDashboardWorkspaceService>>

const DASHBOARD_WORKSPACE_TAG = 'dashboard-workspace'
const DASHBOARD_WORKSPACE_TITLE = 'Happy Code Workspace'
const DASHBOARD_WINDOW_BACKGROUND = '#090c13'

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function createDefaultWorkspaceBounds(): Rectangle {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const width = clamp(display.bounds.width - 1080, 980, 1080)
  const height = clamp(display.bounds.height - 300, 620, 760)

  return {
    width,
    height,
    x: Math.round(display.bounds.x + (display.bounds.width - width) / 2),
    y: display.bounds.y + 104,
  }
}

function createDashboardWindowShellConfig(): BrowserWindowConstructorOptions {
  return {
    frame: false,
    titleBarStyle: isMacOS ? 'hidden' : undefined,
    transparent: false,
    backgroundColor: DASHBOARD_WINDOW_BACKGROUND,
    hasShadow: true,
    roundedCorners: true,
  }
}

export interface DashboardWindowManager {
  getWindow: () => Promise<BrowserWindow>
  openWindow: (payload?: ElectronDashboardOpenPayload) => Promise<void>
}

export function setupDashboardWindowReusableFunc(params: {
  islandState: IslandStateStore
  onWindowCreated?: (window: BrowserWindow) => void
  serverChannel: ServerChannel
  i18n: I18n
}): DashboardWindowManager {
  const {
    setup: setupConfig,
    get: getConfigRaw,
    update: updateConfig,
  } = createConfig('app', 'config.json', appConfigSchema, {
    default: { windows: [] },
    autoHeal: true,
  })
  const getConfig = (): AppConfig => getConfigRaw() ?? { windows: [] }

  setupConfig()

  const presentationState = createDashboardPresentationStore({
    variant: params.islandState.getState().activeProfile ?? 'claude',
    activeSessionId: params.islandState.getState().activeSessionId ?? null,
  })

  let workspaceServicePromise: Promise<DashboardWorkspaceService> | null = null
  let workspaceWindowRef: BrowserWindow | null = null

  function syncPresentationState(nextState = presentationState.getState()) {
    params.islandState.patchState({
      activeProfile: nextState.variant,
      activeSessionId: nextState.activeSessionId ?? undefined,
    })

    if (!workspaceServicePromise) {
      return
    }

    void workspaceServicePromise.then((workspaceService) => {
      workspaceService.setPreferredProfile(nextState.variant)
      workspaceService.setActiveSessionId(nextState.activeSessionId ?? null)
    })
  }

  presentationState.subscribe((state) => {
    syncPresentationState(state)
  })

  function findWindowConfig(tag: string, fallbackTags: string[] = []) {
    const windows = getConfig().windows ?? []
    return windows.find(window => window.tag === tag)
      ?? fallbackTags.map(fallbackTag => windows.find(window => window.tag === fallbackTag)).find(Boolean)
  }

  function persistWindowBounds(tag: string, title: string, newBounds: Rectangle) {
    const config = getConfig()
    if (!config.windows || !Array.isArray(config.windows)) {
      config.windows = []
    }

    const existingConfigIndex = config.windows.findIndex(window => window.tag === tag)

    if (existingConfigIndex === -1) {
      config.windows.push({
        title,
        tag,
        x: newBounds.x,
        y: newBounds.y,
        width: newBounds.width,
        height: newBounds.height,
      })
    }
    else {
      const existingConfig = defu(config.windows[existingConfigIndex], { title, tag })

      existingConfig.x = newBounds.x
      existingConfig.y = newBounds.y
      existingConfig.width = newBounds.width
      existingConfig.height = newBounds.height

      config.windows[existingConfigIndex] = existingConfig
    }

    updateConfig(config)
  }

  function resolveWindowBounds(tag: string, fallbackBounds: Rectangle, fallbackTags: string[] = []) {
    const windowConfig = findWindowConfig(tag, fallbackTags)

    return {
      width: windowConfig?.width ?? fallbackBounds.width,
      height: windowConfig?.height ?? fallbackBounds.height,
      x: windowConfig?.x ?? fallbackBounds.x,
      y: windowConfig?.y ?? fallbackBounds.y,
    } satisfies Rectangle
  }

  function attachWindowBoundsPersistence(window: BrowserWindow, tag: string, title: string) {
    const handleNewBounds = () => {
      if (window.isDestroyed()) {
        return
      }

      persistWindowBounds(tag, title, window.getBounds())
    }

    window.on('resize', handleNewBounds)
    window.on('move', handleNewBounds)
  }

  function attachDraggingBridge(window: BrowserWindow) {
    /**
     * This is a know issue (or expected behavior maybe) to Electron.
     * We don't use this approach on Linux because it's not working.
     *
     * Discussion: https://github.com/electron/electron/issues/37789
     * Workaround: https://github.com/noobfromph/electron-click-drag-plugin
     */
    if (isLinux) {
      return
    }

    function handleStartDraggingWindow() {
      try {
        const windowId = window.getNativeWindowHandle()
        clickDragPlugin.startDrag(windowId)
      }
      catch (error) {
        console.error(error)
      }
    }

    ipcMain.setMaxListeners(0)

    const { context } = createContext(ipcMain, window)
    const cleanUpWindowDraggingInvokeHandler = defineInvokeHandler(context, electronStartDraggingWindow, handleStartDraggingWindow)

    window.on('closed', () => {
      cleanUpWindowDraggingInvokeHandler()
    })
  }

  async function getWorkspaceService() {
    if (!workspaceServicePromise) {
      workspaceServicePromise = createDashboardWorkspaceService().then((workspaceService) => {
        workspaceService.setIslandStateEmitter(state => params.islandState.patchState(state))
        workspaceService.subscribeTerminalOutput((payload) => {
          syncIslandStateFromTerminalChunk({
            islandState: params.islandState,
            chunk: payload.chunk,
            sessionId: payload.sessionId,
          })
        })
        workspaceService.setPreferredProfile(presentationState.getState().variant)
        workspaceService.setActiveSessionId(presentationState.getState().activeSessionId ?? null)
        setGlobalWriteTerminal((sessionId: string, data: string) => workspaceService.writeTerminal(sessionId, data))
        return workspaceService
      })
    }

    return await workspaceServicePromise
  }

  async function createFloatingDashboardWindow(windowParams: {
    title: string
    tag: string
    route: string
    defaultBounds: Rectangle
    fallbackTags?: string[]
    skipTaskbar?: boolean
    setupInvokes: (window: BrowserWindow) => Promise<void>
  }) {
    const bounds = resolveWindowBounds(windowParams.tag, windowParams.defaultBounds, windowParams.fallbackTags)

    const window = new BrowserWindow({
      title: windowParams.title,
      ...createDashboardWindowShellConfig(),
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      show: false,
      resizable: true,
      maximizable: true,
      minimizable: true,
      fullscreenable: true,
      skipTaskbar: windowParams.skipTaskbar,
      icon,
      webPreferences: {
        preload: join(dirname(fileURLToPath(import.meta.url)), '../preload/index.mjs'),
        sandbox: false,
      },
    })

    if (isMacOS) {
      window.setWindowButtonVisibility(false)
    }

    if (params.onWindowCreated) {
      params.onWindowCreated(window)
    }

    attachWindowBoundsPersistence(window, windowParams.tag, windowParams.title)

    window.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    await load(window, withHashRoute(baseUrl(resolve(getElectronMainDirname(), '..', 'renderer')), windowParams.route))
    await windowParams.setupInvokes(window)

    attachDraggingBridge(window)

    return window
  }

  const workspaceReusable = createReusableWindow(async () => {
    const workspaceService = await getWorkspaceService()
    const window = await createFloatingDashboardWindow({
      title: DASHBOARD_WORKSPACE_TITLE,
      tag: DASHBOARD_WORKSPACE_TAG,
      route: '/dashboard',
      defaultBounds: createDefaultWorkspaceBounds(),
      fallbackTags: ['dashboard'],
      setupInvokes: currentWindow => setupDashboardWindowElectronInvokes({
        window: currentWindow,
        i18n: params.i18n,
        serverChannel: params.serverChannel,
        presentationState,
        islandState: params.islandState,
        workspaceService,
      }),
    })

    workspaceWindowRef = window

    window.on('closed', () => {
      if (workspaceWindowRef === window) {
        workspaceWindowRef = null
      }
    })

    return window
  })

  async function openWindow(payload?: ElectronDashboardOpenPayload) {
    const workspaceService = await getWorkspaceService()
    const currentPresentationState = presentationState.getState()
    const sessions = workspaceService.getTerminalSessions()
    const nextVariantFromSession = payload?.sessionId
      ? sessions.find(session => session.id === payload.sessionId)?.profile
      : null
    const nextVariant: ElectronWorkspaceCliProfile = payload?.variant
      ?? nextVariantFromSession
      ?? currentPresentationState.variant
    const islandActiveSessionId = params.islandState.getState().activeSessionId
    const hasCurrentActiveSession = currentPresentationState.activeSessionId
      ? sessions.some(session => session.id === currentPresentationState.activeSessionId)
      : false
    const hasIslandActiveSession = islandActiveSessionId
      ? sessions.some(session => session.id === islandActiveSessionId)
      : false

    let nextActiveSessionId = payload?.sessionId
      ?? (hasCurrentActiveSession ? currentPresentationState.activeSessionId : null)
      ?? (hasIslandActiveSession ? islandActiveSessionId : null)
      ?? sessions[0]?.id
      ?? null

    if (payload?.createSession) {
      const session = await workspaceService.createTerminal({
        cwd: workspaceService.getRoot(),
        profile: nextVariant,
      })
      nextActiveSessionId = session.id
    }

    presentationState.patchState({
      variant: nextVariant,
      activeSessionId: nextActiveSessionId,
    })

    const workspaceWindow = await workspaceReusable.getWindow()
    toggleWindowShow(workspaceWindow)
  }

  return {
    getWindow: workspaceReusable.getWindow,
    openWindow,
  }
}
