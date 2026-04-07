import type { FileLoggerHandle } from './app/file-logger'

import process, { env, platform } from 'node:process'

import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import messages from '@jiaban/i18n/locales'

import { electronApp, optimizer } from '@electron-toolkit/utils'
import { Format, LogLevel, setGlobalFormat, setGlobalHookPostLog, setGlobalLogLevel, useLogg } from '@guiiai/logg'
import { app, BrowserWindow, ipcMain } from 'electron'
import { createLoggLogger, injeca, lifecycle } from 'injeca'
import { isLinux } from 'std-env'

import icon from '../../resources/icon.png?asset'

import { openDebugger, setupDebugger } from './app/debugger'
import { nullFileLoggerHandle, setupFileLogger } from './app/file-logger'
import { createGlobalAppConfig } from './configs/global'
import { emitAppBeforeQuit, emitAppReady, emitAppWindowAllClosed } from './libs/bootkit/lifecycle'
import { setElectronMainDirname } from './libs/electron/location'
import { createI18n } from './libs/i18n'
import { setupServerChannel } from './services/runtime/channel-server'
import { setupDashboardWindowReusableFunc } from './windows/dashboard'
import { resolveDefaultWorkspaceRoot } from './windows/dashboard/workspace'
import { setupIslandWindowReusableFunc } from './windows/island'
import { createDefaultIslandState, createIslandStateStore } from './windows/island/state'

// TODO: once we refactored eventa to support window-namespaced contexts,
// we can remove the setMaxListeners call below since eventa will be able to dispatch and
// manage events within eventa's context system.
ipcMain.setMaxListeners(100)

setElectronMainDirname(dirname(fileURLToPath(import.meta.url)))
setGlobalFormat(Format.Pretty)
setGlobalLogLevel(LogLevel.Log)
setupDebugger()

const log = useLogg('main').useGlobalConfig()

function ignoreDetachedConsoleEio(stream?: NodeJS.WriteStream | null) {
  stream?.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EIO') {
      return
    }

    throw error
  })
}

ignoreDetachedConsoleEio(process.stdout)
ignoreDetachedConsoleEio(process.stderr)

// Electron on Linux often needs explicit flags before WebGPU can initialize reliably.
if (isLinux) {
  app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer')
  app.commandLine.appendSwitch('enable-unsafe-webgpu')
  app.commandLine.appendSwitch('enable-features', 'Vulkan')

  // NOTICE: keep these Wayland flags until Electron enables them by default.
  if (env.XDG_SESSION_TYPE === 'wayland') {
    app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal')

    app.commandLine.appendSwitch('enable-features', 'UseOzonePlatform')
    app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations')
  }
}

app.dock?.setIcon(icon)
electronApp.setAppUserModelId('com.liangzongjing.jiaban')

function focusExistingWindow() {
  const window = BrowserWindow.getAllWindows().find(currentWindow => !currentWindow.isDestroyed())
  if (!window) {
    return
  }

  if (window.isMinimized()) {
    window.restore()
  }

  window.show()
  window.focus()
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
}

app.on('second-instance', () => {
  focusExistingWindow()
})

let fileLogger: FileLoggerHandle = nullFileLoggerHandle
let skipFileLogging = false

if (hasSingleInstanceLock) {
  app.whenReady().then(async () => {
    // Initialize file logger and register the hook
    fileLogger = await setupFileLogger()

    // Register the global hook for file logging
    setGlobalHookPostLog((_, formatted) => {
      if (skipFileLogging || fileLogger.logFileFd === null)
        return
      void fileLogger.appendLog(formatted)
    })

    injeca.setLogger(createLoggLogger(useLogg('injeca').useGlobalConfig()))

    const appConfig = injeca.provide('configs:app', () => createGlobalAppConfig())
    const electronApp = injeca.provide('host:electron:app', () => app)

    const i18n = injeca.provide('libs:i18n', {
      dependsOn: { appConfig },
      build: ({ dependsOn }) => createI18n({ messages, locale: dependsOn.appConfig.get()?.language }),
    })

    const serverChannel = injeca.provide('modules:channel-server', {
      dependsOn: { app: electronApp, lifecycle },
      build: async ({ dependsOn }) => setupServerChannel(dependsOn),
    })

    const islandState = injeca.provide('modules:island-state', {
      build: async () => createIslandStateStore(createDefaultIslandState(await resolveDefaultWorkspaceRoot())),
    })

    const dashboardWindow = injeca.provide('windows:dashboard', {
      dependsOn: { islandState, serverChannel, i18n },
      build: ({ dependsOn }) => setupDashboardWindowReusableFunc(dependsOn),
    })

    const islandWindow = injeca.provide('windows:island', {
      dependsOn: { dashboardWindow, islandState, serverChannel, i18n },
      build: ({ dependsOn }) => setupIslandWindowReusableFunc(dependsOn),
    })

    injeca.invoke({
      dependsOn: { islandWindow },
      callback: async ({ islandWindow }) => {
        await islandWindow.openWindow()
      },
    })

    injeca.start().catch(err => console.error(err))

    // Lifecycle
    emitAppReady()

    // Extra
    openDebugger()

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
    app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
  }).catch((err) => {
    log.withError(err).error('Error during app initialization')
  })
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  emitAppWindowAllClosed()

  if (platform !== 'darwin') {
    app.quit()
  }
})

let appExiting = false

// Clean up server and intervals when app quits
async function handleAppExit() {
  if (appExiting)
    return

  appExiting = true

  let exitedNormally = true

  /**
   * Safely execute fn and log any errors that occur, marking the exit as abnormal
   * if an error is caught.
   *
   * @param operation - A verb phrase describing the operation.
   * @param fn - Any function to execute. It can be either sync or async.
   * @returns A promise that resolves when the operation is complete.
   */
  async function logIfError(operation: string, fn: () => unknown): Promise<void> {
    try {
      await fn()
    }
    catch (error) {
      exitedNormally = false
      log.withError(error).error(`[app-exit] Failed to ${operation}:`)
    }
  }

  await Promise.all([
    logIfError('execute onAppBeforeQuit hooks', () => emitAppBeforeQuit()),
    logIfError('stop injeca', () => injeca.stop()),
  ])

  // Prevent the global log hook from trying to write to the file after close() is called,
  // which would cause a recursive failure if close() itself throws.
  skipFileLogging = true
  await logIfError('flush file logs', () => fileLogger.close()) // Ensure all logs are flushed

  app.exit(exitedNormally ? 0 : 1)
}

process.on('SIGINT', () => handleAppExit())

app.on('before-quit', (event) => {
  event.preventDefault()
  handleAppExit()
})
