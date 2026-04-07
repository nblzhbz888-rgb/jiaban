<script setup lang="ts">
import type { ClaudeCodeApiMode, CodexApiMode } from './useCliProfiles'

import { onMounted, ref } from 'vue'

import {
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_CLAUDE_RELAY_BASE_URL,
  DEFAULT_CODEX_MODEL,
  DEFAULT_CODEX_RELAY_BASE_URL,
  useCliProfiles,
} from './useCliProfiles'

const props = withDefaults(defineProps<{
  canRestartSession?: boolean
  restartPending?: boolean
}>(), {
  canRestartSession: false,
  restartPending: false,
})

const emit = defineEmits<{
  close: []
  restartSession: []
}>()

const {
  isProfilesLoading,
  isProfilesSaving,
  loadProfiles,
  profiles,
  profilesErrorMessage,
  saveProfiles,
} = useCliProfiles()

const savedMessage = ref('')
const isClaudeApiKeyVisible = ref(false)
const isCodexApiKeyVisible = ref(false)

const claudeModes: Array<{ value: ClaudeCodeApiMode, label: string, hint: string }> = [
  { value: 'subscription', label: '订阅', hint: '使用 Anthropic 账号订阅（OAuth 登录，无需 API Key）' },
  { value: 'api-key', label: 'API Key', hint: '使用 Anthropic 官方 API Key（直连官方接口）' },
  { value: 'relay', label: '中转 API', hint: '自定义 Base URL，兼容 Anthropic 格式的中转服务' },
]

const codexModes: Array<{ value: CodexApiMode, label: string, hint: string }> = [
  { value: 'api-key', label: 'API Key', hint: '使用 OpenAI 官方 API Key（直连官方接口）' },
  { value: 'relay', label: '中转 API', hint: '自定义 Base URL，兼容 OpenAI 格式的中转服务' },
]

onMounted(() => {
  void loadProfiles()
})

function clearSavedMessageLater() {
  window.setTimeout(() => {
    savedMessage.value = ''
  }, 3000)
}

async function confirmSaved() {
  try {
    await saveProfiles()
    savedMessage.value = '已保存，重启终端后生效'
    clearSavedMessageLater()
  }
  catch {
    savedMessage.value = ''
  }
}

async function saveAndRestart() {
  try {
    await saveProfiles()
    savedMessage.value = '已保存，正在重启当前会话...'
    clearSavedMessageLater()
    emit('restartSession')
  }
  catch {
    savedMessage.value = ''
  }
}

function updateClaudeMode(mode: ClaudeCodeApiMode) {
  profiles.claude.mode = mode
  if (mode === 'relay' && !profiles.claude.baseUrl) {
    profiles.claude.baseUrl = DEFAULT_CLAUDE_RELAY_BASE_URL
  }
}

function updateCodexMode(mode: CodexApiMode) {
  profiles.codex.mode = mode
  if (mode === 'relay' && !profiles.codex.baseUrl) {
    profiles.codex.baseUrl = DEFAULT_CODEX_RELAY_BASE_URL
  }
}
</script>

