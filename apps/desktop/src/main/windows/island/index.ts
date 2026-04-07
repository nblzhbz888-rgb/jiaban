import type { BrowserWindow, Rectangle } from 'electron'

import type { I18n } from '../../libs/i18n'
import type { ServerChannel } from '../../services/runtime/channel-server'
import type { DashboardWindowManager } from '../dashboard'
import type { IslandStateStore } from './state'

import { join, resolve } from 'node:path'

import { useLogg } from '@guiiai/logg'
import { BrowserWindow as ElectronBrowserWindow, screen, shell } from 'electron'
import { isMacOS } from 'std-env'

import icon from '../../../../resources/icon.png?asset'

import { baseUrl, getElectronMainDirname, load, withHashRoute } from '../../libs/electron/location'
import { createReusableWindow } from '../../libs/electron/window-manager'
import { toggleWindowShow } from '../shared'
import { setupIslandWindowElectronInvokes } from './rpc/index.electron'

export interface IslandWindowManager {
  getWindow: () => Promise<BrowserWindow>
  openWindow: () => Promise<void>
}

function createIslandBounds(size?: { width?: number, height?: number }): Rectangle {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { bounds, workArea } = display
  const width = Math.max(216, Math.min(workArea.width - 24, size?.width ?? 216))
  const height = Math.max(40, Math.min(workArea.height - 24, size?.height ?? 40))

  return {
    width,
    height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: bounds.y,
  }
}

function syncIslandWindowBounds(window: BrowserWindow) {
  const currentBounds = window.getBounds()
  window.setBounds(createIslandBounds({
    width: currentBounds.width,
    height: currentBounds.height,
  }), false)
}

export function setupIslandWindowReusableFunc(params: {
  dashboardWindow: DashboardWindowManager
  islandState: IslandStateStore
  i18n: I18n
  serverChannel: ServerChannel
}): IslandWindowManager {
  const log = useLogg('main/windows/island').useGlobalConfig()
  const reusable = createReusableWindow(async () => {
    const bounds = createIslandBounds()
    const window = new ElectronBrowserWindow({
      title: 'Jiaban',
      ...bounds,
      show: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      movable: false,
      alwaysOnTop: true,
      acceptFirstMouse: true,
      transparent: true,
      frame: false,
      hasShadow: false,
      backgroundColor: '#00000000',
      icon,
      webPreferences: {
        preload: join(getElectronMainDirname(), '../preload/index.mjs'),
        sandbox: false,
      },
    })

    window.setAlwaysOnTop(true, 'screen-saver', 2)
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    if (isMacOS) {
      window.setWindowButtonVisibility(false)
    }

    const recenterWindow = () => {
      if (window.isDestroyed()) {
        return
      }
      syncIslandWindowBounds(window)
    }

    window.on('ready-to-show', () => {
      log.withFields({ bounds: window.getBounds() }).log('island window ready to show')
      recenterWindow()
      window.show()
    })

    window.on('show', () => {
      log.withFields({ bounds: window.getBounds() }).debug('island window shown')
      recenterWindow()
    })
    window.on('focus', () => {
      log.withFields({ bounds: window.getBounds() }).debug('island window focused')
      recenterWindow()
    })
    window.on('blur', () => {
      log.debug('island window blurred')
    })

    screen.on('display-added', recenterWindow)
    screen.on('display-removed', recenterWindow)
    screen.on('display-metrics-changed', recenterWindow)

    window.on('closed', () => {
      log.log('island window closed')
      screen.off('display-added', recenterWindow)
      screen.off('display-removed', recenterWindow)
      screen.off('display-metrics-changed', recenterWindow)
    })

    window.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    await load(window, withHashRoute(baseUrl(resolve(getElectronMainDirname(), '..', 'renderer')), '/island'))

    await setupIslandWindowElectronInvokes({
      window,
      dashboardWindow: params.dashboardWindow,
      islandState: params.islandState,
      i18n: params.i18n,
      serverChannel: params.serverChannel,
    })

    return window
  })

  async function openWindow() {
    log.log('island window open requested')
    toggleWindowShow(await reusable.getWindow())
  }

  return {
    getWindow: reusable.getWindow,
    openWindow,
  }
}
