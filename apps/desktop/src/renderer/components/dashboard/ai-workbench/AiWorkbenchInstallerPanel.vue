<script setup lang="ts">
import type { ElectronWorkspaceSetupCommandStatus } from '../../../../shared/eventa'
import type { WorkbenchSidebarMode } from './models'

import { computed, onMounted } from 'vue'

import { useWorkbenchSetup } from './useWorkbenchSetup'

const props = defineProps<{
  mode: Extract<WorkbenchSidebarMode, 'environment-install' | 'cli-install'>
}>()

const emit = defineEmits<{
  close: []
}>()

const {
  isSetupActionRunning,
  isSetupStatusLoading,
  loadSetupStatus,
  runSetupAction,
  setupActionErrorMessage,
  setupActionResult,
  setupStatus,
} = useWorkbenchSetup()

const panelMeta = computed(() => {
  if (props.mode === 'environment-install') {
    return {
      title: '环境安装',
      description: '自动补齐常用编程环境，当前会安装 Git、Node.js 和 pnpm。',
      accentClass: 'bg-emerald-500/8 text-emerald-700 dark:bg-emerald-400/8 dark:text-emerald-200',
      action: 'install-environment' as const,
      actionLabel: '一键安装环境',
      items: [
        { key: 'git', label: 'Git', description: '代码拉取、分支管理和版本记录' },
        { key: 'node', label: 'Node.js', description: '运行 JavaScript / TypeScript 工具链' },
        { key: 'pnpm', label: 'pnpm', description: '安装依赖和管理 monorepo 工作区' },
      ],
    }
  }

  return {
    title: 'CLI 工具安装',
    description: '自动安装 Claude Code 和 Codex 的命令行工具，装好后终端会话就能直接唤起。',
    accentClass: 'bg-sky-500/8 text-sky-700 dark:bg-sky-400/8 dark:text-sky-200',
    action: 'install-cli-tools' as const,
    actionLabel: '一键安装 CLI',
    items: [
      { key: 'claude', label: 'Claude Code', description: '用于长上下文改造、规划和复杂改动' },
      { key: 'codex', label: 'Codex CLI', description: '用于连续改动、命令执行和快速收口' },
    ],
  }
})

const currentStatuses = computed(() => {
  if (props.mode === 'environment-install') {
    return {
      git: setupStatus.environment.git,
      node: setupStatus.environment.node,
      pnpm: setupStatus.environment.pnpm,
    } as Record<string, ElectronWorkspaceSetupCommandStatus>
  }

  return {
    claude: setupStatus.cli.claude,
    codex: setupStatus.cli.codex,
  } as Record<string, ElectronWorkspaceSetupCommandStatus>
})

const statusSummary = computed(() => {
  const values = Object.values(currentStatuses.value)
  const readyCount = values.filter(item => item.available).length
  return `${readyCount}/${values.length} 已就绪`
})

const currentResult = computed(() => {
  if (!setupActionResult.value || setupActionResult.value.action !== panelMeta.value.action) {
    return null
  }

  return setupActionResult.value
})

async function handleInstall() {
  try {
    await runSetupAction(panelMeta.value.action)
  }
  catch {
    // 错误消息已经在 composable 中维护。
  }
}

onMounted(() => {
  void loadSetupStatus()
})
</script>