<template>
  <div class="config-root">
    <!-- Header -->
    <div class="config-header">
      <div class="config-title">
        API 配置
      </div>
      <div class="config-header-actions">
        <span v-if="savedMessage" class="config-saved">{{ savedMessage }}</span>
        <span v-else-if="isProfilesLoading" class="config-loading">正在加载...</span>
        <button
          class="config-btn-restart"
          type="button"
          :disabled="isProfilesSaving || props.restartPending || !props.canRestartSession"
          @click="saveAndRestart"
        >
          {{ props.restartPending ? '重启中...' : '保存并重启' }}
        </button>
        <button
          class="config-btn-save"
          type="button"
          :disabled="isProfilesSaving"
          @click="confirmSaved"
        >
          {{ isProfilesSaving ? '保存中...' : '保存配置' }}
        </button>
        <button
          class="config-close"
          type="button"
          aria-label="关闭 API 配置"
          title="关闭"
          @click="emit('close')"
        >
          <div class="i-solar:close-circle-linear" />
        </button>
      </div>
    </div>

    <p class="config-desc">
      配置会同步到主进程。保存后重启终端会话即可注入对应环境变量。
    </p>

    <p v-if="profilesErrorMessage" class="config-error">
      {{ profilesErrorMessage }}
    </p>

    <div class="config-body">
      <!-- Claude Code -->
      <section class="config-section">
        <div class="config-section-header">
          <span class="config-provider-badge config-provider-claude">Claude Code</span>
        </div>

        <div class="config-mode-tabs">
          <button
            v-for="m in claudeModes"
            :key="m.value"
            :class="[
              'config-mode-tab',
              profiles.claude.mode === m.value
                ? 'config-mode-tab-active-claude'
                : 'config-mode-tab-inactive',
            ]"
            :title="m.hint"
            type="button"
            @click="updateClaudeMode(m.value)"
          >
            {{ m.label }}
          </button>
        </div>

        <p class="config-mode-hint">
          {{ claudeModes.find(m => m.value === profiles.claude.mode)?.hint }}
        </p>

        <div v-if="profiles.claude.mode !== 'subscription'" class="config-fields">
          <div class="config-field">
            <label class="config-label">API Key</label>
            <div class="config-input-row">
              <input
                v-model="profiles.claude.apiKey"
                class="config-input"
                :type="isClaudeApiKeyVisible ? 'text' : 'password'"
                placeholder="sk-ant-..."
                autocomplete="off"
              >
              <button
                class="config-toggle-vis"
                type="button"
                @click="isClaudeApiKeyVisible = !isClaudeApiKeyVisible"
              >
                {{ isClaudeApiKeyVisible ? '隐藏' : '显示' }}
              </button>
            </div>
          </div>

          <div v-if="profiles.claude.mode === 'relay'" class="config-field">
            <label class="config-label">Base URL</label>
            <input
              v-model="profiles.claude.baseUrl"
              class="config-input"
              type="url"
              :placeholder="DEFAULT_CLAUDE_RELAY_BASE_URL"
              autocomplete="off"
            >
            <p class="config-field-hint">
              默认值为推荐中转地址。默认模型为 <code>{{ DEFAULT_CLAUDE_MODEL }}</code>，请求路径为 HTTP POST <code>/v1/messages</code>。修改后可能无法使用。
            </p>
          </div>
        </div>

        <div v-else class="config-subscription-note">
          订阅模式下首次启动 Claude Shell 后，在终端内完成 OAuth 授权即可。
        </div>
      </section>

      <!-- Codex -->
      <section class="config-section">
        <div class="config-section-header">
          <span class="config-provider-badge config-provider-codex">Codex</span>
        </div>

        <div class="config-mode-tabs">
          <button
            v-for="m in codexModes"
            :key="m.value"
            :class="[
              'config-mode-tab',
              profiles.codex.mode === m.value
                ? 'config-mode-tab-active-codex'
                : 'config-mode-tab-inactive',
            ]"
            :title="m.hint"
            type="button"
            @click="updateCodexMode(m.value)"
          >
            {{ m.label }}
          </button>
        </div>

        <p class="config-mode-hint">
          {{ codexModes.find(m => m.value === profiles.codex.mode)?.hint }}
        </p>

        <div class="config-fields">
          <div class="config-field">
            <label class="config-label">API Key</label>
            <div class="config-input-row">
              <input
                v-model="profiles.codex.apiKey"
                class="config-input"
                :type="isCodexApiKeyVisible ? 'text' : 'password'"
                placeholder="sk-..."
                autocomplete="off"
              >
              <button
                class="config-toggle-vis"
                type="button"
                @click="isCodexApiKeyVisible = !isCodexApiKeyVisible"
              >
                {{ isCodexApiKeyVisible ? '隐藏' : '显示' }}
              </button>
            </div>
          </div>

          <div v-if="profiles.codex.mode === 'relay'" class="config-field">
            <label class="config-label">Base URL</label>
            <input
              v-model="profiles.codex.baseUrl"
              class="config-input"
              type="url"
              :placeholder="DEFAULT_CODEX_RELAY_BASE_URL"
              autocomplete="off"
            >
            <p class="config-field-hint">
              默认值为推荐中转地址。默认模型为 <code>{{ DEFAULT_CODEX_MODEL }}</code>。修改后可能无法使用。
            </p>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.config-root {
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.78);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(0, 0, 0, 0.06);
  display: flex;
  flex-direction: column;
}

:global(html.dark) .config-root {
  background: rgba(20, 20, 20, 0.88);
  border-color: rgba(255, 255, 255, 0.06);
}

/* ===== Header ===== */
.config-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 14px 14px 8px;
  flex-shrink: 0;
}

