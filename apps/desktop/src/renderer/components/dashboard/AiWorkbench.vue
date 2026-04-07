<script setup lang="ts">
import type { ElectronWorkspaceDirectoryEntry, ElectronWorkspaceTerminalSession } from '../../../shared/eventa'
import type {
  WorkbenchSidebarMode,
  WorkbenchVariant,
  WorkspaceEditorTab,
  WorkspaceEntryDialogMode,
  WorkspaceEntryDialogState,
  WorkspaceEntryType,
  WorkspaceTreeNode,
} from './ai-workbench/models'

import { useElectronEventaInvoke } from '@jiaban/electron-vueuse'
import { errorMessageFrom } from '@moeru/std'
import { computed, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from 'vue'

import AiWorkbenchCliConfigPanel from './ai-workbench/AiWorkbenchCliConfigPanel.vue'
import AiWorkbenchEditorPane from './ai-workbench/AiWorkbenchEditorPane.vue'
import AiWorkbenchEntryDialog from './ai-workbench/AiWorkbenchEntryDialog.vue'
import AiWorkbenchExplorer from './ai-workbench/AiWorkbenchExplorer.vue'
import AiWorkbenchInstallerPanel from './ai-workbench/AiWorkbenchInstallerPanel.vue'
import AiWorkbenchTerminalPane from './ai-workbench/AiWorkbenchTerminalPane.vue'

import {
  electronWindowClose,
  electronWindowMinimize,
  electronWindowToggleMaximize,
  electronWorkspaceCloseTerminal,
  electronWorkspaceCreateDirectory,
  electronWorkspaceCreateFile,
  electronWorkspaceDeleteEntry,
  electronWorkspaceGetRevision,
  electronWorkspaceGetRoot,
  electronWorkspaceListDirectory,
  electronWorkspacePickRoot,
  electronWorkspaceReadFile,
  electronWorkspaceRenameEntry,
  electronWorkspaceWriteFile,
} from '../../../shared/eventa'
import {
  getAncestorDirectoryPaths,
  getEntryName,
  getParentPath,
  getRelativePath,
  isSameOrDescendantPath,
  joinWorkspacePath,
  replacePathPrefix,
} from './ai-workbench/models'

const props = withDefaults(defineProps<{
  variant?: WorkbenchVariant
  sidebarMode?: WorkbenchSidebarMode | null
  sessions?: ElectronWorkspaceTerminalSession[]
  activeSessionId?: string | null
}>(), {
  variant: 'claude',
  sidebarMode: null,
  sessions: () => [],
  activeSessionId: null,
})

const emit = defineEmits<{
  'update:sidebarMode': [value: WorkbenchSidebarMode | null]
  'updateVariant': [value: WorkbenchVariant]
  'update:activeSessionId': [value: string | null]
}>()

const SESSION_PATH_SPLIT_RE = /[\\/]/

interface SessionWorkspaceState {
  rootPath: string
  selectedPath: string | null
  selectedEntryType: WorkspaceEntryType | null
  activeTabPath: string | null
  openTabs: WorkspaceEditorTab[]
  directoryEntriesByPath: Record<string, ElectronWorkspaceDirectoryEntry[]>
  expandedDirectoryPaths: string[]
  lastWorkspaceRevision: number
}

const sidebarMode = ref<WorkbenchSidebarMode | null>(props.sidebarMode)
const focusMode = shallowRef<'terminal' | 'code'>('terminal')

const getWorkspaceRoot = useElectronEventaInvoke(electronWorkspaceGetRoot)
const pickWorkspaceRoot = useElectronEventaInvoke(electronWorkspacePickRoot)
const getWorkspaceRevision = useElectronEventaInvoke(electronWorkspaceGetRevision)
const listDirectory = useElectronEventaInvoke(electronWorkspaceListDirectory)
const readWorkspaceFile = useElectronEventaInvoke(electronWorkspaceReadFile)
const writeWorkspaceFile = useElectronEventaInvoke(electronWorkspaceWriteFile)
const createWorkspaceFile = useElectronEventaInvoke(electronWorkspaceCreateFile)
const createWorkspaceDirectory = useElectronEventaInvoke(electronWorkspaceCreateDirectory)
const closeWorkspaceTerminal = useElectronEventaInvoke(electronWorkspaceCloseTerminal)
const renameWorkspaceEntry = useElectronEventaInvoke(electronWorkspaceRenameEntry)
const deleteWorkspaceEntry = useElectronEventaInvoke(electronWorkspaceDeleteEntry)
const closeWindow = useElectronEventaInvoke(electronWindowClose)
const minimizeWindow = useElectronEventaInvoke(electronWindowMinimize)
const toggleWindowMaximize = useElectronEventaInvoke(electronWindowToggleMaximize)

const rootPath = ref('')
const loadingRoot = ref(false)
const loadingFile = ref(false)
const savingFile = ref(false)
const operationPending = ref(false)
const errorMessage = ref('')
const dialogErrorMessage = ref('')
const dialogName = ref('')
const selectedPath = ref<string | null>(null)
const selectedEntryType = ref<WorkspaceEntryType | null>(null)
const activeTabPath = ref<string | null>(null)
const openTabs = ref<WorkspaceEditorTab[]>([])
const entryDialogState = ref<WorkspaceEntryDialogState | null>(null)
const directoryEntriesByPath = reactive<Record<string, ElectronWorkspaceDirectoryEntry[]>>({})
const expandedDirectoryPaths = shallowRef(new Set<string>())
const loadingDirectoryPaths = shallowRef(new Set<string>())
const lastWorkspaceRevision = shallowRef(0)
const workspaceSyncTimer = shallowRef<number | null>(null)
const syncingWorkspaceRevision = shallowRef(false)
const selectingWorkspaceRoot = shallowRef(false)
const sessionWorkspaceStates = reactive<Record<string, SessionWorkspaceState>>({})

const currentTab = computed(() => openTabs.value.find(tab => tab.path === activeTabPath.value) ?? null)
const canSave = computed(() => {
  if (!currentTab.value) {
    return false
  }

  if (currentTab.value.snapshot.isBinary || currentTab.value.snapshot.tooLarge) {
    return false
  }

  return currentTab.value.isDirty
})

const selectedDirectoryPath = computed(() => {
  if (!rootPath.value) {
    return ''
  }

  if (!selectedPath.value || selectedPath.value === rootPath.value) {
    return rootPath.value
  }

  if (selectedEntryType.value === 'directory') {
    return selectedPath.value
  }

  return getParentPath(selectedPath.value)
})

const selectedDirectoryLabel = computed(() => {
  if (!selectedDirectoryPath.value || !rootPath.value) {
    return '加载中...'
  }

  return getRelativePath(rootPath.value, selectedDirectoryPath.value)
})

const entryDialogTargetLabel = computed(() => {
  if (!entryDialogState.value) {
    return ''
  }

  return getRelativePath(rootPath.value, entryDialogState.value.path)
})

const entryDialogParentLabel = computed(() => {
  if (!entryDialogState.value) {
    return ''
  }

  return getRelativePath(rootPath.value, entryDialogState.value.parentPath)
})

const isEntryDialogOpen = computed({
  get: () => entryDialogState.value !== null,
  set: value => !value && closeEntryDialog(),
})

const workspaceFolderLabel = computed(() => rootPath.value ? getEntryName(rootPath.value) : 'No workspace')
const workspaceLocationLabel = computed(() => rootPath.value || 'Pick a workspace to begin')
const windowModePills = computed(() => [
  { id: 'terminal' as const, label: 'Terminal' },
  { id: 'code' as const, label: 'Code' },
])
const sortedSessions = computed(() => {
  return [...props.sessions]
})
const resolvedActiveSessionId = computed(() => {
  if (props.activeSessionId && props.sessions.some(session => session.id === props.activeSessionId)) {
    return props.activeSessionId
  }

  return sortedSessions.value[0]?.id ?? null
})

watch(() => props.sidebarMode, (nextMode) => {
  sidebarMode.value = nextMode ?? null
})

function updateSidebarMode(nextMode: WorkbenchSidebarMode | null) {
  sidebarMode.value = nextMode
  emit('update:sidebarMode', nextMode)
}

function toggleApiConfigPanel() {
  updateSidebarMode(sidebarMode.value === 'api-config' ? null : 'api-config')
}

async function handleWindowClose() {
  await closeWindow()
}

async function handleWindowMinimize() {
  await minimizeWindow()
}

async function handleWindowMaximize() {
  await toggleWindowMaximize()
}

async function handleDeleteSession() {
  if (!resolvedActiveSessionId.value) {
    return
  }

  errorMessage.value = ''

  const currentSessionIndex = sortedSessions.value.findIndex(session => session.id === resolvedActiveSessionId.value)
  const fallbackSession = sortedSessions.value
    .filter(session => session.id !== resolvedActiveSessionId.value)
    .at(currentSessionIndex >= sortedSessions.value.length - 1 ? currentSessionIndex - 1 : currentSessionIndex)
    ?? sortedSessions.value.find(session => session.id !== resolvedActiveSessionId.value)
    ?? null

  try {
    await closeWorkspaceTerminal({ sessionId: resolvedActiveSessionId.value })
    emit('update:activeSessionId', fallbackSession?.id ?? null)
    if (fallbackSession?.profile) {
      emit('updateVariant', fallbackSession.profile)
    }
  }
  catch (error) {
    errorMessage.value = errorMessageFrom(error) ?? '删除会话失败'
  }
}

function getSessionTabLabel(session: ElectronWorkspaceTerminalSession) {
  const workspaceRoot = sessionWorkspaceStates[session.id]?.rootPath ?? session.cwd
  return workspaceRoot.split(SESSION_PATH_SPLIT_RE).pop() || workspaceRoot
}

function getSessionTabProfileLabel(session: ElectronWorkspaceTerminalSession) {
  return session.profile === 'codex' ? 'Codex' : 'Claude'
}

function handleSelectSession(session: ElectronWorkspaceTerminalSession) {
  focusMode.value = 'terminal'
  emit('update:activeSessionId', session.id)
  if (session.profile) {
    emit('updateVariant', session.profile)
  }
}

watch(sortedSessions, (sessions) => {
  if (sessions.length === 0) {
    return
  }

  if (props.activeSessionId && sessions.some(session => session.id === props.activeSessionId)) {
    return
  }

  const fallbackSession = sessions[0]
  emit('update:activeSessionId', fallbackSession.id)
  if (fallbackSession.profile) {
    emit('updateVariant', fallbackSession.profile)
  }
}, { immediate: true })

function updateLoadingDirectory(path: string, isLoading: boolean) {
  const nextPaths = new Set(loadingDirectoryPaths.value)
  if (isLoading) {
    nextPaths.add(path)
  }
  else {
    nextPaths.delete(path)
  }
  loadingDirectoryPaths.value = nextPaths
}

async function ensureDirectoryLoaded(path: string, options?: { force?: boolean, silent?: boolean }) {
  if (!path) {
    return
  }

  if (loadingDirectoryPaths.value.has(path)) {
    return
  }

  if (!options?.force && directoryEntriesByPath[path]) {
    return
  }

  updateLoadingDirectory(path, true)

  try {
    const snapshot = await listDirectory({ path })
    directoryEntriesByPath[snapshot.path] = snapshot.entries
  }
  catch (error) {
    if (!options?.silent) {
      errorMessage.value = errorMessageFrom(error) ?? '无法读取目录'
    }
    throw error
  }
  finally {
    updateLoadingDirectory(path, false)
  }
}

function clearLoadedDirectories() {
  for (const path of Object.keys(directoryEntriesByPath)) {
    delete directoryEntriesByPath[path]
  }
}

function cloneOpenTabs(tabs: WorkspaceEditorTab[]) {
  return tabs.map(tab => ({
    ...tab,
    snapshot: {
      ...tab.snapshot,
    },
  }))
}

function cloneDirectoryEntriesByPath(entriesByPath: Record<string, ElectronWorkspaceDirectoryEntry[]>) {
  return Object.fromEntries(
    Object.entries(entriesByPath).map(([path, entries]) => [
      path,
      entries.map(entry => ({ ...entry })),
    ]),
  )
}

function createSessionWorkspaceStateSnapshot(): SessionWorkspaceState {
  return {
    rootPath: rootPath.value,
    selectedPath: selectedPath.value,
    selectedEntryType: selectedEntryType.value,
    activeTabPath: activeTabPath.value,
    openTabs: cloneOpenTabs(openTabs.value),
    directoryEntriesByPath: cloneDirectoryEntriesByPath(directoryEntriesByPath),
    expandedDirectoryPaths: Array.from(expandedDirectoryPaths.value),
    lastWorkspaceRevision: lastWorkspaceRevision.value,
  }
}

function restoreSessionWorkspaceState(snapshot: SessionWorkspaceState) {
  rootPath.value = snapshot.rootPath
  selectedPath.value = snapshot.selectedPath
  selectedEntryType.value = snapshot.selectedEntryType
  activeTabPath.value = snapshot.activeTabPath
  openTabs.value = cloneOpenTabs(snapshot.openTabs)
  entryDialogState.value = null
  dialogName.value = ''
  dialogErrorMessage.value = ''
  expandedDirectoryPaths.value = new Set(snapshot.expandedDirectoryPaths)
  loadingDirectoryPaths.value = new Set()
  lastWorkspaceRevision.value = snapshot.lastWorkspaceRevision
  clearLoadedDirectories()

  for (const [path, entries] of Object.entries(snapshot.directoryEntriesByPath)) {
    directoryEntriesByPath[path] = entries.map(entry => ({ ...entry }))
  }
}

function saveActiveSessionWorkspaceState(sessionId?: string | null) {
  if (!sessionId || !rootPath.value) {
    return
  }

  sessionWorkspaceStates[sessionId] = createSessionWorkspaceStateSnapshot()
}

function resetWorkspaceState() {
  selectedPath.value = null
  selectedEntryType.value = null
  activeTabPath.value = null
  openTabs.value = []
  entryDialogState.value = null
  dialogName.value = ''
  dialogErrorMessage.value = ''
  expandedDirectoryPaths.value = new Set()
  loadingDirectoryPaths.value = new Set()
  clearLoadedDirectories()
}

async function loadWorkspaceRoot(options?: { rootPath?: string, openInitialFile?: boolean }) {
  loadingRoot.value = true
  errorMessage.value = ''

  try {
    const nextRootPath = options?.rootPath ?? await getWorkspaceRoot()
    rootPath.value = nextRootPath
    resetWorkspaceState()
    selectedPath.value = nextRootPath
    selectedEntryType.value = 'directory'
    lastWorkspaceRevision.value = (await getWorkspaceRevision()).revision

    await ensureDirectoryLoaded(nextRootPath, { force: true })

    if (options?.openInitialFile) {
      const initialFilePath = joinWorkspacePath(nextRootPath, 'apps/desktop/src/renderer/pages/dashboard/index.vue')
      await openFile(initialFilePath)
    }
  }
  catch (error) {
    errorMessage.value = errorMessageFrom(error) ?? '工作区初始化失败'
  }
  finally {
    loadingRoot.value = false
  }
}

async function reloadTree() {
  if (!rootPath.value) {
    return
  }

  const directoriesToReload = Array.from(new Set([rootPath.value, ...expandedDirectoryPaths.value]))
  const nextExpandedPaths = new Set(expandedDirectoryPaths.value)

  clearLoadedDirectories()

  for (const path of directoriesToReload) {
    try {
      await ensureDirectoryLoaded(path, { force: true, silent: true })
    }
    catch {
      nextExpandedPaths.delete(path)
    }
  }

  expandedDirectoryPaths.value = nextExpandedPaths
}

function updateExpandedDirectoryPath(path: string, expanded: boolean) {
  const nextPaths = new Set(expandedDirectoryPaths.value)
  if (expanded) {
    nextPaths.add(path)
  }
  else {
    nextPaths.delete(path)
  }
  expandedDirectoryPaths.value = nextPaths
}

async function expandDirectoryPath(path: string) {
  if (!path || path === rootPath.value) {
    return
  }

  updateExpandedDirectoryPath(path, true)
  await ensureDirectoryLoaded(path)
}

async function expandAncestorDirectories(path: string) {
  if (!rootPath.value) {
    return
  }

  for (const directoryPath of getAncestorDirectoryPaths(rootPath.value, path)) {
    if (directoryPath === rootPath.value) {
      await ensureDirectoryLoaded(directoryPath)
      continue
    }

    await expandDirectoryPath(directoryPath)
  }
}

function selectNode(node: WorkspaceTreeNode) {
  selectedPath.value = node.path
  selectedEntryType.value = node.type
}

async function toggleDirectory(path: string) {
  if (expandedDirectoryPaths.value.has(path)) {
    updateExpandedDirectoryPath(path, false)
    return
  }

  await expandDirectoryPath(path)
}

async function openFile(path: string, options?: { forceReload?: boolean }) {
  loadingFile.value = true
  errorMessage.value = ''

  try {
    await expandAncestorDirectories(path)

    const existingTab = openTabs.value.find(tab => tab.path === path)
    if (existingTab && !options?.forceReload) {
      activeTabPath.value = path
      selectedPath.value = path
      selectedEntryType.value = 'file'
      return
    }

    const snapshot = await readWorkspaceFile({ path })
    const nextTab: WorkspaceEditorTab = {
      path: snapshot.path,
      name: getEntryName(snapshot.path),
      snapshot,
      content: snapshot.content,
      isDirty: false,
    }

    const existingIndex = openTabs.value.findIndex(tab => tab.path === path)
    if (existingIndex >= 0) {
      openTabs.value.splice(existingIndex, 1, nextTab)
    }
    else {
      openTabs.value.push(nextTab)
    }

    activeTabPath.value = snapshot.path
    selectedPath.value = snapshot.path
    selectedEntryType.value = 'file'
    focusMode.value = 'code'
  }
  catch (error) {
    errorMessage.value = errorMessageFrom(error) ?? '无法读取文件'
  }
  finally {
    loadingFile.value = false
  }
}

function updateTabContent(payload: { path: string, content: string }) {
  const tab = openTabs.value.find(item => item.path === payload.path)
  if (!tab) {
    return
  }

  tab.content = payload.content
  tab.isDirty = payload.content !== tab.snapshot.content
}

function closeEditorTab(path: string) {
  const tabIndex = openTabs.value.findIndex(tab => tab.path === path)
  if (tabIndex < 0) {
    return
  }

  openTabs.value.splice(tabIndex, 1)

  if (activeTabPath.value === path) {
    activeTabPath.value = openTabs.value[Math.max(0, tabIndex - 1)]?.path ?? openTabs.value[0]?.path ?? null
  }
}

async function saveCurrentFile() {
  if (!currentTab.value || !canSave.value) {
    return
  }

  savingFile.value = true
  errorMessage.value = ''

  try {
    await writeWorkspaceFile({
      path: currentTab.value.path,
      content: currentTab.value.content,
    })

    await openFile(currentTab.value.path, { forceReload: true })
  }
  catch (error) {
    errorMessage.value = errorMessageFrom(error) ?? '保存失败'
  }
  finally {
    savingFile.value = false
  }
}

function closeEntryDialog() {
  entryDialogState.value = null
  dialogName.value = ''
  dialogErrorMessage.value = ''
}

function openEntryDialog(mode: WorkspaceEntryDialogMode) {
  dialogErrorMessage.value = ''

  if (!rootPath.value) {
    return
  }

  if (mode === 'create-file' || mode === 'create-directory') {
    entryDialogState.value = {
      mode,
      path: selectedDirectoryPath.value || rootPath.value,
      parentPath: selectedDirectoryPath.value || rootPath.value,
      entryType: mode === 'create-file' ? 'file' : 'directory',
    }
    dialogName.value = ''
    return
  }

  if (!selectedPath.value || !selectedEntryType.value || selectedPath.value === rootPath.value) {
    return
  }

  entryDialogState.value = {
    mode,
    path: selectedPath.value,
    parentPath: getParentPath(selectedPath.value),
    entryType: selectedEntryType.value,
  }
  dialogName.value = mode === 'rename' ? getEntryName(selectedPath.value) : ''
}

function updatePathsAfterRename(previousPath: string, nextPath: string, entryType: WorkspaceEntryType) {
  openTabs.value = openTabs.value.map((tab) => {
    if (!isSameOrDescendantPath(tab.path, previousPath)) {
      return tab
    }

    if (entryType === 'file' && tab.path !== previousPath) {
      return tab
    }

    const path = replacePathPrefix(tab.path, previousPath, nextPath)
    return {
      ...tab,
      path,
      name: getEntryName(path),
      snapshot: {
        ...tab.snapshot,
        path,
      },
    }
  })

  if (activeTabPath.value && isSameOrDescendantPath(activeTabPath.value, previousPath)) {
    activeTabPath.value = replacePathPrefix(activeTabPath.value, previousPath, nextPath)
  }

  if (selectedPath.value && isSameOrDescendantPath(selectedPath.value, previousPath)) {
    selectedPath.value = replacePathPrefix(selectedPath.value, previousPath, nextPath)
  }

  const nextExpandedPaths = new Set<string>()
  for (const path of expandedDirectoryPaths.value) {
    if (!isSameOrDescendantPath(path, previousPath)) {
      nextExpandedPaths.add(path)
      continue
    }

    nextExpandedPaths.add(replacePathPrefix(path, previousPath, nextPath))
  }
  expandedDirectoryPaths.value = nextExpandedPaths
}

function removeDeletedState(targetPath: string, entryType: WorkspaceEntryType) {
  openTabs.value = openTabs.value.filter((tab) => {
    if (entryType === 'file') {
      return tab.path !== targetPath
    }

    return !isSameOrDescendantPath(tab.path, targetPath)
  })

  if (activeTabPath.value) {
    const isActiveRemoved = entryType === 'file'
      ? activeTabPath.value === targetPath
      : isSameOrDescendantPath(activeTabPath.value, targetPath)

    if (isActiveRemoved) {
      activeTabPath.value = openTabs.value.at(-1)?.path ?? null
    }
  }

  if (selectedPath.value) {
    const isSelectionRemoved = entryType === 'file'
      ? selectedPath.value === targetPath
      : isSameOrDescendantPath(selectedPath.value, targetPath)

    if (isSelectionRemoved) {
      selectedPath.value = getParentPath(targetPath)
      selectedEntryType.value = 'directory'
    }
  }

  const nextExpandedPaths = new Set<string>()
  for (const path of expandedDirectoryPaths.value) {
    if (entryType === 'file' ? path !== targetPath : !isSameOrDescendantPath(path, targetPath)) {
      nextExpandedPaths.add(path)
    }
  }
  expandedDirectoryPaths.value = nextExpandedPaths
}

async function submitEntryDialog() {
  if (!entryDialogState.value) {
    return
  }

  dialogErrorMessage.value = ''
  operationPending.value = true

  try {
    if (entryDialogState.value.mode === 'create-file') {
      const nextPath = joinWorkspacePath(entryDialogState.value.parentPath, dialogName.value.trim())
      await createWorkspaceFile({ path: nextPath })
      await reloadTree()
      await openFile(nextPath, { forceReload: true })
      closeEntryDialog()
      return
    }

    if (entryDialogState.value.mode === 'create-directory') {
      const nextPath = joinWorkspacePath(entryDialogState.value.parentPath, dialogName.value.trim())
      await createWorkspaceDirectory({ path: nextPath })
      updateExpandedDirectoryPath(entryDialogState.value.parentPath, true)
      await reloadTree()
      selectedPath.value = nextPath
      selectedEntryType.value = 'directory'
      await expandDirectoryPath(nextPath)
      closeEntryDialog()
      return
    }

    if (entryDialogState.value.mode === 'rename') {
      const nextPath = joinWorkspacePath(entryDialogState.value.parentPath, dialogName.value.trim())
      const result = await renameWorkspaceEntry({
        path: entryDialogState.value.path,
        nextPath,
      })

      updatePathsAfterRename(result.previousPath, result.path, result.type)
      await reloadTree()
      closeEntryDialog()
      return
    }

    await deleteWorkspaceEntry({ path: entryDialogState.value.path })
    removeDeletedState(entryDialogState.value.path, entryDialogState.value.entryType)
    await reloadTree()
    closeEntryDialog()
  }
  catch (error) {
    dialogErrorMessage.value = errorMessageFrom(error) ?? '操作失败'
  }
  finally {
    operationPending.value = false
  }
}

async function initializeWorkbench() {
  await loadWorkspaceRoot({ openInitialFile: false })
}

async function activateSessionWorkspace(sessionId?: string | null) {
  const session = sessionId
    ? sortedSessions.value.find(item => item.id === sessionId) ?? null
    : null
  const nextWorkspaceRoot = session?.cwd ?? ''

  if (!nextWorkspaceRoot) {
    if (!rootPath.value) {
      await initializeWorkbench()
    }
    return
  }

  const cachedState = sessionWorkspaceStates[sessionId ?? '']
  if (cachedState?.rootPath === nextWorkspaceRoot) {
    restoreSessionWorkspaceState(cachedState)
    void syncWorkspaceRevision()
    return
  }

  await loadWorkspaceRoot({ rootPath: nextWorkspaceRoot })
}

async function selectWorkspaceRoot() {
  if (selectingWorkspaceRoot.value) {
    return
  }

  selectingWorkspaceRoot.value = true
  errorMessage.value = ''

  try {
    const nextRootPath = await pickWorkspaceRoot()
    if (!nextRootPath || nextRootPath === rootPath.value) {
      return
    }

    await loadWorkspaceRoot({ rootPath: nextRootPath })
  }
  catch (error) {
    errorMessage.value = errorMessageFrom(error) ?? '无法切换工作区目录'
  }
  finally {
    selectingWorkspaceRoot.value = false
  }
}

function clearWorkspaceSyncTimer() {
  if (workspaceSyncTimer.value == null) {
    return
  }

  window.clearInterval(workspaceSyncTimer.value)
  workspaceSyncTimer.value = null
}

async function refreshCleanTabsFromDisk() {
  const refreshedTabs = await Promise.all(openTabs.value.map(async (tab) => {
    if (tab.isDirty) {
      return tab
    }

    try {
      const snapshot = await readWorkspaceFile({ path: tab.path })
      if (
        snapshot.path === tab.snapshot.path
        && snapshot.size === tab.snapshot.size
        && snapshot.isBinary === tab.snapshot.isBinary
        && snapshot.tooLarge === tab.snapshot.tooLarge
        && snapshot.content === tab.snapshot.content
      ) {
        return tab
      }

      return {
        ...tab,
        path: snapshot.path,
        name: getEntryName(snapshot.path),
        snapshot,
        content: snapshot.content,
        isDirty: false,
      }
    }
    catch {
      return null
    }
  }))

  openTabs.value = refreshedTabs.filter((tab): tab is WorkspaceEditorTab => tab !== null)

  if (activeTabPath.value && !openTabs.value.some(tab => tab.path === activeTabPath.value)) {
    activeTabPath.value = openTabs.value.at(-1)?.path ?? null
  }
}

async function syncWorkspaceRevision() {
  if (!rootPath.value || loadingRoot.value || syncingWorkspaceRevision.value) {
    return
  }

  syncingWorkspaceRevision.value = true

  try {
    const revisionSnapshot = await getWorkspaceRevision()
    if (revisionSnapshot.revision === lastWorkspaceRevision.value) {
      return
    }

    lastWorkspaceRevision.value = revisionSnapshot.revision
    await reloadTree()
    await refreshCleanTabsFromDisk()
  }
  catch {
    // Ignore transient polling errors and let the user continue editing.
  }
  finally {
    syncingWorkspaceRevision.value = false
  }
}

watch(resolvedActiveSessionId, async (nextSessionId, previousSessionId) => {
  if (previousSessionId && previousSessionId !== nextSessionId) {
    saveActiveSessionWorkspaceState(previousSessionId)
  }

  await activateSessionWorkspace(nextSessionId)
}, { immediate: true })

onMounted(async () => {
  if (!rootPath.value) {
    await initializeWorkbench()
  }

  clearWorkspaceSyncTimer()
  workspaceSyncTimer.value = window.setInterval(() => {
    void syncWorkspaceRevision()
  }, 900)
})

onUnmounted(() => {
  saveActiveSessionWorkspaceState(resolvedActiveSessionId.value)
  clearWorkspaceSyncTimer()
})
</script>

<template>
  <div class="workbench-window">
    <div v-if="sortedSessions.length > 0" class="workbench-window__session-strip">
      <button
        v-for="session in sortedSessions"
        :key="session.id"
        :class="[
          'workbench-session-tab',
          resolvedActiveSessionId === session.id ? 'workbench-session-tab--active' : '',
          session.status !== 'running' ? 'workbench-session-tab--exited' : '',
        ]"
        type="button"
        @click="handleSelectSession(session)"
      >
        <span
          :class="[
            'workbench-session-tab__profile',
            session.profile === 'codex' ? 'workbench-session-tab__profile--codex' : 'workbench-session-tab__profile--claude',
          ]"
        >
          {{ getSessionTabProfileLabel(session) }}
        </span>
        <span class="workbench-session-tab__label">
          {{ getSessionTabLabel(session) }}
        </span>
        <span class="workbench-session-tab__status">
          {{ session.status === 'running' ? 'running' : `exited ${session.exitCode ?? 0}` }}
        </span>
      </button>
    </div>

    <div class="workbench-window__chrome">
      <div class="workbench-window__chrome-left">
        <div class="workbench-window__traffic-lights">
          <button
            class="workbench-window__traffic-light workbench-window__traffic-light--red"
            type="button"
            aria-label="关闭窗口"
            @click="void handleWindowClose()"
          />
          <button
            class="workbench-window__traffic-light workbench-window__traffic-light--yellow"
            type="button"
            aria-label="最小化窗口"
            @click="void handleWindowMinimize()"
          />
          <button
            class="workbench-window__traffic-light workbench-window__traffic-light--green"
            type="button"
            aria-label="缩放窗口"
            @click="void handleWindowMaximize()"
          />
        </div>

        <div class="workbench-window__tabs">
          <button
            v-for="pill in windowModePills"
            :key="pill.id"
            :class="[
              'workbench-window__mode-pill',
              focusMode === pill.id ? 'workbench-window__mode-pill--active' : '',
            ]"
            type="button"
            @click="focusMode = pill.id"
          >
            {{ pill.label }}
          </button>
        </div>
      </div>

      <div class="workbench-window__workspace">
        <div class="workbench-window__workspace-label">
          {{ workspaceFolderLabel }}
        </div>
        <div class="workbench-window__workspace-path">
          {{ workspaceLocationLabel }}
        </div>
      </div>

      <div class="workbench-window__actions">
        <button class="workbench-action" type="button" @click="selectWorkspaceRoot">
          切换目录
        </button>
        <button class="workbench-action" type="button" @click="updateSidebarMode('environment-install')">
          环境
        </button>
        <button class="workbench-action" type="button" @click="updateSidebarMode('cli-install')">
          CLI
        </button>
        <button class="workbench-action" type="button" @click="toggleApiConfigPanel">
          API
        </button>
        <button
          v-if="focusMode === 'terminal' && resolvedActiveSessionId"
          class="workbench-action workbench-action--danger"
          type="button"
          @click="void handleDeleteSession()"
        >
          Delete Session
        </button>
      </div>
    </div>

    <div class="workbench-window__body">
      <div v-if="focusMode === 'terminal'" class="workbench-terminal-stage">
        <div class="workbench-terminal-stage__surface">
          <AiWorkbenchTerminalPane
            :variant="props.variant"
            :root-path="rootPath"
            :sessions="props.sessions"
            :active-session-id="props.activeSessionId"
            @update:active-session-id="emit('update:activeSessionId', $event)"
          />
        </div>
      </div>

      <div v-else class="workbench-code-stage">
        <div class="workbench-code-stage__explorer">
          <AiWorkbenchExplorer
            :root-path="rootPath"
            :selected-path="selectedPath"
            :selected-entry-type="selectedEntryType"
            :active-file-path="activeTabPath"
            :loading-root="loadingRoot"
            :root-selection-pending="selectingWorkspaceRoot"
            :expanded-directory-paths="expandedDirectoryPaths"
            :loading-directory-paths="loadingDirectoryPaths"
            :directory-entries-by-path="directoryEntriesByPath"
            :selected-directory-label="selectedDirectoryLabel"
            :sidebar-mode="sidebarMode"
            :variant="props.variant"
            @select-entry="selectNode"
            @open-file="openFile"
            @toggle-directory="toggleDirectory"
            @pick-root="selectWorkspaceRoot"
            @refresh="reloadTree"
            @create-file="openEntryDialog('create-file')"
            @create-directory="openEntryDialog('create-directory')"
            @rename-entry="openEntryDialog('rename')"
            @delete-entry="openEntryDialog('delete')"
            @toggle-api-config="toggleApiConfigPanel"
          />
        </div>

        <div class="workbench-code-stage__editor">
          <AiWorkbenchEditorPane
            :current-tab="currentTab"
            :open-tabs="openTabs"
            :loading-file="loadingFile"
            :saving-file="savingFile"
            :can-save="canSave"
            :error-message="errorMessage"
            :variant="props.variant"
            @update-tab-content="updateTabContent"
            @select-tab="activeTabPath = $event"
            @close-tab="closeEditorTab"
            @save="saveCurrentFile"
          />
        </div>
      </div>
    </div>

    <Transition
      enter-active-class="transition-all duration-220 ease-out"
      enter-from-class="opacity-0 translate-y-2 scale-95"
      enter-to-class="opacity-100 translate-y-0 scale-100"
      leave-active-class="transition-all duration-160 ease-in"
      leave-from-class="opacity-100 translate-y-0 scale-100"
      leave-to-class="opacity-0 translate-y-2 scale-95"
    >
      <div v-if="sidebarMode" class="workbench-sidebar-overlay">
        <div class="workbench-sidebar">
          <AiWorkbenchCliConfigPanel
            v-if="sidebarMode === 'api-config'"
            @close="updateSidebarMode(null)"
          />
          <AiWorkbenchInstallerPanel
            v-else-if="sidebarMode === 'environment-install' || sidebarMode === 'cli-install'"
            :mode="sidebarMode"
            @close="updateSidebarMode(null)"
          />
        </div>
      </div>
    </Transition>

    <AiWorkbenchEntryDialog
      v-model:open="isEntryDialogOpen"
      v-model:name="dialogName"
      :mode="entryDialogState?.mode ?? 'create-file'"
      :pending="operationPending"
      :error-message="dialogErrorMessage"
      :target-label="entryDialogTargetLabel"
      :parent-label="entryDialogParentLabel"
      :entry-type="entryDialogState?.entryType ?? 'file'"
      @confirm="submitEntryDialog"
    />
  </div>
