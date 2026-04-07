<script setup lang="ts">
import { computed } from 'vue'

import AiWorkbench from '../../components/dashboard/AiWorkbench.vue'

import { useDashboardPresentationState } from '../../components/dashboard/useDashboardPresentationState'
import { useIslandState } from '../../components/island/useIslandState'

const {
  activeWorkbenchId,
  activeSessionId,
  sidebarModeModel,
  setActiveSessionId,
  setVariant,
  toggleSidebarMode,
} = useDashboardPresentationState()

const {
  islandState,
  pendingApproval,
  profileLabel,
  respondApproval,
} = useIslandState()

const workspacePillLabel = computed(() => islandState.value.rootPath || 'No workspace selected')

const approvalPreviewLines = computed(() => {
  const preview = pendingApproval.value?.codePreview || pendingApproval.value?.description || ''
  return preview
    .split('\n')
    .map(line => line.trimEnd())
    .filter(Boolean)
    .slice(0, 5)
})
</script>

<template>
  <div class="dashboard-workspace-window">
    <AiWorkbench
      v-model:sidebar-mode="sidebarModeModel"
      :variant="activeWorkbenchId"
      :sessions="islandState.sessions ?? []"
      :active-session-id="activeSessionId"
      @update-variant="value => void setVariant(value)"
      @update:active-session-id="value => void setActiveSessionId(value)"
    />

    <Transition
      enter-active-class="transition-all duration-300 ease-out"
      enter-from-class="opacity-0 translate-y-2 scale-95"
      enter-to-class="opacity-100 translate-y-0 scale-100"
      leave-active-class="transition-all duration-180 ease-in"
      leave-from-class="opacity-100 translate-y-0 scale-100"
      leave-to-class="opacity-0 translate-y-2 scale-95"
    >
      <div v-if="pendingApproval" class="approval-overlay">
        <div class="approval-card">
          <div class="approval-card__meta">
            <span class="approval-card__profile">{{ profileLabel }}</span>
            <span class="approval-card__dot" />
            <span>{{ pendingApproval.type }}</span>
            <span class="approval-card__dot" />
            <span>{{ islandState.projectName }}</span>
          </div>

          <div class="approval-card__title">
            {{ pendingApproval.description || 'Pending action' }}
          </div>

          <div class="approval-card__path">
            {{ pendingApproval.filePath || workspacePillLabel }}
          </div>

          <div class="approval-card__preview">
            <div
              v-for="(line, index) in approvalPreviewLines"
              :key="`${index}-${line}`"
              :class="[
                'approval-card__line',
                line.startsWith('+') ? 'approval-card__line--add' : '',
                line.startsWith('-') ? 'approval-card__line--remove' : '',
              ]"
            >
              {{ line }}
            </div>
          </div>

          <div class="approval-card__actions">
            <button
              class="approval-card__button approval-card__button--ghost"
              type="button"
              @click="void respondApproval('deny')"
            >
              Deny
            </button>
            <button
              class="approval-card__button approval-card__button--primary"
              type="button"
              @click="void respondApproval('allow')"
            >
              Allow Once
            </button>
            <button
              class="approval-card__button approval-card__button--accent"
              type="button"
              @click="void toggleSidebarMode('api-config')"
            >
              Workspace
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.dashboard-workspace-window {
  position: relative;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  display: flex;
  background: #090c13;
}

.approval-overlay {
  position: absolute;
  inset: 0;
  z-index: 6;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  pointer-events: none;
}

.approval-card {
  pointer-events: auto;
  width: min(720px, calc(100vw - 96px));
  border-radius: 26px;
  background:
    linear-gradient(180deg, rgba(9, 12, 21, 0.985) 0%, rgba(8, 10, 17, 0.94) 100%);
  box-shadow:
    0 22px 60px rgba(4, 6, 12, 0.5),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
  padding: 18px;
}

.approval-card__meta,
.approval-card__path {
  display: flex;
  align-items: center;
  gap: 8px;
  color: rgba(183, 195, 224, 0.76);
  font-family: 'DM Mono', 'SFMono-Regular', Consolas, monospace;
  font-size: 12px;
}

.approval-card__profile {
  color: #91bbff;
}

.approval-card__dot {
  height: 4px;
  width: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.24);
}

.approval-card__title {
  margin-top: 12px;
  color: rgba(247, 249, 255, 0.98);
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.approval-card__path {
  margin-top: 8px;
}

.approval-card__preview {
  margin-top: 16px;
  border-radius: 18px;
  background: rgba(15, 18, 27, 0.84);
  padding: 12px;
}

.approval-card__line {
  border-radius: 10px;
  color: rgba(227, 233, 250, 0.78);
  font-family: 'DM Mono', 'SFMono-Regular', Consolas, monospace;
  font-size: 12px;
  padding: 8px 10px;
}

.approval-card__line + .approval-card__line {
  margin-top: 4px;
}

.approval-card__line--add {
  background: rgba(33, 88, 56, 0.82);
  color: rgba(224, 255, 232, 0.96);
}

.approval-card__line--remove {
  background: rgba(89, 32, 41, 0.84);
  color: rgba(255, 222, 228, 0.96);
}

.approval-card__actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 16px;
}

.approval-card__button {
  border: 0;
  border-radius: 14px;
  cursor: pointer;
  font-family: 'DM Mono', 'SFMono-Regular', Consolas, monospace;
  font-size: 13px;
  font-weight: 600;
  min-height: 44px;
  transition: transform 0.18s ease, opacity 0.18s ease;
}

.approval-card__button:hover {
  transform: translateY(-1px);
}

.approval-card__button--ghost {
  background: rgba(33, 38, 54, 0.96);
  color: rgba(229, 233, 247, 0.92);
}

.approval-card__button--primary {
  background: linear-gradient(180deg, #e7f3ff 0%, #d8e9ff 100%);
  color: #1a2336;
}

.approval-card__button--accent {
  background: linear-gradient(180deg, #e87f59 0%, #d85c57 100%);
  color: rgba(255, 247, 244, 0.98);
}

@media (max-width: 960px) {
  .approval-card__actions {
    grid-template-columns: 1fr;
  }
}
</style>

<route lang="yaml">
meta:
  layout: stage
</route>
