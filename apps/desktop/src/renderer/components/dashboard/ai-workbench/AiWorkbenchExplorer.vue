<script setup lang="ts">
import type { ElectronWorkspaceDirectoryEntry } from '../../../../shared/eventa'
import type { WorkbenchSidebarMode, WorkbenchVariant, WorkspaceEntryType, WorkspaceTreeNode } from './models'

import { computed, ref } from 'vue'

import AiWorkbenchExplorerNode from './AiWorkbenchExplorerNode.vue'

const props = defineProps<{
  rootPath: string
  selectedPath: string | null
  selectedEntryType: WorkspaceEntryType | null
  activeFilePath: string | null
  loadingRoot: boolean
  rootSelectionPending: boolean
  expandedDirectoryPaths: Set<string>
  loadingDirectoryPaths: Set<string>
  directoryEntriesByPath: Record<string, ElectronWorkspaceDirectoryEntry[]>
  selectedDirectoryLabel: string
  sidebarMode?: WorkbenchSidebarMode | null
  variant?: WorkbenchVariant
}>()

const emit = defineEmits<{
  selectEntry: [node: WorkspaceTreeNode]
  openFile: [path: string]
  toggleDirectory: [path: string]
  pickRoot: []
  refresh: []
  createFile: []
  createDirectory: []
  renameEntry: []
  deleteEntry: []
  toggleApiConfig: []
}>()

const searchQuery = ref('')

const rootNode = computed<WorkspaceTreeNode | null>(() => {
  if (!props.rootPath) {
    return null
  }

  return {
    name: 'Workspace',
    path: props.rootPath,
    type: 'directory',
    depth: 0,
    parentPath: null,
    isRoot: true,
  }
})

const canRename = computed(() => Boolean(props.selectedPath && props.selectedPath !== props.rootPath))
const canDelete = computed(() => canRename.value)
</script>

<template>
  <div class="explorer-panel">
    <!-- Header -->
    <div class="explorer-header">
      <div class="explorer-title-row">
        <span class="explorer-title">资源管理器</span>
        <div class="explorer-header-actions">
          <button
            class="explorer-icon-btn"
            type="button"
            title="刷新目录"
            @click="emit('refresh')"
          >
            <div class="i-solar:refresh-linear" />
          </button>
          <button
            class="explorer-icon-btn"
            type="button"
            :title="props.rootPath ? '切换工作区目录' : '打开工作区目录'"
            :disabled="props.loadingRoot || props.rootSelectionPending"
            @click="emit('pickRoot')"
          >
            <div class="i-solar:folder-open-linear" />
          </button>
        </div>
      </div>

      <!-- Search -->
      <div class="explorer-search">
        <div class="i-solar:magnifer-linear explorer-search-icon" />
        <input
          v-model="searchQuery"
          class="explorer-search-input"
          type="text"
          placeholder="搜索文件..."
        >
      </div>
    </div>

    <!-- Workspace Label -->
    <div class="explorer-workspace-label">
      <span class="workspace-label-text">WORKSPACE</span>
      <button
        v-if="sidebarMode === 'api-config'"
        class="workspace-api-btn"
        type="button"
        title="API 配置"
        @click="emit('toggleApiConfig')"
      >
        <div class="i-solar:settings-linear" />
      </button>
    </div>

    <!-- Tree -->
    <div class="explorer-tree">
      <div v-if="props.loadingRoot" class="explorer-empty">
        正在初始化工作区...
      </div>

      <AiWorkbenchExplorerNode
        v-else-if="rootNode"
        :node="rootNode"
        :selected-path="props.selectedPath"
        :active-file-path="props.activeFilePath"
        :expanded-directory-paths="props.expandedDirectoryPaths"
        :loading-directory-paths="props.loadingDirectoryPaths"
        :directory-entries-by-path="props.directoryEntriesByPath"
        @select-entry="emit('selectEntry', $event)"
        @open-file="emit('openFile', $event)"
        @toggle-directory="emit('toggleDirectory', $event)"
      />
    </div>

    <!-- Action Bar -->
    <div class="explorer-actions">
      <button
        class="explorer-action-btn"
        type="button"
        @click="emit('createFile')"
      >
        <div class="i-solar:file-create-linear" />
        <span>新建文件</span>
      </button>
      <button
        class="explorer-action-btn"
        type="button"
        @click="emit('createDirectory')"
      >
        <div class="i-solar:folder-create-linear" />
        <span>新建目录</span>
      </button>
      <button
        class="explorer-action-btn"
        type="button"
        :disabled="!canRename"
        @click="emit('renameEntry')"
      >
        <div class="i-solar:text-editing-linear" />
        <span>重命名</span>
      </button>
      <button
        class="explorer-action-btn explorer-action-btn-danger"
        type="button"
        :disabled="!canDelete"
        @click="emit('deleteEntry')"
      >
        <div class="i-solar:trash-bin-trash-linear" />
        <span>删除</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.explorer-panel {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.75);
  backdrop-filter: blur(16px) saturate(180%);
  -webkit-backdrop-filter: blur(16px) saturate(180%);
  border: 1px solid rgba(0, 0, 0, 0.06);
}

:global(html.dark) .explorer-panel {
  background: rgba(20, 20, 20, 0.85);
  border-color: rgba(255, 255, 255, 0.06);
}