.config-title {
  font-size: 14px;
  font-weight: 700;
  color: rgba(0, 0, 0, 0.82);
}

:global(html.dark) .config-title {
  color: rgba(255, 255, 255, 0.88);
}

.config-header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.config-saved {
  font-size: 11px;
  color: rgba(5, 150, 105, 0.85);
}

:global(html.dark) .config-saved {
  color: rgba(52, 211, 153, 0.9);
}

.config-loading {
  font-size: 11px;
  color: rgba(0, 0, 0, 0.35);
}

:global(html.dark) .config-loading {
  color: rgba(255, 255, 255, 0.3);
}

.config-btn-save {
  height: 26px;
  padding: 0 12px;
  border-radius: 8px;
  border: none;
  background: rgba(0, 0, 0, 0.82);
  color: rgba(255, 255, 255, 0.9);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 120ms ease;
  font-family: inherit;
}

.config-btn-restart {
  height: 26px;
  padding: 0 12px;
  border-radius: 8px;
  border: 1px solid rgba(245, 158, 11, 0.24);
  background: rgba(245, 158, 11, 0.1);
  color: rgba(180, 83, 9, 0.92);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 120ms ease, transform 120ms ease;
  font-family: inherit;
}

:global(html.dark) .config-btn-restart {
  border-color: rgba(251, 191, 36, 0.22);
  background: rgba(245, 158, 11, 0.14);
  color: rgba(252, 211, 77, 0.94);
}

.config-btn-restart:hover:not(:disabled) {
  opacity: 0.9;
  transform: translateY(-1px);
}

.config-btn-restart:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  transform: none;
}

:global(html.dark) .config-btn-save {
  background: rgba(255, 255, 255, 0.9);
  color: rgba(0, 0, 0, 0.85);
}

.config-btn-save:hover:not(:disabled) {
  opacity: 0.88;
}

.config-btn-save:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.config-close {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  border: none;
  background: rgba(0, 0, 0, 0.04);
  color: rgba(0, 0, 0, 0.45);
  cursor: pointer;
  transition: all 120ms ease;
  font-size: 18px;
}

:global(html.dark) .config-close {
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.45);
}

.config-close:hover {
  background: rgba(0, 0, 0, 0.08);
  color: rgba(0, 0, 0, 0.72);
}

:global(html.dark) .config-close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.78);
}

/* ===== Desc / Error ===== */
.config-desc {
  font-size: 10.5px;
  color: rgba(0, 0, 0, 0.38);
  line-height: 1.55;
  margin: 0 14px 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
}

:global(html.dark) .config-desc {
  color: rgba(255, 255, 255, 0.35);
  border-bottom-color: rgba(255, 255, 255, 0.05);
}

.config-error {
  margin: 0 14px 8px;
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 11px;
  color: rgba(239, 68, 68, 0.85);
  background: rgba(239, 68, 68, 0.08);
}

/* ===== Body ===== */
.config-body {
  flex: 1;
  padding: 10px 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* ===== Section ===== */
.config-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.config-section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}

.config-provider-badge {
  display: inline-flex;
  border-radius: 9999px;
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.03em;
}

.config-provider-claude {
  background: rgba(245, 158, 11, 0.1);
  color: rgba(217, 119, 6, 0.85);
}

:global(html.dark) .config-provider-claude {
  background: rgba(245, 158, 11, 0.1);
  color: rgba(251, 191, 36, 0.9);
}

.config-provider-codex {
  background: rgba(14, 165, 233, 0.1);
  color: rgba(2, 132, 199, 0.85);
}

:global(html.dark) .config-provider-codex {
  background: rgba(14, 165, 233, 0.1);
  color: rgba(56, 189, 248, 0.9);
}

/* ===== Mode Tabs ===== */
.config-mode-tabs {
  display: flex;
  gap: 3px;
}

.config-mode-tab {
  height: 26px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid transparent;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 120ms ease;
  font-family: inherit;
}

.config-mode-tab-inactive {
  background: rgba(0, 0, 0, 0.04);
  border-color: rgba(0, 0, 0, 0.07);
  color: rgba(0, 0, 0, 0.5);
}

:global(html.dark) .config-mode-tab-inactive {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.45);
}

.config-mode-tab-inactive:hover {
  background: rgba(0, 0, 0, 0.07);
  color: rgba(0, 0, 0, 0.75);
}

:global(html.dark) .config-mode-tab-inactive:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.75);
}