<template>
  <div class="panel-root">
    <!-- Header -->
    <div class="panel-header">
      <div class="panel-header-info">
        <span :class="['panel-badge', panelMeta.accentClass]">
          {{ panelMeta.title }}
        </span>
        <div class="panel-title">
          {{ panelMeta.title }}
        </div>
        <p class="panel-desc">
          {{ panelMeta.description }}
        </p>
      </div>
      <button
        class="panel-close"
        type="button"
        title="关闭"
        @click="emit('close')"
      >
        <div class="i-solar:close-circle-linear" />
      </button>
    </div>

    <!-- Status chips -->
    <div class="panel-chips">
      <span class="panel-chip">{{ statusSummary }}</span>
      <span class="panel-chip">{{ setupStatus.packageManager ?? '未识别包管理器' }}</span>
    </div>

    <!-- Error -->
    <p v-if="setupActionErrorMessage" class="panel-error">
      {{ setupActionErrorMessage }}
    </p>

    <!-- Items -->
    <div class="panel-items">
      <article
        v-for="item in panelMeta.items"
        :key="item.key"
        class="panel-item"
      >
        <div class="panel-item-header">
          <div class="panel-item-title">
            {{ item.label }}
          </div>
          <div
            :class="[
              'panel-item-status',
              currentStatuses[item.key]?.available
                ? 'panel-item-status-ready'
                : 'panel-item-status-missing',
            ]"
          >
            {{ currentStatuses[item.key]?.available ? '已安装' : '未安装' }}
          </div>
        </div>
        <p class="panel-item-desc">
          {{ item.description }}
        </p>
        <div class="panel-item-version">
          {{ currentStatuses[item.key]?.version ?? '暂未检测到版本信息' }}
        </div>
      </article>
    </div>

    <!-- Notice -->
    <div class="panel-notice">
      安装过程会调用系统包管理器，部分平台可能要求输入系统密码或弹出授权提示。建议先保持网络可用。
    </div>

    <!-- Actions -->
    <div class="panel-actions">
      <button
        class="panel-btn-primary"
        type="button"
        :disabled="isSetupActionRunning"
        @click="handleInstall"
      >
        {{ isSetupActionRunning ? '安装中...' : panelMeta.actionLabel }}
      </button>
      <button
        class="panel-btn-secondary"
        type="button"
        :disabled="isSetupStatusLoading || isSetupActionRunning"
        @click="loadSetupStatus"
      >
        {{ isSetupStatusLoading ? '刷新中...' : '刷新状态' }}
      </button>
    </div>

    <!-- Result -->
    <div v-if="currentResult" class="panel-result">
      <div class="panel-result-summary">
        {{ currentResult.summary }}
      </div>
      <div class="panel-result-log">
        <div class="panel-result-command">
          {{ currentResult.command }}
        </div>
        <pre class="panel-result-output">{{ currentResult.log || '(无输出)' }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel-root {
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

:global(html.dark) .panel-root {
  background: rgba(20, 20, 20, 0.88);
  border-color: rgba(255, 255, 255, 0.06);
}

/* ===== Header ===== */
.panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding: 14px 14px 10px;
  flex-shrink: 0;
}

.panel-header-info {
  flex: 1;
  min-width: 0;
}

.panel-badge {
  display: inline-flex;
  border-radius: 9999px;
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.03em;
}

.panel-title {
  font-size: 15px;
  font-weight: 700;
  color: rgba(0, 0, 0, 0.82);
  margin-top: 4px;
}

:global(html.dark) .panel-title {
  color: rgba(255, 255, 255, 0.88);
}

.panel-desc {
  font-size: 11px;
  color: rgba(0, 0, 0, 0.4);
  line-height: 1.55;
  margin: 4px 0 0;
}

:global(html.dark) .panel-desc {
  color: rgba(255, 255, 255, 0.38);
}

.panel-close {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: rgba(0, 0, 0, 0.3);
  cursor: pointer;
  transition: all 120ms ease;
  font-size: 16px;
  flex-shrink: 0;
}

:global(html.dark) .panel-close {
  color: rgba(255, 255, 255, 0.3);
}

.panel-close:hover {
  background: rgba(0, 0, 0, 0.06);
  color: rgba(0, 0, 0, 0.6);
}

:global(html.dark) .panel-close:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.6);
}

/* ===== Chips ===== */
.panel-chips {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 14px 10px;
  flex-shrink: 0;
}

.panel-chip {
  height: 22px;
  display: inline-flex;
  align-items: center;
  border-radius: 11px;
  background: rgba(0, 0, 0, 0.06);
  padding: 0 8px;
  font-size: 10px;
  font-weight: 500;
  color: rgba(0, 0, 0, 0.45);
}

:global(html.dark) .panel-chip {
  background: rgba(255, 255, 255, 0.07);
  color: rgba(255, 255, 255, 0.4);
}

/* ===== Error ===== */
.panel-error {
  margin: 0 14px 8px;
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 11px;
  color: rgba(239, 68, 68, 0.85);
  background: rgba(239, 68, 68, 0.08);
}

/* ===== Items ===== */
.panel-items {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 14px;
  flex-shrink: 0;
}

.panel-item {
  border-radius: 10px;
  border: 1px solid rgba(0, 0, 0, 0.06);
  background: rgba(255, 255, 255, 0.5);
  padding: 10px 12px;
}

:global(html.dark) .panel-item {
  border-color: rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.03);
}

.panel-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.panel-item-title {
  font-size: 12px;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.78);
}

:global(html.dark) .panel-item-title {
  color: rgba(255, 255, 255, 0.82);
}

.panel-item-status {
  font-size: 10px;
  font-weight: 600;
  border-radius: 9999px;
  padding: 2px 8px;
  flex-shrink: 0;
}

.panel-item-status-ready {
  background: rgba(16, 185, 129, 0.1);
  color: rgba(5, 150, 105, 0.85);
}

