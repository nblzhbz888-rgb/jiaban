<script setup lang="ts">
import type { ElectronWorkspaceDirectoryEntry } from '../../../../shared/eventa'
import type { WorkspaceTreeNode } from './models'

import { computed } from 'vue'

defineOptions({
  name: 'AiWorkbenchExplorerNode',
})

const props = defineProps<{
  node: WorkspaceTreeNode
  selectedPath: string | null
  activeFilePath: string | null
  expandedDirectoryPaths: Set<string>
  loadingDirectoryPaths: Set<string>
  directoryEntriesByPath: Record<string, ElectronWorkspaceDirectoryEntry[]>
}>()

const emit = defineEmits<{
  selectEntry: [node: WorkspaceTreeNode]
  openFile: [path: string]
  toggleDirectory: [path: string]
}>()

const isSelected = computed(() => props.selectedPath === props.node.path)
const isActiveFile = computed(() => props.activeFilePath === props.node.path)
const isExpanded = computed(() => props.node.isRoot || props.expandedDirectoryPaths.has(props.node.path))
const isLoading = computed(() => props.loadingDirectoryPaths.has(props.node.path))
const childEntries = computed(() => props.directoryEntriesByPath[props.node.path] ?? [])
const childNodes = computed<WorkspaceTreeNode[]>(() => childEntries.value.map(entry => ({
  name: entry.name,
  path: entry.path,
  type: entry.type,
  depth: props.node.depth + 1,
  parentPath: props.node.path,
})))

function handleEntryClick() {
  emit('selectEntry', props.node)

  if (props.node.type === 'file') {
    emit('openFile', props.node.path)
  }
}

function handleDirectoryToggle() {
  if (props.node.type !== 'directory' || props.node.isRoot) {
    return
  }

  emit('toggleDirectory', props.node.path)
}
</script>

<template>
  <div class="node-root">
    <div
      :class="[
        'node-row',
        isSelected
          ? 'node-row-selected'
          : isActiveFile
            ? 'node-row-active'
            : 'node-row-default',
      ]"
      :style="{ paddingLeft: `${Math.max(0.5, props.node.depth * 0.75 + 0.5)}rem` }"
    >
      <button
        v-if="props.node.type === 'directory' && !props.node.isRoot"
        class="node-toggle"
        type="button"
        @click.stop="handleDirectoryToggle"
      >
        <div :class="['node-toggle-icon', isExpanded ? 'node-toggle-expanded' : '']" />
      </button>
      <div v-else class="node-toggle-placeholder" />

      <button
        class="node-label"
        type="button"
        @click="handleEntryClick"
        @dblclick="props.node.type === 'directory' ? handleDirectoryToggle() : undefined"
      >
        <div
          :class="[
            props.node.type === 'directory'
              ? props.node.isRoot
                ? 'i-solar:widget-6-bold-duotone'
                : isExpanded
                  ? 'i-solar:folder-open-bold-duotone'
                  : 'i-solar:folder-with-files-bold-duotone'
              : 'i-solar:document-text-bold-duotone',
            'node-icon',
          ]"
        />
        <span class="node-name">{{ props.node.isRoot ? 'Workspace' : props.node.name }}</span>
      </button>
    </div>

    <div
      v-if="props.node.type === 'directory' && isExpanded"
      class="node-children"
    >
      <div
        v-if="isLoading"
        :style="{ paddingLeft: `${(props.node.depth + 1) * 0.75 + 0.5}rem` }"
        class="node-loading"
      >
        正在读取目录...
      </div>

      <template v-else-if="childNodes.length > 0">
        <AiWorkbenchExplorerNode
          v-for="childNode in childNodes"
          :key="childNode.path"
          :node="childNode"
          :selected-path="props.selectedPath"
          :active-file-path="props.activeFilePath"
          :expanded-directory-paths="props.expandedDirectoryPaths"
          :loading-directory-paths="props.loadingDirectoryPaths"
          :directory-entries-by-path="props.directoryEntriesByPath"
          @select-entry="emit('selectEntry', $event)"
          @open-file="emit('openFile', $event)"
          @toggle-directory="emit('toggleDirectory', $event)"
        />
      </template>

      <div
        v-else
        :style="{ paddingLeft: `${(props.node.depth + 1) * 0.75 + 0.5}rem` }"
        class="node-empty"
      >
        空目录
      </div>
    </div>
  </div>
</template>

<style scoped>
.node-root {
  min-width: 0;
}

.node-row {
  display: flex;
  align-items: center;
  gap: 2px;
  border-radius: 8px;
  height: 26px;
  margin: 1px 0;
  transition: background-color 100ms ease;
  padding-right: 4px;
}

.node-row-default {
  background: transparent;
}

.node-row-default:hover {
  background: rgba(0, 0, 0, 0.05);
}

:global(html.dark) .node-row-default:hover {
  background: rgba(255, 255, 255, 0.06);
}

.node-row-selected {
  background: rgba(0, 0, 0, 0.08);
}

:global(html.dark) .node-row-selected {
  background: rgba(255, 255, 255, 0.1);
}

.node-row-active {
  background: rgba(0, 0, 0, 0.05);
}

:global(html.dark) .node-row-active {
  background: rgba(255, 255, 255, 0.06);
}

.node-toggle {
  width: 18px;
  height: 18px;
  min-width: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 4px;
  transition: background-color 100ms ease;
  padding: 0;
}

.node-toggle:hover {
  background: rgba(0, 0, 0, 0.08);
}

:global(html.dark) .node-toggle:hover {
  background: rgba(255, 255, 255, 0.1);
}

.node-toggle-icon {
  width: 0;
  height: 0;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  border-left: 5px solid rgba(0, 0, 0, 0.35);
  transition: transform 120ms ease;
}

:global(html.dark) .node-toggle-icon {
  border-left-color: rgba(255, 255, 255, 0.35);
}

.node-toggle-expanded {
  transform: rotate(90deg);
}

.node-toggle-placeholder {
  width: 18px;
  min-width: 18px;
}

.node-label {
  flex: 1;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 100%;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  padding: 0;
  font-family: inherit;
}

.node-icon {
  font-size: 14px;
  min-width: 16px;
  color: rgba(0, 0, 0, 0.45);
  flex-shrink: 0;
}

:global(html.dark) .node-icon {
  color: rgba(255, 255, 255, 0.4);
}

.node-name {
  font-size: 11.5px;
  font-weight: 450;
  color: rgba(0, 0, 0, 0.72);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

:global(html.dark) .node-name {
  color: rgba(255, 255, 255, 0.7);
}

.node-children {
  margin-left: 0;
}

.node-loading,
.node-empty {
  font-size: 10.5px;
  color: rgba(0, 0, 0, 0.3);
  padding: 4px 0;
}

:global(html.dark) .node-loading,
:global(html.dark) .node-empty {
  color: rgba(255, 255, 255, 0.25);
}

.node-row-default:hover,
.node-row-active,
.node-toggle:hover {
  background: rgba(255, 255, 255, 0.08);
}

.node-row-selected {
  background: rgba(74, 113, 255, 0.18);
}

.node-toggle-icon {
  border-left-color: rgba(214, 223, 243, 0.44);
}

.node-icon {
  color: rgba(176, 193, 255, 0.72);
}

.node-name,
.node-loading,
.node-empty {
  color: rgba(223, 230, 247, 0.74);
}
</style>
