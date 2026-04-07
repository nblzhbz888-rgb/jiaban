import type { ElectronAPI } from '@electron-toolkit/preload'

export interface ElectronWindow<CustomApi = unknown> {
  electron: ElectronAPI
  platform: NodeJS.Platform
  api: CustomApi
}