/* ===== Header ===== */
.explorer-header {
  padding: 10px 10px 6px;
  flex-shrink: 0;
}

.explorer-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.explorer-title {
  font-size: 11px;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.6);
  letter-spacing: 0.05em;
}

:global(html.dark) .explorer-title {
  color: rgba(255, 255, 255, 0.55);
}

.explorer-header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.explorer-icon-btn {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: rgba(0, 0, 0, 0.4);
  cursor: pointer;
  transition: all 120ms ease;
  font-size: 14px;
}

:global(html.dark) .explorer-icon-btn {
  color: rgba(255, 255, 255, 0.35);
}

.explorer-icon-btn:hover {
  background: rgba(0, 0, 0, 0.06);
  color: rgba(0, 0, 0, 0.7);
}

:global(html.dark) .explorer-icon-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.7);
}

/* ===== Search ===== */
.explorer-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  height: 28px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.04);
  border: 1px solid rgba(0, 0, 0, 0.06);
}

:global(html.dark) .explorer-search {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.07);
}

.explorer-search-icon {
  font-size: 13px;
  color: rgba(0, 0, 0, 0.3);
  flex-shrink: 0;
}

:global(html.dark) .explorer-search-icon {
  color: rgba(255, 255, 255, 0.3);
}

.explorer-search-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  font-size: 11.5px;
  color: rgba(0, 0, 0, 0.75);
  font-family: inherit;
}

.explorer-search-input::placeholder {
  color: rgba(0, 0, 0, 0.3);
}

:global(html.dark) .explorer-search-input {
  color: rgba(255, 255, 255, 0.7);
}

:global(html.dark) .explorer-search-input::placeholder {
  color: rgba(255, 255, 255, 0.25);
}

/* ===== Workspace Label ===== */
.explorer-workspace-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px 4px;
  flex-shrink: 0;
}

.workspace-label-text {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.22em;
  color: rgba(0, 0, 0, 0.3);
  text-transform: uppercase;
}

:global(html.dark) .workspace-label-text {
  color: rgba(255, 255, 255, 0.25);
}

.workspace-api-btn {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: rgba(0, 0, 0, 0.3);
  cursor: pointer;
  transition: all 120ms ease;
  font-size: 12px;
}

:global(html.dark) .workspace-api-btn {
  color: rgba(255, 255, 255, 0.25);
}

.workspace-api-btn:hover {
  background: rgba(0, 0, 0, 0.06);
  color: rgba(0, 0, 0, 0.6);
}

:global(html.dark) .workspace-api-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.6);
}

/* ===== Tree ===== */
.explorer-tree {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 2px 6px;
}

.explorer-empty {
  padding: 12px;
  font-size: 11px;
  color: rgba(0, 0, 0, 0.35);
}

:global(html.dark) .explorer-empty {
  color: rgba(255, 255, 255, 0.3);
}

/* ===== Action Bar ===== */
.explorer-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 8px 8px;
  flex-shrink: 0;
  border-top: 1px solid rgba(0, 0, 0, 0.05);
}

:global(html.dark) .explorer-actions {
  border-top-color: rgba(255, 255, 255, 0.05);
}

.explorer-action-btn {
  flex: 1;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border-radius: 7px;
  border: 1px solid rgba(0, 0, 0, 0.06);
  background: rgba(255, 255, 255, 0.5);
  font-size: 10px;
  font-weight: 500;
  color: rgba(0, 0, 0, 0.5);
  cursor: pointer;
  transition: all 120ms ease;
  padding: 0 4px;
  font-family: inherit;
}

:global(html.dark) .explorer-action-btn {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.07);
  color: rgba(255, 255, 255, 0.4);
}

.explorer-action-btn:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.06);
  color: rgba(0, 0, 0, 0.8);
  border-color: rgba(0, 0, 0, 0.1);
}

:global(html.dark) .explorer-action-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.09);
  color: rgba(255, 255, 255, 0.8);
  border-color: rgba(255, 255, 255, 0.12);
}

.explorer-action-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.explorer-action-btn-danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.08);
  color: rgba(239, 68, 68, 0.85);
  border-color: rgba(239, 68, 68, 0.15);
}

:global(html.dark) .explorer-action-btn-danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.12);
  color: rgba(252, 165, 165, 0.9);
  border-color: rgba(239, 68, 68, 0.2);
}

.explorer-panel {
  background: rgba(14, 17, 27, 0.84);
  border-color: rgba(255, 255, 255, 0.06);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

.explorer-title,
.workspace-label-text,
.explorer-search-icon,
.explorer-search-input::placeholder,
.explorer-empty {
  color: rgba(155, 168, 198, 0.5);
}

.explorer-search,
.explorer-action-btn,
.workspace-api-btn {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.07);
  color: rgba(214, 223, 243, 0.72);
}

.explorer-icon-btn,
.explorer-search-input,
.workspace-label-text,
.explorer-action-btn {
  color: rgba(214, 223, 243, 0.72);
}

.explorer-icon-btn:hover,
.explorer-action-btn:hover:not(:disabled),
.workspace-api-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(248, 250, 255, 0.96);
}

.explorer-actions {
  border-top-color: rgba(255, 255, 255, 0.05);
}
</style>