</template>

<style scoped>
.workbench-window {
  position: relative;
  display: flex;
  height: 100%;
  width: 100%;
  flex-direction: column;
  overflow: hidden;
  border-radius: 30px;
  background:
    linear-gradient(180deg, rgba(10, 12, 20, 0.985) 0%, rgba(11, 14, 24, 0.97) 100%);
  box-shadow:
    0 28px 70px rgba(3, 5, 12, 0.34),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.workbench-window__chrome {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding-inline: 18px;
  background: transparent;
  app-region: drag;
}

.workbench-window__chrome {
  min-height: 64px;
  padding-top: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.workbench-window__chrome-left {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-shrink: 0;
}

.workbench-window__traffic-lights {
  display: flex;
  align-items: center;
  gap: 8px;
  app-region: no-drag;
}

.workbench-window__traffic-light {
  height: 14px;
  width: 14px;
  border: none;
  border-radius: 999px;
  app-region: no-drag;
  cursor: pointer;
  padding: 0;
  transition: transform 0.16s ease, filter 0.16s ease;
}

.workbench-window__traffic-light--red { background: #ff5f57; }
.workbench-window__traffic-light--yellow { background: #febc2e; }
.workbench-window__traffic-light--green { background: #28c840; }

.workbench-window__traffic-light:hover {
  filter: brightness(1.08);
  transform: translateY(-1px);
}

.workbench-window__tabs {
  display: flex;
  align-items: center;
  gap: 6px;
}

.workbench-window__mode-pill,
.workbench-action,
.workbench-mini-action {
  border: 0;
  border-radius: 999px;
  font-family: 'DM Mono', 'SFMono-Regular', Consolas, monospace;
  font-size: 12px;
  app-region: no-drag;
}

.workbench-window__mode-pill {
  cursor: pointer;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(214, 221, 241, 0.62);
  padding: 7px 11px;
}

.workbench-window__mode-pill--active,
.workbench-window__mode-pill:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(248, 250, 255, 0.96);
}

.workbench-window__workspace {
  min-width: 0;
  flex: 1;
}

.workbench-window__workspace-label {
  color: rgba(242, 245, 255, 0.98);
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.03em;
  line-height: 1.05;
}

.workbench-window__workspace-path {
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(169, 182, 214, 0.62);
  font-family: 'DM Mono', 'SFMono-Regular', Consolas, monospace;
  font-size: 11px;
}

.workbench-window__actions {
  display: flex;
  flex-wrap: nowrap;
  flex-shrink: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.workbench-action,
.workbench-mini-action {
  cursor: pointer;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(223, 230, 248, 0.8);
  padding: 8px 12px;
  transition: background-color 0.18s ease, transform 0.18s ease;
}

.workbench-action:hover,
.workbench-mini-action:hover {
  background: rgba(255, 255, 255, 0.11);
  transform: translateY(-1px);
}

.workbench-action--danger {
  background: rgba(162, 54, 68, 0.16);
  color: rgba(255, 219, 224, 0.94);
}

.workbench-action--danger:hover {
  background: rgba(190, 68, 84, 0.22);
}

.workbench-window__session-strip {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 12px 12px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  scrollbar-width: none;
}

.workbench-window__session-strip::-webkit-scrollbar {
  display: none;
}

.workbench-session-tab {
  display: inline-flex;
  min-width: 0;
  max-width: 260px;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: 18px 18px 10px 10px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(214, 223, 246, 0.76);
  padding: 10px 12px;
  font-family: 'DM Mono', 'SFMono-Regular', Consolas, monospace;
  font-size: 11px;
  cursor: pointer;
  app-region: no-drag;
  transition: background-color 0.18s ease, transform 0.18s ease, color 0.18s ease;
}

.workbench-session-tab:hover {
  background: rgba(255, 255, 255, 0.09);
  color: rgba(248, 250, 255, 0.96);
}

.workbench-session-tab--active {
  background: rgba(255, 255, 255, 0.12);
  color: rgba(248, 250, 255, 0.98);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.workbench-session-tab--exited {
  opacity: 0.72;
}

.workbench-session-tab__profile {
  border-radius: 999px;
  padding: 3px 7px;
  font-size: 10px;
  letter-spacing: 0.02em;
  flex: none;
}

.workbench-session-tab__profile--claude {
  background: rgba(246, 164, 83, 0.18);
  color: rgba(255, 212, 165, 0.96);
}

.workbench-session-tab__profile--codex {
  background: rgba(96, 146, 255, 0.18);
  color: rgba(189, 214, 255, 0.96);
}

.workbench-session-tab__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workbench-session-tab__status {
  color: rgba(136, 220, 130, 0.92);
  flex: none;
  white-space: nowrap;
}

.workbench-window__body {
  flex: 1;
  min-height: 0;
  padding: 8px 12px 12px;
}

.workbench-terminal-stage {
  height: 100%;
  min-height: 0;
}

.workbench-terminal-stage__surface {
  height: 100%;
  min-height: 0;
}

.workbench-terminal-stage__surface,
.workbench-code-stage__explorer,
.workbench-code-stage__editor {
  min-height: 0;
}

.workbench-code-stage {
  display: grid;
  height: 100%;
  min-height: 0;
  grid-template-columns: 300px minmax(0, 1fr);
  gap: 14px;
}

.workbench-sidebar-overlay {
  position: absolute;
  inset: 68px 12px 12px 0;
  z-index: 4;
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  padding-right: 12px;
  pointer-events: none;
}

.workbench-sidebar {
  pointer-events: auto;
  width: min(360px, calc(100vw - 64px));
  height: min(640px, calc(100% - 24px));
}

@media (max-width: 760px) {
  .workbench-window {
    width: 100%;
    height: 100%;
  }

  .workbench-window__chrome {
    display: flex;
    align-items: flex-start;
    flex-direction: column;
    padding-block: 12px;
  }

  .workbench-window__actions {
    flex-wrap: wrap;
    justify-content: flex-start;
  }
}

@media (max-width: 860px) {
  .workbench-code-stage {
    grid-template-columns: 1fr;
  }
}
</style>
