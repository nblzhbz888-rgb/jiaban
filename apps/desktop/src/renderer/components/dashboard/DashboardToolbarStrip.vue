<script setup lang="ts">
import type { WorkbenchSidebarMode, WorkbenchVariant } from './ai-workbench/models'

const props = defineProps<{
  variant: WorkbenchVariant
  sidebarMode: WorkbenchSidebarMode | null
  workspaceLabel: string
}>()

const emit = defineEmits<{
  updateVariant: [value: WorkbenchVariant]
  toggleSidebar: [value: WorkbenchSidebarMode]
}>()

const stageTools: Array<{ id: WorkbenchVariant, shortLabel: string }> = [
  { id: 'claude', shortLabel: 'Claude' },
  { id: 'codex', shortLabel: 'Codex' },
]

const stageActions: Array<{ id: WorkbenchSidebarMode, label: string }> = [
  { id: 'environment-install', label: '环境' },
  { id: 'cli-install', label: 'CLI' },
  { id: 'api-config', label: 'API' },
]
</script>

<template>
  <div class="toolbar-strip">
    <div class="toolbar-strip__group toolbar-strip__group--interactive">
      <button
        v-for="tool in stageTools"
        :key="tool.id"
        :class="[
          'toolbar-strip__pill',
          props.variant === tool.id ? 'toolbar-strip__pill--active' : '',
        ]"
        type="button"
        @click="emit('updateVariant', tool.id)"
      >
        {{ tool.shortLabel }}
      </button>
    </div>

    <div class="toolbar-strip__path">
      {{ props.workspaceLabel }}
    </div>

    <div class="toolbar-strip__group toolbar-strip__group--interactive">
      <button
        v-for="action in stageActions"
        :key="action.id"
        :class="[
          'toolbar-strip__pill',
          props.sidebarMode === action.id ? 'toolbar-strip__pill--active' : '',
        ]"
        type="button"
        @click="emit('toggleSidebar', action.id)"
      >
        {{ action.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.toolbar-strip {
  display: grid;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  app-region: drag;
}

.toolbar-strip__group {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.toolbar-strip__group--interactive {
  app-region: no-drag;
}

.toolbar-strip__path,
.toolbar-strip__pill {
  min-height: 48px;
  border: 0;
  border-radius: 999px;
  background: rgba(31, 33, 42, 0.92);
  box-shadow:
    0 18px 36px rgba(5, 7, 14, 0.18),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
  color: rgba(214, 221, 240, 0.74);
  font-family: 'DM Mono', 'SFMono-Regular', Consolas, monospace;
  font-size: 12px;
}

.toolbar-strip__path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 20px;
  display: flex;
  align-items: center;
}

.toolbar-strip__pill {
  cursor: pointer;
  padding: 0 18px;
  transition: transform 0.18s ease, background-color 0.18s ease, color 0.18s ease;
}

.toolbar-strip__pill:hover,
.toolbar-strip__pill--active {
  background: rgba(15, 17, 25, 0.98);
  color: rgba(247, 249, 255, 0.98);
  transform: translateY(-1px);
}
</style>
