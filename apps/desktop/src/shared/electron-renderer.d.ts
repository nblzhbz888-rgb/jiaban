import type { ElectronWindow } from './electron-window'

declare global {
  interface Window extends ElectronWindow {}
}

export {}