.config-mode-tab-active-claude {
  background: rgba(245, 158, 11, 0.1);
  border-color: rgba(245, 158, 11, 0.25);
  color: rgba(217, 119, 6, 0.9);
}

:global(html.dark) .config-mode-tab-active-claude {
  background: rgba(245, 158, 11, 0.12);
  border-color: rgba(245, 158, 11, 0.25);
  color: rgba(251, 191, 36, 0.92);
}

.config-mode-tab-active-codex {
  background: rgba(14, 165, 233, 0.1);
  border-color: rgba(14, 165, 233, 0.25);
  color: rgba(2, 132, 199, 0.9);
}

:global(html.dark) .config-mode-tab-active-codex {
  background: rgba(14, 165, 233, 0.12);
  border-color: rgba(14, 165, 233, 0.25);
  color: rgba(56, 189, 248, 0.92);
}

.config-mode-hint {
  font-size: 10.5px;
  color: rgba(0, 0, 0, 0.38);
  line-height: 1.5;
  margin: 0;
}

:global(html.dark) .config-mode-hint {
  color: rgba(255, 255, 255, 0.35);
}

/* ===== Fields ===== */
.config-fields {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.config-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.config-label {
  font-size: 10px;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.4);
  letter-spacing: 0.05em;
}

:global(html.dark) .config-label {
  color: rgba(255, 255, 255, 0.35);
}

.config-input-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.config-input {
  flex: 1;
  min-width: 0;
  height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  background: rgba(255, 255, 255, 0.6);
  font-size: 11.5px;
  font-family: 'DM Mono', monospace;
  color: rgba(0, 0, 0, 0.78);
  outline: none;
  transition: border-color 120ms ease;
}

:global(html.dark) .config-input {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.8);
}

.config-input::placeholder {
  color: rgba(0, 0, 0, 0.25);
}

:global(html.dark) .config-input::placeholder {
  color: rgba(255, 255, 255, 0.2);
}

.config-input:focus {
  border-color: rgba(245, 158, 11, 0.4);
}

:global(html.dark) .config-input:focus {
  border-color: rgba(245, 158, 11, 0.35);
}

.config-toggle-vis {
  height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: transparent;
  font-size: 11px;
  color: rgba(0, 0, 0, 0.45);
  cursor: pointer;
  transition: all 120ms ease;
  font-family: inherit;
  flex-shrink: 0;
}

:global(html.dark) .config-toggle-vis {
  border-color: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.4);
}

.config-toggle-vis:hover {
  background: rgba(0, 0, 0, 0.04);
  color: rgba(0, 0, 0, 0.7);
}

:global(html.dark) .config-toggle-vis:hover {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.7);
}

.config-field-hint {
  font-size: 10px;
  color: rgba(0, 0, 0, 0.3);
  line-height: 1.5;
  margin: 0;
}

:global(html.dark) .config-field-hint {
  color: rgba(255, 255, 255, 0.28);
}

.config-field-hint code {
  font-family: 'DM Mono', monospace;
  font-size: 10px;
  background: rgba(0, 0, 0, 0.05);
  padding: 1px 4px;
  border-radius: 4px;
}

:global(html.dark) .config-field-hint code {
  background: rgba(255, 255, 255, 0.06);
}

/* ===== Subscription Note ===== */
.config-subscription-note {
  border-radius: 8px;
  background: rgba(245, 158, 11, 0.06);
  padding: 8px 10px;
  font-size: 11px;
  color: rgba(217, 119, 6, 0.8);
  line-height: 1.5;
}

:global(html.dark) .config-subscription-note {
  background: rgba(245, 158, 11, 0.08);
  color: rgba(251, 191, 36, 0.85);
}

.config-root {
  border-radius: 26px;
  background: rgba(11, 14, 23, 0.96);
  border-color: rgba(255, 255, 255, 0.06);
  box-shadow: 0 22px 54px rgba(3, 5, 12, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.config-title,
.config-label,
.config-provider-badge,
.config-input {
  color: rgba(242, 245, 255, 0.92);
}

.config-desc,
.config-mode-hint,
.config-field-hint,
.config-loading {
  color: rgba(170, 182, 212, 0.62);
}

.config-mode-tab-inactive,
.config-input,
.config-toggle-vis {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.08);
  color: rgba(220, 228, 247, 0.76);
}

.config-btn-save {
  background: linear-gradient(180deg, #e7f3ff 0%, #d8e9ff 100%);
  color: #192438;
}
</style>
