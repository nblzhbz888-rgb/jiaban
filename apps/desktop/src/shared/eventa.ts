import type { Locale } from '@intlify/core'
import type { ServerOptions } from '@jiaban/server-runtime/server'

import { defineEventa, defineInvokeEventa } from '@moeru/eventa'

export const electronStartTrackMousePosition = defineInvokeEventa('eventa:invoke:electron:start-tracking-mouse-position')
export const electronStartDraggingWindow = defineInvokeEventa('eventa:invoke:electron:start-dragging-window')

export const electronOpenMainDevtools = defineInvokeEventa('eventa:invoke:electron:windows:main:devtools:open')
export const electronOpenIsland = defineInvokeEventa('eventa:invoke:electron:windows:island:open')

export interface ElectronWorkspaceDirectoryEntry {
  name: string
  path: string
  type: 'file' | 'directory'
}

export interface ElectronWorkspaceDirectorySnapshot {
  root: string
  path: string
  parentPath: string | null
  entries: ElectronWorkspaceDirectoryEntry[]
}

export interface ElectronWorkspaceFileSnapshot {
  path: string
  size: number
  content: string
  isBinary: boolean
  tooLarge: boolean
}

export type ElectronWorkspaceCliProfile = 'claude' | 'codex'

export type ClaudeCodeApiMode = 'subscription' | 'api-key' | 'relay'
export type CodexApiMode = 'api-key' | 'relay'

export interface ClaudeCodeCliConfig {
  mode: ClaudeCodeApiMode
  apiKey: string
  baseUrl: string
}

export interface CodexCliConfig {
  mode: CodexApiMode
  apiKey: string
  baseUrl: string
}

export interface ElectronWorkspaceCliProfiles {
  claude: ClaudeCodeCliConfig
  codex: CodexCliConfig
}

export type ElectronWorkspaceSetupAction = 'install-environment' | 'install-cli-tools'

export interface ElectronWorkspaceSetupCommandStatus {
  command: string
  available: boolean
  version: string | null
}

export interface ElectronWorkspaceSetupStatus {
  platform: NodeJS.Platform
  packageManager: string | null
  environment: {
    git: ElectronWorkspaceSetupCommandStatus
    node: ElectronWorkspaceSetupCommandStatus
    pnpm: ElectronWorkspaceSetupCommandStatus
  }
  cli: {
    claude: ElectronWorkspaceSetupCommandStatus
    codex: ElectronWorkspaceSetupCommandStatus
  }
}

export interface ElectronWorkspaceSetupResult {
  action: ElectronWorkspaceSetupAction
  success: boolean
  summary: string
  command: string
  log: string
}

export interface ElectronWorkspaceRevisionSnapshot {
  revision: number
  changedAt: number
}

export interface ElectronWorkspaceWriteFileResult {
  path: string
  size: number
}

export interface ElectronWorkspaceEntryMutationResult {
  path: string
  type: 'file' | 'directory'
}

export interface ElectronWorkspaceRenameEntryResult extends ElectronWorkspaceEntryMutationResult {
  previousPath: string
}

export interface ElectronWorkspaceTerminalSession {
  id: string
  cwd: string
  shell: string
  pid: number
  status: 'running' | 'exited'
  exitCode: number | null
  profile: ElectronWorkspaceCliProfile | null
  updatedAt: number
  lastOutputLine: string | null
}

export interface ElectronWorkspaceTerminalReadResult {
  cursor: number
  chunks: string[]
  session: ElectronWorkspaceTerminalSession
}

export interface ElectronWorkspaceTerminalOutputEvent {
  sessionId: string
  chunk: string
  session: ElectronWorkspaceTerminalSession
}

export interface ElectronIslandPendingApproval {
  id: string
  sessionId?: string
  type: 'write' | 'read' | 'bash' | 'general'
  description: string
  filePath?: string
  codePreview?: string
}