:global(html.dark) .panel-item-status-ready {
  background: rgba(16, 185, 129, 0.12);
  color: rgba(52, 211, 153, 0.9);
}

.panel-item-status-missing {
  background: rgba(0, 0, 0, 0.06);
  color: rgba(0, 0, 0, 0.4);
}

:global(html.dark) .panel-item-status-missing {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.35);
}

.panel-item-desc {
  font-size: 10.5px;
  color: rgba(0, 0, 0, 0.38);
  line-height: 1.5;
  margin: 4px 0 0;
}

:global(html.dark) .panel-item-desc {
  color: rgba(255, 255, 255, 0.35);
}

.panel-item-version {
  font-size: 10px;
  color: rgba(0, 0, 0, 0.28);
  font-family: 'DM Mono', monospace;
  margin-top: 4px;
}

:global(html.dark) .panel-item-version {
  color: rgba(255, 255, 255, 0.25);
}

/* ===== Notice ===== */
.panel-notice {
  margin: 10px 14px 0;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px dashed rgba(0, 0, 0, 0.08);
  background: rgba(255, 255, 255, 0.4);
  font-size: 10.5px;
  color: rgba(0, 0, 0, 0.38);
  line-height: 1.5;
}

:global(html.dark) .panel-notice {
  border-color: rgba(255, 255, 255, 0.07);
  background: rgba(255, 255, 255, 0.02);
  color: rgba(255, 255, 255, 0.32);
}

/* ===== Actions ===== */
.panel-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  flex-shrink: 0;
}

.panel-btn-primary {
  height: 30px;
  padding: 0 14px;
  border-radius: 9px;
  border: none;
  background: rgba(0, 0, 0, 0.82);
  color: rgba(255, 255, 255, 0.9);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 120ms ease;
  font-family: inherit;
}

:global(html.dark) .panel-btn-primary {
  background: rgba(255, 255, 255, 0.9);
  color: rgba(0, 0, 0, 0.85);
}

.panel-btn-primary:hover:not(:disabled) {
  opacity: 0.88;
}

.panel-btn-primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.panel-btn-secondary {
  height: 30px;
  padding: 0 12px;
  border-radius: 9px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  background: transparent;
  color: rgba(0, 0, 0, 0.5);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 120ms ease;
  font-family: inherit;
}

:global(html.dark) .panel-btn-secondary {
  border-color: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.45);
}

.panel-btn-secondary:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.04);
  color: rgba(0, 0, 0, 0.75);
}

:global(html.dark) .panel-btn-secondary:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.75);
}

.panel-btn-secondary:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* ===== Result ===== */
.panel-result {
  padding: 0 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}

.panel-result-summary {
  font-size: 11px;
  color: rgba(0, 0, 0, 0.45);
}

:global(html.dark) .panel-result-summary {
  color: rgba(255, 255, 255, 0.4);
}

.panel-result-log {
  border-radius: 10px;
  border: 1px solid rgba(0, 0, 0, 0.06);
  background: rgba(0, 0, 0, 0.04);
  padding: 10px 12px;
  overflow: hidden;
}

:global(html.dark) .panel-result-log {
  border-color: rgba(255, 255, 255, 0.06);
  background: rgba(0, 0, 0, 0.3);
}

.panel-result-command {
  font-size: 10px;
  color: rgba(0, 0, 0, 0.3);
  font-family: 'DM Mono', monospace;
  margin-bottom: 6px;
}

:global(html.dark) .panel-result-command {
  color: rgba(255, 255, 255, 0.25);
}

.panel-result-output {
  font-size: 10.5px;
  color: rgba(255, 255, 255, 0.75);
  font-family: 'DM Mono', monospace;
  line-height: 1.6;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 160px;
  overflow-y: auto;
}

:global(html.dark) .panel-result-output {
  color: rgba(255, 255, 255, 0.75);
}

.panel-root {
  border-radius: 26px;
  background: rgba(11, 14, 23, 0.96);
  border-color: rgba(255, 255, 255, 0.06);
  box-shadow: 0 22px 54px rgba(3, 5, 12, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.panel-title,
.panel-item-title,
.panel-item-version,
.panel-result-output {
  color: rgba(242, 245, 255, 0.92);
}

.panel-desc,
.panel-result-summary,
.panel-result-command,
.panel-notice,
.panel-item-desc {
  color: rgba(170, 182, 212, 0.62);
}

.panel-chip,
.panel-item,
.panel-result-log,
.panel-btn-secondary {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.08);
  color: rgba(220, 228, 247, 0.76);
}

.panel-btn-primary {
  background: linear-gradient(180deg, #e7f3ff 0%, #d8e9ff 100%);
  color: #192438;
}
</style>
