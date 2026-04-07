import type { ElectronRendererLogLevel } from '../../shared/eventa'

import { useElectronEventaInvoke } from '@jiaban/electron-vueuse'

import { electronAppWriteLogEntry } from '../../shared/eventa'

type DesktopLogDetails = Record<string, string | number | boolean | null | undefined>

export function useDesktopLogger(scope: string) {
  const writeLogEntry = useElectronEventaInvoke(electronAppWriteLogEntry)

  async function write(level: ElectronRendererLogLevel, message: string, details?: DesktopLogDetails) {
    await writeLogEntry({
      scope,
      level,
      message,
      details,
    })
  }

  return {
    debug: (message: string, details?: DesktopLogDetails) => write('debug', message, details),
    log: (message: string, details?: DesktopLogDetails) => write('log', message, details),
    warn: (message: string, details?: DesktopLogDetails) => write('warn', message, details),
    error: (message: string, details?: DesktopLogDetails) => write('error', message, details),
  }
}