export interface ElectronIslandState {
  projectName: string
  rootPath: string
  activeProfile: ElectronWorkspaceCliProfile | null
  sessionCount: number
  runningSessionCount: number
  status: 'idle' | 'working'
  updatedAt: number
  // AI-specific fields
  currentThinkingMessage?: string
  pendingApproval?: ElectronIslandPendingApproval
  modelName?: string
  contextUsage?: number
  inputTokens?: number
  outputTokens?: number
  currentTool?: string
  feedLines?: string[]
  sessions?: ElectronWorkspaceTerminalSession[]
  activeSessionId?: string
}

export type ElectronDashboardSidebarMode = 'api-config' | 'environment-install' | 'cli-install' | null

export interface ElectronDashboardPresentationState {
  variant: ElectronWorkspaceCliProfile
  sidebarMode: ElectronDashboardSidebarMode
  activeSessionId: string | null
}

export interface ElectronDashboardOpenPayload {
  sessionId?: string | null
  variant?: ElectronWorkspaceCliProfile | null
  createSession?: boolean
}

export const electronOpenDashboard = defineInvokeEventa<void, ElectronDashboardOpenPayload>('eventa:invoke:electron:windows:dashboard:open')

export const electronWorkspaceGetRoot = defineInvokeEventa<string>('eventa:invoke:electron:workspace:get-root')
export const electronWorkspacePickRoot = defineInvokeEventa<string | null>('eventa:invoke:electron:workspace:pick-root')
export const electronWorkspaceGetRevision = defineInvokeEventa<ElectronWorkspaceRevisionSnapshot>('eventa:invoke:electron:workspace:get-revision')
export const electronWorkspaceListDirectory = defineInvokeEventa<ElectronWorkspaceDirectorySnapshot, { path?: string }>('eventa:invoke:electron:workspace:list-directory')
export const electronWorkspaceReadFile = defineInvokeEventa<ElectronWorkspaceFileSnapshot, { path: string }>('eventa:invoke:electron:workspace:read-file')
export const electronWorkspaceWriteFile = defineInvokeEventa<ElectronWorkspaceWriteFileResult, { path: string, content: string }>('eventa:invoke:electron:workspace:write-file')
export const electronWorkspaceCreateFile = defineInvokeEventa<ElectronWorkspaceEntryMutationResult, { path: string }>('eventa:invoke:electron:workspace:create-file')
export const electronWorkspaceCreateDirectory = defineInvokeEventa<ElectronWorkspaceEntryMutationResult, { path: string }>('eventa:invoke:electron:workspace:create-directory')
export const electronWorkspaceRenameEntry = defineInvokeEventa<ElectronWorkspaceRenameEntryResult, { path: string, nextPath: string }>('eventa:invoke:electron:workspace:rename-entry')
export const electronWorkspaceDeleteEntry = defineInvokeEventa<void, { path: string }>('eventa:invoke:electron:workspace:delete-entry')
export const electronWorkspaceCreateTerminal = defineInvokeEventa<ElectronWorkspaceTerminalSession, { cwd?: string, cols?: number, rows?: number, profile?: ElectronWorkspaceCliProfile, envOverride?: Record<string, string | undefined> }>('eventa:invoke:electron:workspace:terminal:create')
export const electronWorkspaceReadTerminal = defineInvokeEventa<ElectronWorkspaceTerminalReadResult, { sessionId: string, cursor?: number }>('eventa:invoke:electron:workspace:terminal:read')
export const electronWorkspaceTerminalOutput = defineEventa<ElectronWorkspaceTerminalOutputEvent>('eventa:event:electron:workspace:terminal:output')
export const electronWorkspaceWriteTerminal = defineInvokeEventa<void, { sessionId: string, data: string }>('eventa:invoke:electron:workspace:terminal:write')
export const electronWorkspaceResizeTerminal = defineInvokeEventa<void, { sessionId: string, cols: number, rows: number }>('eventa:invoke:electron:workspace:terminal:resize')
export const electronWorkspaceCloseTerminal = defineInvokeEventa<void, { sessionId: string }>('eventa:invoke:electron:workspace:terminal:close')
export const electronWorkspaceGetCliProfiles = defineInvokeEventa<ElectronWorkspaceCliProfiles>('eventa:invoke:electron:workspace:cli-profiles:get')
export const electronWorkspaceSetCliProfiles = defineInvokeEventa<void, ElectronWorkspaceCliProfiles>('eventa:invoke:electron:workspace:cli-profiles:set')
export const electronWorkspaceGetSetupStatus = defineInvokeEventa<ElectronWorkspaceSetupStatus>('eventa:invoke:electron:workspace:setup:get-status')
export const electronWorkspaceRunSetupAction = defineInvokeEventa<ElectronWorkspaceSetupResult, { action: ElectronWorkspaceSetupAction }>('eventa:invoke:electron:workspace:setup:run')
export const electronIslandGetState = defineInvokeEventa<ElectronIslandState>('eventa:invoke:electron:island:get-state')
export const electronIslandStateChanged = defineEventa<ElectronIslandState>('eventa:event:electron:island:state-changed')
export const electronIslandRespondApproval = defineInvokeEventa<void, { sessionId: string, response: 'allow' | 'deny', approvalId?: string }>('eventa:invoke:electron:island:respond-approval')
export const electronIslandSubscribeTerminal = defineInvokeEventa<void, { sessionId: string }>('eventa:invoke:electron:island:subscribe-terminal')
export const electronIslandUpdateState = defineInvokeEventa<void, Partial<ElectronIslandState>>('eventa:invoke:electron:island:update-state')
export const electronDashboardPresentationGet = defineInvokeEventa<ElectronDashboardPresentationState>('eventa:invoke:electron:dashboard:presentation:get')
export const electronDashboardPresentationSet = defineInvokeEventa<ElectronDashboardPresentationState, Partial<ElectronDashboardPresentationState>>('eventa:invoke:electron:dashboard:presentation:set')
export const electronDashboardPresentationChanged = defineEventa<ElectronDashboardPresentationState>('eventa:event:electron:dashboard:presentation:changed')

