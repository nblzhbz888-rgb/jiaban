import type {
  ElectronWorkspaceSetupAction,
  ElectronWorkspaceSetupResult,
  ElectronWorkspaceSetupStatus,
} from '../../../../shared/eventa'

import { useElectronEventaInvoke } from '@jiaban/electron-vueuse'
import { errorMessageFrom } from '@moeru/std'
import { reactive, shallowRef } from 'vue'

import {
  electronWorkspaceGetSetupStatus,
  electronWorkspaceRunSetupAction,
} from '../../../../shared/eventa'

const setupStatus = reactive<ElectronWorkspaceSetupStatus>({
  platform: 'darwin',
  packageManager: null,
  environment: {
    git: { command: 'git', available: false, version: null },
    node: { command: 'node', available: false, version: null },
    pnpm: { command: 'pnpm', available: false, version: null },
  },
  cli: {
    claude: { command: 'claude', available: false, version: null },
    codex: { command: 'codex', available: false, version: null },
  },
})

const isSetupStatusLoading = shallowRef(false)
const isSetupActionRunning = shallowRef(false)
const setupActionErrorMessage = shallowRef('')
const setupActionResult = shallowRef<ElectronWorkspaceSetupResult | null>(null)

export function useWorkbenchSetup() {
  const getSetupStatus = useElectronEventaInvoke(electronWorkspaceGetSetupStatus)
  const runSetupActionInvoke = useElectronEventaInvoke(electronWorkspaceRunSetupAction)

  async function loadSetupStatus() {
    isSetupStatusLoading.value = true
    setupActionErrorMessage.value = ''

    try {
      const nextStatus = await getSetupStatus()
      setupStatus.platform = nextStatus.platform
      setupStatus.packageManager = nextStatus.packageManager
      setupStatus.environment = nextStatus.environment
      setupStatus.cli = nextStatus.cli
    }
    catch (error) {
      setupActionErrorMessage.value = errorMessageFrom(error) ?? '加载安装状态失败'
    }
    finally {
      isSetupStatusLoading.value = false
    }
  }

  async function runSetupAction(action: ElectronWorkspaceSetupAction) {
    isSetupActionRunning.value = true
    setupActionErrorMessage.value = ''

    try {
      const result = await runSetupActionInvoke({ action })
      setupActionResult.value = result
      await loadSetupStatus()
      return result
    }
    catch (error) {
      setupActionErrorMessage.value = errorMessageFrom(error) ?? '执行安装失败'
      throw error
    }
    finally {
      isSetupActionRunning.value = false
    }
  }

  return {
    setupStatus,
    setupActionResult,
    setupActionErrorMessage,
    isSetupStatusLoading,
    isSetupActionRunning,
    loadSetupStatus,
    runSetupAction,
  }
}
