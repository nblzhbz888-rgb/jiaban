import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { BrowserWindow } from 'electron'

import { useLogg } from '@guiiai/logg'
import { defineInvokeHandler } from '@moeru/eventa'
import { app, shell } from 'electron'
import { isLinux, isMacOS, isWindows } from 'std-env'

import { electron, electronAppOpenUserDataFolder, electronAppQuit, electronAppWriteLogEntry } from '../../../shared/eventa'

export function createAppService(params: { context: ReturnType<typeof createContext>['context'], window: BrowserWindow }) {
  defineInvokeHandler(params.context, electron.app.isMacOS, () => isMacOS)
  defineInvokeHandler(params.context, electron.app.isWindows, () => isWindows)
  defineInvokeHandler(params.context, electron.app.isLinux, () => isLinux)
  defineInvokeHandler(params.context, electronAppOpenUserDataFolder, async () => {
    const path = app.getPath('userData')
    const openResult = await shell.openPath(path)
    if (openResult) {
      throw new Error(openResult)
    }
    return { path }
  })
  defineInvokeHandler(params.context, electronAppQuit, () => app.quit())
  defineInvokeHandler(params.context, electronAppWriteLogEntry, (payload) => {
    if (!payload?.scope || !payload.message) {
      return
    }

    const scopedLog = useLogg(`renderer/${payload.scope}`).useGlobalConfig()
    const targetLog = payload.details ? scopedLog.withFields(payload.details) : scopedLog

    switch (payload.level ?? 'log') {
      case 'debug':
        targetLog.debug(payload.message)
        return
      case 'warn':
        targetLog.warn(payload.message)
        return
      case 'error':
        targetLog.error(payload.message)
        return
      default:
        targetLog.log(payload.message)
    }
  })
}