export interface ElectronServerChannelConfig {
  tlsConfig?: ServerOptions['tlsConfig'] | null
}
export const electronGetServerChannelConfig = defineInvokeEventa<ElectronServerChannelConfig>('eventa:invoke:electron:server-channel:get-config')
export const electronApplyServerChannelConfig = defineInvokeEventa<ElectronServerChannelConfig, Partial<ElectronServerChannelConfig>>('eventa:invoke:electron:server-channel:apply-config')

export const electronWindowClose = defineInvokeEventa<void>('eventa:invoke:electron:window:close')
export const electronWindowMinimize = defineInvokeEventa<void>('eventa:invoke:electron:window:minimize')
export const electronWindowToggleMaximize = defineInvokeEventa<void>('eventa:invoke:electron:window:toggle-maximize')
export type ElectronWindowLifecycleReason
  = | 'initial'
    | 'snapshot'
    | 'show'
    | 'hide'
    | 'minimize'
    | 'restore'
    | 'focus'
    | 'blur'

export interface ElectronWindowLifecycleState {
  focused: boolean
  minimized: boolean
  reason: ElectronWindowLifecycleReason
  updatedAt: number
  visible: boolean
}

export const electronWindowLifecycleChanged = defineEventa<ElectronWindowLifecycleState>('eventa:event:electron:window:lifecycle-changed')
export const electronGetWindowLifecycleState = defineInvokeEventa<ElectronWindowLifecycleState>('eventa:invoke:electron:window:get-lifecycle-state')
export const electronWindowSetAlwaysOnTop = defineInvokeEventa<void, boolean>('eventa:invoke:electron:window:set-always-on-top')
export const electronAppOpenUserDataFolder = defineInvokeEventa<{ path: string }>('eventa:invoke:electron:app:open-user-data-folder')
export const electronAppQuit = defineInvokeEventa<void>('eventa:invoke:electron:app:quit')

export const i18nSetLocale = defineInvokeEventa<void, Locale>('eventa:invoke:electron:i18n:set-locale')
export const i18nGetLocale = defineInvokeEventa<Locale>('eventa:invoke:electron:i18n:get-locale')

export { electron } from '@jiaban/electron-eventa'
export * from '@jiaban/electron-eventa/electron-updater'
