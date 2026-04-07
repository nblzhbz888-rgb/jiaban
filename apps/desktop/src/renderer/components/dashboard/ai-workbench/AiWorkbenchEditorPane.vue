<script setup lang="ts">
import type * as Monaco from 'monaco-editor'

import type { WorkbenchVariant, WorkspaceEditorTab } from './models'

import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

import { useResizeObserver } from '@vueuse/core'
import { computed, nextTick, onMounted, onUnmounted, shallowRef, useTemplateRef, watch } from 'vue'

import { getEntryName } from './models'

const props = defineProps<{
  currentTab: WorkspaceEditorTab | null
  openTabs: WorkspaceEditorTab[]
  loadingFile: boolean
  savingFile: boolean
  canSave: boolean
  errorMessage: string
  variant?: WorkbenchVariant
}>()

const emit = defineEmits<{
  updateTabContent: [payload: { path: string, content: string }]
  selectTab: [path: string]
  closeTab: [path: string]
  save: []
}>()

const TYPESCRIPT_FILE_RE = /\.(?:ts|tsx|mts|cts)$/
const JAVASCRIPT_FILE_RE = /\.(?:js|jsx|mjs|cjs)$/
const VUE_FILE_RE = /\.vue$/
const JSON_FILE_RE = /\.(?:json|jsonc)$/
const MARKDOWN_FILE_RE = /\.(?:md|mdx)$/
const YAML_FILE_RE = /\.ya?ml$/
const CSS_FILE_RE = /\.css$/
const STYLE_FILE_RE = /\.(?:scss|sass|less)$/
const HTML_FILE_RE = /\.html?$/
const RUST_FILE_RE = /\.rs$/
const PYTHON_FILE_RE = /\.py$/
const SHELL_FILE_RE = /\.sh$/

const editorContainerRef = useTemplateRef<HTMLDivElement>('editorContainer')
const monacoModule = shallowRef<typeof Monaco | null>(null)
const monacoEditor = shallowRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
const ownedModelPaths = shallowRef(new Set<string>())

const editorStateLabel = computed(() => {
  if (props.loadingFile) {
    return '正在读取文件...'
  }

  if (!props.currentTab) {
    return '从左侧资源树打开文件开始编辑。'
  }

  const sizeLabel = `${(props.currentTab.snapshot.size / 1024).toFixed(1)} KB`
  if (props.currentTab.snapshot.isBinary) {
    return `${sizeLabel} · 二进制文件不可编辑`
  }

  if (props.currentTab.snapshot.tooLarge) {
    return `${sizeLabel} · 文件过大，仅加载前 512 KB`
  }

  return sizeLabel
})

function getLanguageFromPath(path: string) {
  if (TYPESCRIPT_FILE_RE.test(path))
    return 'typescript'
  if (JAVASCRIPT_FILE_RE.test(path))
    return 'javascript'
  if (VUE_FILE_RE.test(path))
    return 'html'
  if (JSON_FILE_RE.test(path))
    return 'json'
  if (MARKDOWN_FILE_RE.test(path))
    return 'markdown'
  if (YAML_FILE_RE.test(path))
    return 'yaml'
  if (CSS_FILE_RE.test(path))
    return 'css'
  if (STYLE_FILE_RE.test(path))
    return 'scss'
  if (HTML_FILE_RE.test(path))
    return 'html'
  if (RUST_FILE_RE.test(path))
    return 'rust'
  if (PYTHON_FILE_RE.test(path))
    return 'python'
  if (SHELL_FILE_RE.test(path))
    return 'shell'

  return 'plaintext'
}

function disposeRemovedModels() {
  if (!monacoModule.value) {
    return
  }

  const nextPaths = new Set(props.openTabs.map(tab => tab.path))
  for (const path of ownedModelPaths.value) {
    if (nextPaths.has(path)) {
      continue
    }

    monacoModule.value.editor.getModel(monacoModule.value.Uri.file(path))?.dispose()
    ownedModelPaths.value.delete(path)
  }
}

