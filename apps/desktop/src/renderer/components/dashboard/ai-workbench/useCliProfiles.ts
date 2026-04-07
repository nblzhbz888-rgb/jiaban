import type { ClaudeCodeApiMode, CodexApiMode, ElectronWorkspaceCliProfiles } from '../../../../shared/eventa'

import { useElectronEventaInvoke } from '@jiaban/electron-vueuse'
import { errorMessageFrom } from '@moeru/std'
import { reactive, shallowRef } from 'vue'

import {
  electronWorkspaceGetCliProfiles,
  electronWorkspaceSetCliProfiles,
} from '../../../../shared/eventa'

export const DEFAULT_CLAUDE_RELAY_BASE_URL = 'https://model.xuanxu.net/'
export const DEFAULT_CODEX_RELAY_BASE_URL = 'https://model.xuanxu.net/v1'
export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-6'
export const DEFAULT_CODEX_MODEL = 'gpt-5.4-mini'

const DEFAULT_PROFILES: ElectronWorkspaceCliProfiles = {
  claude: { mode: 'subscription', apiKey: '', baseUrl: DEFAULT_CLAUDE_RELAY_BASE_URL },
  codex: { mode: 'api-key', apiKey: '', baseUrl: DEFAULT_CODEX_RELAY_BASE_URL },
}

function normalizeProfiles(profiles?: Partial<ElectronWorkspaceCliProfiles> | null): ElectronWorkspaceCliProfiles {
  const normalizedClaude = { ...DEFAULT_PROFILES.claude, ...profiles?.claude }
  const normalizedCodex = { ...DEFAULT_PROFILES.codex, ...profiles?.codex }

  return {
    claude: normalizedClaude,
    codex: normalizedCodex,
  }
}

const profiles = reactive<ElectronWorkspaceCliProfiles>(normalizeProfiles())
const isProfilesLoaded = shallowRef(false)
const isProfilesLoading = shallowRef(false)
const isProfilesSaving = shallowRef(false)
const profilesErrorMessage = shallowRef('')

let loadProfilesPromise: Promise<void> | null = null

export function buildEnvOverride(
  nextProfiles: ElectronWorkspaceCliProfiles,
  profile: 'claude' | 'codex',
): Record<string, string | undefined> {
  if (profile === 'claude') {
    const config = nextProfiles.claude
    if (config.mode === 'subscription') {
      return {
        ANTHROPIC_API_KEY: undefined,
        ANTHROPIC_BASE_URL: undefined,
        ANTHROPIC_MODEL: undefined,
      }
    }

    return {
      ANTHROPIC_API_KEY: config.apiKey,
      ANTHROPIC_BASE_URL: config.mode === 'relay' ? config.baseUrl : undefined,
      ANTHROPIC_MODEL: undefined,
    }
  }

  return {
    OPENAI_API_KEY: nextProfiles.codex.apiKey,
    OPENAI_BASE_URL: undefined,
  }
}

export function useCliProfiles() {
  const getCliProfiles = useElectronEventaInvoke(electronWorkspaceGetCliProfiles)
  const setCliProfiles = useElectronEventaInvoke(electronWorkspaceSetCliProfiles)

  async function loadProfiles(force = false) {
    if (isProfilesLoaded.value && !force) {
      return
    }

    if (loadProfilesPromise && !force) {
      return await loadProfilesPromise
    }

    loadProfilesPromise = (async () => {
      isProfilesLoading.value = true
      profilesErrorMessage.value = ''

      try {
        const loadedProfiles = normalizeProfiles(await getCliProfiles())
        profiles.claude = loadedProfiles.claude
        profiles.codex = loadedProfiles.codex
        isProfilesLoaded.value = true
      }
      catch (error) {
        profilesErrorMessage.value = errorMessageFrom(error) ?? '加载 API 配置失败'
      }
      finally {
        isProfilesLoading.value = false
        loadProfilesPromise = null
      }
    })()

    return await loadProfilesPromise
  }

  async function saveProfiles() {
    isProfilesSaving.value = true
    profilesErrorMessage.value = ''

    try {
      const nextProfiles = normalizeProfiles({
        claude: { ...profiles.claude },
        codex: { ...profiles.codex },
      })
      await setCliProfiles(nextProfiles)
      profiles.claude = nextProfiles.claude
      profiles.codex = nextProfiles.codex
      isProfilesLoaded.value = true
    }
    catch (error) {
      profilesErrorMessage.value = errorMessageFrom(error) ?? '保存 API 配置失败'
      throw error
    }
    finally {
      isProfilesSaving.value = false
    }
  }

  return {
    profiles,
    isProfilesLoaded,
    isProfilesLoading,
    isProfilesSaving,
    profilesErrorMessage,
    loadProfiles,
    saveProfiles,
  }
}

export type { ClaudeCodeApiMode, CodexApiMode, ElectronWorkspaceCliProfiles }