function syncEditorModel() {
  if (!monacoModule.value || !monacoEditor.value) {
    return
  }

  disposeRemovedModels()

  const current = props.currentTab
  if (!current) {
    monacoEditor.value.setModel(null)
    monacoEditor.value.updateOptions({ readOnly: true })
    return
  }

  const uri = monacoModule.value.Uri.file(current.path)
  let model = monacoModule.value.editor.getModel(uri)

  if (!model) {
    model = monacoModule.value.editor.createModel(current.content, getLanguageFromPath(current.path), uri)
    ownedModelPaths.value.add(current.path)
  }
  else if (model.getValue() !== current.content) {
    model.setValue(current.content)
  }

  monacoModule.value.editor.setModelLanguage(model, getLanguageFromPath(current.path))
  monacoEditor.value.setModel(model)
  monacoEditor.value.updateOptions({
    readOnly: current.snapshot.isBinary || current.snapshot.tooLarge,
  })
  monacoEditor.value.focus()
}

async function setupMonacoEditor() {
  if (!editorContainerRef.value) {
    return
  }

  ;(globalThis as typeof globalThis & {
    MonacoEnvironment?: {
      getWorker: (_moduleId: string, label: string) => Worker
    }
  }).MonacoEnvironment = {
    getWorker(_, label) {
      if (label === 'json')
        return new JsonWorker()
      if (label === 'css' || label === 'scss' || label === 'less')
        return new CssWorker()
      if (label === 'html' || label === 'handlebars' || label === 'razor')
        return new HtmlWorker()
      if (label === 'typescript' || label === 'javascript')
        return new TsWorker()
      return new EditorWorker()
    },
  }

  monacoModule.value = await import('monaco-editor')
  const monacoTypescript: any = monacoModule.value.languages.typescript

  monacoTypescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  })
  monacoTypescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  })
  monacoTypescript.typescriptDefaults.setCompilerOptions({
    allowNonTsExtensions: true,
    allowJs: true,
    module: monacoTypescript.ModuleKind.ESNext,
    moduleResolution: monacoTypescript.ModuleResolutionKind.NodeJs,
    target: monacoTypescript.ScriptTarget.ESNext,
  })
  monacoTypescript.javascriptDefaults.setCompilerOptions({
    allowJs: true,
    checkJs: true,
    module: monacoTypescript.ModuleKind.ESNext,
    moduleResolution: monacoTypescript.ModuleResolutionKind.NodeJs,
    target: monacoTypescript.ScriptTarget.ESNext,
  })
  monacoEditor.value = monacoModule.value.editor.create(editorContainerRef.value, {
    value: '',
    language: 'typescript',
    theme: 'vs-dark',
    minimap: { enabled: false },
    automaticLayout: false,
    smoothScrolling: true,
    fontFamily: '"DM Mono", "SFMono-Regular", Consolas, monospace',
    fontSize: 13,
    lineHeight: 22,
    roundedSelection: false,
    scrollBeyondLastLine: false,
    inlineSuggest: {
      enabled: true,
    },
    quickSuggestions: {
      comments: false,
      other: true,
      strings: true,
    },
    renderValidationDecorations: 'on',
    snippetSuggestions: 'inline',
    suggestOnTriggerCharacters: true,
    tabCompletion: 'on',
    wordWrap: 'on',
    wordBasedSuggestions: 'matchingDocuments',
    tabSize: 2,
    padding: {
      top: 16,
      bottom: 16,
    },
  })

  monacoEditor.value.onDidChangeModelContent(() => {
    const activeTab = props.currentTab
    if (!activeTab || !monacoEditor.value) {
      return
    }

    const content = monacoEditor.value.getValue()
    if (content === activeTab.content) {
      return
    }

    emit('updateTabContent', { path: activeTab.path, content })
  })

  monacoEditor.value.addCommand(
    monacoModule.value.KeyMod.CtrlCmd | monacoModule.value.KeyCode.KeyS,
    () => emit('save'),
  )

  await nextTick()
  syncEditorModel()
}

useResizeObserver(editorContainerRef, () => {
  monacoEditor.value?.layout()
})

watch(() => props.currentTab, () => {
  syncEditorModel()
}, { flush: 'post' })

watch(() => props.openTabs.map(tab => tab.path).join('||'), () => {
  syncEditorModel()
}, { flush: 'post' })

onMounted(async () => {
  await setupMonacoEditor()
})

onUnmounted(() => {
  monacoEditor.value?.dispose()

  if (!monacoModule.value) {
    return
  }

  for (const path of ownedModelPaths.value) {
    monacoModule.value.editor.getModel(monacoModule.value.Uri.file(path))?.dispose()
  }
})
</script>

<template>
  <div class="editor-panel">
    <!-- Header with tabs -->
    <div class="editor-header">
      <!-- Tabs -->
      <div v-if="props.openTabs.length > 0" class="editor-tabs">
        <button
          v-for="tab in props.openTabs"
          :key="tab.path"
          :class="[
            'editor-tab',
            props.currentTab?.path === tab.path
              ? 'editor-tab-active'
              : 'editor-tab-inactive',
          ]"
          type="button"
          @click="emit('selectTab', tab.path)"
        >
          <span class="editor-tab-name">{{ tab.name || getEntryName(tab.path) }}</span>
          <span
            v-if="tab.isDirty"
            class="editor-tab-dirty"
          />
          <span
            class="editor-tab-close"
            @click.stop="emit('closeTab', tab.path)"
          >
            ×
          </span>
        </button>
      </div>

      <!-- Header right -->
      <div class="editor-header-right">
        <span class="editor-status">{{ editorStateLabel }}</span>
        <button
          class="editor-save-btn"
          type="button"
          :disabled="!props.canSave || props.savingFile"
          @click="emit('save')"
        >
          {{ props.savingFile ? '保存中...' : '保存' }}
        </button>
      </div>
    </div>

    <!-- Error -->
    <div
      v-if="props.errorMessage"
      class="editor-error"
    >
      {{ props.errorMessage }}
    </div>

    <!-- Monaco Editor -->
    <div class="editor-body">
      <div
        ref="editorContainer"
        class="monaco-wrap"
      />
    </div>
  </div>
</template>

<style scoped>
.editor-panel {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 12px;
  background: rgba(20, 20, 20, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

/* ===== Header ===== */
.editor-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  flex-shrink: 0;
  background: rgba(28, 28, 28, 0.95);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  min-height: 36px;
}

/* ===== Tabs ===== */
.editor-tabs {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  overflow-x: auto;
  overscroll-behavior: contain;
}

.editor-tabs::-webkit-scrollbar {
  display: none;
}

.editor-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 10px;
  border-radius: 8px;
  border: none;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 100ms ease;
  white-space: nowrap;
  font-family: inherit;
  flex-shrink: 0;
  background: transparent;
}

.editor-tab-inactive {
  color: rgba(255, 255, 255, 0.38);
}

.editor-tab-inactive:hover {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.55);
}

.editor-tab-active {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.88);
}

.editor-tab-name {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.editor-tab-dirty {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: rgba(251, 191, 36, 0.8);
  flex-shrink: 0;
}

.editor-tab-close {
  font-size: 13px;
  font-weight: 400;
  line-height: 1;
  color: rgba(255, 255, 255, 0.3);
  transition: color 100ms ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 4px;
  flex-shrink: 0;
}

.editor-tab-close:hover {
  color: rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.1);
}

/* ===== Header Right ===== */
.editor-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.editor-status {
  font-size: 10.5px;
  color: rgba(255, 255, 255, 0.3);
  white-space: nowrap;
}

.editor-save-btn {
  height: 24px;
  padding: 0 10px;
  border-radius: 7px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.7);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 100ms ease;
  font-family: inherit;
}

.editor-save-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.9);
}

.editor-save-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* ===== Error ===== */
.editor-error {
  padding: 6px 12px;
  font-size: 11px;
  color: rgba(252, 165, 165, 0.9);
  background: rgba(239, 68, 68, 0.12);
  flex-shrink: 0;
}

/* ===== Monaco Body ===== */
.editor-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 8px;
}

.monaco-wrap {
  width: 100%;
  height: 100%;
  border-radius: 18px;
  overflow: hidden;
}

.editor-panel {
  border-radius: 24px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

.editor-header {
  min-height: 56px;
  padding-inline: 16px;
  background: rgba(13, 16, 26, 0.92);
  border-bottom-color: rgba(255, 255, 255, 0.05);
}

.editor-body {
  padding: 12px;
}
</style>
