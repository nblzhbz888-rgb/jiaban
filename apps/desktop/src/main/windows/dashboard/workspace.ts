import type { BrowserWindow, OpenDialogOptions } from 'electron'
import type { IDisposable, IPty } from 'node-pty'

import type {
  ClaudeCodeCliConfig,
  ElectronIslandState,
  ElectronWorkspaceCliProfile,
  ElectronWorkspaceCliProfiles,
  ElectronWorkspaceDirectorySnapshot,
  ElectronWorkspaceEntryMutationResult,
  ElectronWorkspaceFileSnapshot,
  ElectronWorkspaceRenameEntryResult,
  ElectronWorkspaceRevisionSnapshot,
  ElectronWorkspaceSetupAction,
  ElectronWorkspaceSetupCommandStatus,
  ElectronWorkspaceSetupResult,
  ElectronWorkspaceSetupStatus,
  ElectronWorkspaceTerminalOutputEvent,
  ElectronWorkspaceTerminalReadResult,
  ElectronWorkspaceTerminalSession,
  ElectronWorkspaceWriteFileResult,
} from '../../../shared/eventa'

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, watch } from 'node:fs'
import { mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, delimiter, dirname, join, resolve } from 'node:path'

import { app, dialog } from 'electron'

import { extractTerminalSummaryLine, normalizeTerminalLine } from '../shared/terminal-text'

const MAX_FILE_BYTES = 512 * 1024
const MAX_TERMINAL_CHUNKS = 5000
const CLAUDE_DEFAULT_MODEL = 'claude-sonnet-4-6'
const CODEX_DEFAULT_MODEL = 'gpt-5.4-mini'
const CODEX_RELAY_PROVIDER = 'workspace_relay'
const DEFAULT_CLAUDE_RELAY_BASE_URL = 'https://model.xuanxu.net/'
const DEFAULT_CODEX_RELAY_BASE_URL = 'https://model.xuanxu.net/v1'
const SHELL_CONFIG_BLOCK_START = '# >>> Jiaban CLI config >>>'
const SHELL_CONFIG_BLOCK_END = '# <<< Jiaban CLI config <<<'
const CODEX_CONFIG_BLOCK_START = '# >>> Jiaban Codex config >>>'
const CODEX_CONFIG_BLOCK_END = '# <<< Jiaban Codex config <<<'
const OPENAI_BASE_URL_EXPORT_PATTERN = /^export OPENAI_BASE_URL=.*\n?/gm
const MYCODEX_ALIAS_PATTERN = /^alias mycodex=.*\n?/gm
const BREW_INSTALL_COMMAND = 'NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
const SETUP_OUTPUT_START_MARKER = '__OVERTIME_TOGETHER_SETUP_OUTPUT_START__'
const SETUP_OUTPUT_END_MARKER = '__OVERTIME_TOGETHER_SETUP_OUTPUT_END__'
const VERSION_PROBE_TIMEOUT_MS = 8000
const VERSION_OUTPUT_LINE_SPLIT_RE = /\r?\n/
const DUPLICATE_TERMINAL_WRITE_WINDOW_MS = 12
const SESSION_SUMMARY_TAIL_CHUNK_COUNT = 160

const DEFAULT_CLI_PROFILES: ElectronWorkspaceCliProfiles = {
  claude: { mode: 'subscription', apiKey: '', baseUrl: DEFAULT_CLAUDE_RELAY_BASE_URL },
  codex: { mode: 'api-key', apiKey: '', baseUrl: DEFAULT_CODEX_RELAY_BASE_URL },
}

function normalizeCliProfiles(profiles?: Partial<ElectronWorkspaceCliProfiles> | null): ElectronWorkspaceCliProfiles {
  const claude = { ...DEFAULT_CLI_PROFILES.claude, ...profiles?.claude }
  const codex = { ...DEFAULT_CLI_PROFILES.codex, ...profiles?.codex }

  return {
    claude,
    codex,
  }
}

function getCliProfilesPath() {
  return join(app.getPath('userData'), 'workspace-cli-profiles.json')
}

function loadCliProfiles(): ElectronWorkspaceCliProfiles {
  const path = getCliProfilesPath()
  if (!existsSync(path)) {
    return normalizeCliProfiles()
  }
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw)
    return normalizeCliProfiles(parsed)
  }
  catch {
    return normalizeCliProfiles()
  }
}

async function saveCliProfiles(profiles: ElectronWorkspaceCliProfiles) {
  const path = getCliProfilesPath()
  const normalized = normalizeCliProfiles(profiles)
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  await writeFile(tmp, JSON.stringify(normalized, null, 2), 'utf-8')
  await rename(tmp, path)
}

function escapeTomlString(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

function escapeShellValue(value: string) {
  return value.replaceAll(`'`, `'\\''`)
}

function replaceManagedBlock(
  source: string,
  startMarker: string,
  endMarker: string,
  blockContent: string,
) {
  const normalizedSource = source.trimEnd()
  const startIndex = normalizedSource.indexOf(startMarker)
  const endIndex = normalizedSource.indexOf(endMarker)

  if (startIndex >= 0 && endIndex > startIndex) {
    const before = normalizedSource.slice(0, startIndex).trimEnd()
    const after = normalizedSource.slice(endIndex + endMarker.length).trimStart()
    return `${[before, blockContent, after].filter(Boolean).join('\n\n').trimEnd()}\n`
  }

  return `${[normalizedSource, blockContent].filter(Boolean).join('\n\n').trimEnd()}\n`
}

function removeManagedBlock(
  source: string,
  startMarker: string,
  endMarker: string,
) {
  const normalizedSource = source.trimEnd()
  const startIndex = normalizedSource.indexOf(startMarker)
  const endIndex = normalizedSource.indexOf(endMarker)

  if (startIndex < 0 || endIndex <= startIndex) {
    return normalizedSource
  }

  const before = normalizedSource.slice(0, startIndex).trimEnd()
  const after = normalizedSource.slice(endIndex + endMarker.length).trimStart()
  return [before, after].filter(Boolean).join('\n\n').trimEnd()
}

function removeStandaloneCodexModelLine(source: string) {
  const lines = source.split('\n')
  const keptLines: string[] = []

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed.startsWith('model = ')) {
      keptLines.push(line)
      continue
    }

    let nextNonEmptyLine = ''
    for (let j = i + 1; j < lines.length; j += 1) {
      const candidate = lines[j].trim()
      if (!candidate) {
        continue
      }
      nextNonEmptyLine = candidate
      break
    }

    if (!nextNonEmptyLine || nextNonEmptyLine.startsWith('[')) {
      continue
    }

    keptLines.push(line)
  }

  return keptLines.join('\n').trim()
}

async function writeTextFileAtomic(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  await writeFile(tmp, content, 'utf-8')
  await rename(tmp, path)
}

function buildShellExportLine(key: string, value?: string) {
  if (!value) {
    return `unset ${key}`
  }

  return `export ${key}='${escapeShellValue(value)}'`
}

function buildShellConfigBlock(profiles: ElectronWorkspaceCliProfiles) {
  const shellLines = [
    SHELL_CONFIG_BLOCK_START,
    '# Managed by Jiaban. Update from the dashboard API settings panel.',
    '',
    '# Claude Code',
    buildShellExportLine('ANTHROPIC_API_KEY', profiles.claude.mode === 'subscription' ? undefined : profiles.claude.apiKey),
    buildShellExportLine('ANTHROPIC_BASE_URL', profiles.claude.mode === 'relay' ? profiles.claude.baseUrl : undefined),
    '',
    '# Codex',
    buildShellExportLine('OPENAI_API_KEY', profiles.codex.apiKey),
    'unset OPENAI_BASE_URL',
    SHELL_CONFIG_BLOCK_END,
  ]

  return shellLines.join('\n')
}

async function syncShellConfig(profiles: ElectronWorkspaceCliProfiles) {
  const shellConfigPath = join(homedir(), '.zshrc')
  const existing = existsSync(shellConfigPath)
    ? await readFile(shellConfigPath, 'utf-8')
    : ''
  const cleanedExisting = existing
    .replace(OPENAI_BASE_URL_EXPORT_PATTERN, '')
    .replace(MYCODEX_ALIAS_PATTERN, '')

  const nextContent = replaceManagedBlock(
    cleanedExisting,
    SHELL_CONFIG_BLOCK_START,
    SHELL_CONFIG_BLOCK_END,
    buildShellConfigBlock(profiles),
  )

  await writeTextFileAtomic(shellConfigPath, nextContent)
}

function buildCodexConfigBlock(profiles: ElectronWorkspaceCliProfiles) {
  if (profiles.codex.mode !== 'relay' || !profiles.codex.baseUrl) {
    return [
      CODEX_CONFIG_BLOCK_START,
      '# Managed by Jiaban. Relay disabled.',
      `model = "${CODEX_DEFAULT_MODEL}"`,
      CODEX_CONFIG_BLOCK_END,
    ].join('\n')
  }

  return [
    CODEX_CONFIG_BLOCK_START,
    '# Managed by Jiaban. Update from the dashboard API settings panel.',
    `model = "${CODEX_DEFAULT_MODEL}"`,
    `model_provider = "${CODEX_RELAY_PROVIDER}"`,
    '',
    `[model_providers.${CODEX_RELAY_PROVIDER}]`,
    `name = "Jiaban Relay"`,
    `base_url = "${escapeTomlString(profiles.codex.baseUrl)}"`,
    `env_key = "OPENAI_API_KEY"`,
    `wire_api = "responses"`,
    CODEX_CONFIG_BLOCK_END,
  ].join('\n')
}

async function syncCodexConfig(profiles: ElectronWorkspaceCliProfiles) {
  const codexConfigPath = join(homedir(), '.codex', 'config.toml')
  const existing = existsSync(codexConfigPath)
    ? await readFile(codexConfigPath, 'utf-8')
    : ''
  const cleanedExisting = removeManagedBlock(
    existing,
    CODEX_CONFIG_BLOCK_START,
    CODEX_CONFIG_BLOCK_END,
  )
  const cleanedExistingWithoutModel = removeStandaloneCodexModelLine(cleanedExisting)
  const managedBlock = buildCodexConfigBlock(profiles)
  const nextContent = `${[managedBlock, cleanedExistingWithoutModel].filter(Boolean).join('\n\n').trimEnd()}\n`

  await writeTextFileAtomic(codexConfigPath, nextContent)
}

async function syncCodexAuth(profiles: ElectronWorkspaceCliProfiles) {
  const codexAuthPath = join(homedir(), '.codex', 'auth.json')
  const authPayload = {
    auth_mode: 'apikey',
    OPENAI_API_KEY: profiles.codex.apiKey,
  }

  await writeTextFileAtomic(codexAuthPath, `${JSON.stringify(authPayload, null, 2)}\n`)
}

function buildTerminalEnv(profiles: ElectronWorkspaceCliProfiles, profile?: ElectronWorkspaceCliProfile): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
  }

  if (!profile) {
    return base
  }

  if (profile === 'claude') {
    const cfg = profiles.claude
    if (cfg.mode === 'subscription') {
      // Remove any stale API key so the CLI falls back to OAuth
      const env = { ...base }
      delete env.ANTHROPIC_API_KEY
      delete env.ANTHROPIC_BASE_URL
      return env
    }
    if (cfg.mode === 'api-key') {
      return { ...base, ANTHROPIC_API_KEY: cfg.apiKey }
    }
    // relay mode
    return { ...base, ANTHROPIC_API_KEY: cfg.apiKey, ANTHROPIC_BASE_URL: cfg.baseUrl }
  }

  if (profile === 'codex') {
    const cfg = profiles.codex
    const env: NodeJS.ProcessEnv = { ...base, OPENAI_API_KEY: cfg.apiKey }
    delete env.OPENAI_BASE_URL
    return env
  }

  return base
}

let nodePtyPromise: Promise<typeof import('node-pty')> | null = null

interface TerminalSessionRecord {
  id: string
  cwd: string
  shell: string
  process: IPty
  chunks: string[]
  disposables: IDisposable[]
  status: 'running' | 'exited'
  exitCode: number | null
  profile: ElectronWorkspaceCliProfile | null
  createdAt: number
  updatedAt: number
  lastOutputLine: string | null
  pendingInputBuffer: string
  lastSubmittedInputLine: string | null
  lastWriteAt: number
  lastWriteData: string | null
}

function createTerminalSnapshot(session: TerminalSessionRecord): ElectronWorkspaceTerminalSession {
  return {
    id: session.id,
    cwd: session.cwd,
    shell: basename(session.shell),
    pid: session.process.pid ?? -1,
    status: session.status,
    exitCode: session.exitCode,
    profile: session.profile,
    updatedAt: session.updatedAt,
    lastOutputLine: session.lastOutputLine,
  }
}

function sortTerminalSessions(left: TerminalSessionRecord, right: TerminalSessionRecord) {
  if (left.status !== right.status) {
    return left.status === 'running' ? -1 : 1
  }

  return right.createdAt - left.createdAt
}

function appendTerminalInput(session: TerminalSessionRecord, data: string) {
  for (const char of data) {
    if (char === '\r' || char === '\n') {
      const submittedInputLine = normalizeTerminalLine(session.pendingInputBuffer)
      session.lastSubmittedInputLine = submittedInputLine || session.lastSubmittedInputLine
      session.pendingInputBuffer = ''
      continue
    }

    if (char === '\u007F') {
      session.pendingInputBuffer = session.pendingInputBuffer.slice(0, -1)
      continue
    }

    if (char < ' ' || char === '\u001B') {
      continue
    }

    session.pendingInputBuffer += char
  }
}

function shouldSkipDuplicateTerminalWrite(session: TerminalSessionRecord, data: string) {
  if (!session.lastWriteData || session.lastWriteData !== data) {
    return false
  }

  return Date.now() - session.lastWriteAt <= DUPLICATE_TERMINAL_WRITE_WINDOW_MS
}

async function resolveExistingDirectory(path: string) {
  const resolved = await realpath(path)
  const stats = await stat(resolved)
  if (!stats.isDirectory()) {
    throw new Error(`${resolved} is not a directory`)
  }
  return resolved
}

function detectShell() {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'powershell.exe'
  }

  return process.env.SHELL || '/bin/zsh'
}

function supportsShellBootstrapCommand(shell: string) {
  if (process.platform !== 'win32') {
    return true
  }

  const shellName = basename(shell).toLowerCase()
  return shellName === 'powershell.exe'
    || shellName === 'powershell'
    || shellName === 'pwsh.exe'
    || shellName === 'pwsh'
}

function getShellArgs(shell: string, initialCommand?: string) {
  if (process.platform === 'win32') {
    if (!initialCommand || !supportsShellBootstrapCommand(shell)) {
      return []
    }

    return ['-NoExit', '-Command', initialCommand]
  }

  if (!initialCommand) {
    return ['-i', '-l']
  }

  if (basename(shell).toLowerCase() === 'fish') {
    return ['-i', '-C', initialCommand]
  }

  return [
    '-i',
    '-l',
    '-c',
    `${initialCommand}; exec ${buildPosixCliCommand(shell, ['-i', '-l'])}`,
  ]
}

function trimTerminalChunks(chunks: string[]) {
  if (chunks.length > MAX_TERMINAL_CHUNKS) {
    chunks.splice(0, chunks.length - MAX_TERMINAL_CHUNKS)
  }
}

function getTerminalSummaryTailText(session: Pick<TerminalSessionRecord, 'chunks'>) {
  return session.chunks.slice(-SESSION_SUMMARY_TAIL_CHUNK_COUNT).join('')
}

function refreshTerminalSummaryLine(session: TerminalSessionRecord) {
  const nextSummaryLine = extractTerminalSummaryLine(getTerminalSummaryTailText(session), {
    excludeLines: [session.lastSubmittedInputLine],
  })

  if (!nextSummaryLine) {
    return
  }

  const previousSummaryLine = session.lastOutputLine ? normalizeTerminalLine(session.lastOutputLine) : null
  const normalizedNextSummaryLine = normalizeTerminalLine(nextSummaryLine)

  session.lastOutputLine = nextSummaryLine

  if (normalizedNextSummaryLine !== previousSummaryLine) {
    session.lastSubmittedInputLine = null
  }
}

function touchRevision(revisionState: ElectronWorkspaceRevisionSnapshot) {
  revisionState.revision += 1
  revisionState.changedAt = Date.now()
}

function escapePosixShellArg(value: string) {
  return `'${value.replaceAll(`'`, `'\\''`)}'`
}

function escapePowerShellArg(value: string) {
  return `'${value.replaceAll(`'`, `''`)}'`
}

function buildPosixCliCommand(binary: string, args: string[]) {
  return [binary, ...args.map(escapePosixShellArg)].join(' ')
}

function buildPowerShellCliCommand(binary: string, args: string[]) {
  return [`& ${binary}`, ...args.map(escapePowerShellArg)].join(' ')
}

function buildCliCommand(binary: string, args: string[]) {
  if (process.platform === 'win32') {
    return buildPowerShellCliCommand(binary, args)
  }

  return buildPosixCliCommand(binary, args)
}

function wrapBootstrapCommand(binary: 'claude' | 'codex', cliCommand: string) {
  const missingMessage = binary === 'claude'
    ? '[Claude Code CLI not found in PATH. Install the claude command or adjust PATH.]'
    : '[Codex CLI not found in PATH. Install the codex command or adjust PATH.]'

  if (process.platform === 'win32') {
    return `if (Get-Command ${binary} -ErrorAction SilentlyContinue) { ${cliCommand} } else { Write-Host ${escapePowerShellArg(missingMessage)} }`
  }

  return `if command -v ${binary} >/dev/null 2>&1; then ${cliCommand}; else printf '\\r\\n${missingMessage}\\r\\n'; fi`
}

function buildClaudeBootstrapCommand(config: ClaudeCodeCliConfig) {
  const args: string[] = ['--model', CLAUDE_DEFAULT_MODEL]

  if (config.mode !== 'subscription') {
    args.push('--bare')
  }

  return wrapBootstrapCommand('claude', buildCliCommand('claude', args))
}

function buildProfileDebugBanner(
  profiles: ElectronWorkspaceCliProfiles,
  profile?: ElectronWorkspaceCliProfile,
) {
  if (!profile) {
    return null
  }

  if (profile === 'claude') {
    const { mode, baseUrl } = profiles.claude
    const baseUrlLabel = mode === 'relay' && baseUrl
      ? baseUrl
      : '(default)'
    return `[workspace] claude mode=${mode} baseUrl=${baseUrlLabel}`
  }

  const { mode, baseUrl } = profiles.codex
  const baseUrlLabel = mode === 'relay' && baseUrl
    ? baseUrl
    : '(default)'
  return `[workspace] codex mode=${mode} baseUrl=${baseUrlLabel}`
}

function buildCodexBootstrapCommand() {
  return wrapBootstrapCommand('codex', buildCliCommand('codex', ['--model', CODEX_DEFAULT_MODEL]))
}

function getSetupCommandEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }

  if (process.platform === 'darwin') {
    const pathEntries = [
      '/opt/homebrew/bin',
      '/opt/homebrew/sbin',
      '/usr/local/bin',
      '/usr/local/sbin',
      '/opt/local/bin',
      '/opt/local/sbin',
      `${homedir()}/.local/bin`,
      `${homedir()}/bin`,
      env.PATH ?? '',
    ].filter(Boolean)

    env.PATH = pathEntries.join(':')
  }
  else if (process.platform !== 'win32') {
    const pathEntries = [
      '/usr/local/bin',
      '/usr/local/sbin',
      '/usr/bin',
      '/bin',
      `${homedir()}/.local/bin`,
      `${homedir()}/bin`,
      env.PATH ?? '',
    ].filter(Boolean)

    env.PATH = pathEntries.join(':')
  }

  return env
}

function getSetupShell() {
  if (process.platform === 'win32') {
    return 'powershell.exe'
  }

  return process.env.SHELL || '/bin/zsh'
}

function getSetupShellCommand(command: string) {
  const shell = getSetupShell()
  return {
    shell,
    args: getSetupShellEvalArgs(shell, command),
  }
}

function getSetupShellEvalArgs(shell: string, command: string) {
  if (process.platform === 'win32') {
    return ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command]
  }

  if (basename(shell).toLowerCase() === 'fish') {
    return ['-l', '-c', command]
  }

  return ['-l', '-c', command]
}

function extractMarkedOutput(output: string) {
  const startIndex = output.indexOf(SETUP_OUTPUT_START_MARKER)
  const endIndex = output.indexOf(SETUP_OUTPUT_END_MARKER)

  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    return output.trim()
  }

  return output
    .slice(startIndex + SETUP_OUTPUT_START_MARKER.length, endIndex)
    .trim()
}

function buildVersionProbeCommand(command: string, args: string[]) {
  if (process.platform === 'win32') {
    const cliCommand = buildCliCommand(command, args)
    return [
      `$cmd = Get-Command ${command} -ErrorAction SilentlyContinue`,
      'if (-not $cmd) { exit 127 }',
      `Write-Output '${SETUP_OUTPUT_START_MARKER}'`,
      cliCommand,
      `Write-Output '${SETUP_OUTPUT_END_MARKER}'`,
    ].join('; ')
  }

  const cliCommand = buildCliCommand(command, args)
  return `if command -v ${command} >/dev/null 2>&1; then printf '%s\\n' '${SETUP_OUTPUT_START_MARKER}'; ${cliCommand}; printf '%s\\n' '${SETUP_OUTPUT_END_MARKER}'; else exit 127; fi`
}

function getSetupCommandDirectories() {
  const env = getSetupCommandEnv()
  const directories = new Set((env.PATH ?? '').split(delimiter).filter(Boolean))
  const home = homedir()

  for (const extraDirectory of [
    join(home, '.local', 'bin'),
    join(home, 'bin'),
    join(home, '.volta', 'bin'),
    join(home, '.asdf', 'shims'),
    join(home, '.nvm', 'current', 'bin'),
    join(home, '.local', 'share', 'pnpm'),
  ]) {
    directories.add(extraDirectory)
  }

  const nvmVersionsDirectory = join(home, '.nvm', 'versions', 'node')
  if (existsSync(nvmVersionsDirectory)) {
    const versionDirectories = readdirSync(nvmVersionsDirectory, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => join(nvmVersionsDirectory, entry.name, 'bin'))
      .reverse()

    for (const versionDirectory of versionDirectories) {
      directories.add(versionDirectory)
    }
  }

  return Array.from(directories)
}

function findCommandExecutable(command: string) {
  const executableNames = process.platform === 'win32'
    ? [command, `${command}.cmd`, `${command}.exe`, `${command}.bat`]
    : [command]

  for (const directory of getSetupCommandDirectories()) {
    for (const executableName of executableNames) {
      const executablePath = join(directory, executableName)
      if (existsSync(executablePath)) {
        return executablePath
      }
    }
  }

  return null
}

function createUnavailableCommandStatus(command: string): ElectronWorkspaceSetupCommandStatus {
  return {
    command,
    available: false,
    version: null,
  }
}

async function readCommandVersionFromExecutable(
  command: string,
  executablePath: string,
  args: string[],
) {
  return await new Promise<ElectronWorkspaceSetupCommandStatus>((resolve) => {
    const child = spawn(executablePath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: getSetupCommandEnv(),
    })

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let settled = false

    const timeout = setTimeout(() => {
      if (settled) {
        return
      }

      settled = true
      child.kill('SIGKILL')
      resolve(createUnavailableCommandStatus(command))
    }, VERSION_PROBE_TIMEOUT_MS)

    function finalize(status: ElectronWorkspaceSetupCommandStatus) {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeout)
      resolve(status)
    }

    child.stdout?.on('data', chunk => stdoutChunks.push(Buffer.from(chunk)))
    child.stderr?.on('data', chunk => stderrChunks.push(Buffer.from(chunk)))

    child.on('error', () => finalize(createUnavailableCommandStatus(command)))
    child.on('close', (code) => {
      const output = Buffer.concat([...stdoutChunks, ...stderrChunks]).toString('utf8').trim()
      const versionLine = output.split(VERSION_OUTPUT_LINE_SPLIT_RE).map(line => line.trim()).find(Boolean) ?? null

      finalize({
        command,
        available: code === 0,
        version: code === 0 ? versionLine : null,
      })
    })
  })
}

async function readCommandVersion(command: string, args: string[] = ['--version']) {
  const executablePath = findCommandExecutable(command)
  if (executablePath) {
    return await readCommandVersionFromExecutable(command, executablePath, args)
  }

  return await new Promise<ElectronWorkspaceSetupCommandStatus>((resolve) => {
    const shell = getSetupShell()
    const child = spawn(shell, getSetupShellEvalArgs(shell, buildVersionProbeCommand(command, args)), {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: getSetupCommandEnv(),
    })

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let settled = false

    const timeout = setTimeout(() => {
      if (settled) {
        return
      }

      settled = true
      child.kill('SIGKILL')
      resolve(createUnavailableCommandStatus(command))
    }, VERSION_PROBE_TIMEOUT_MS)

    function finalize(status: ElectronWorkspaceSetupCommandStatus) {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeout)
      resolve(status)
    }

    child.stdout?.on('data', chunk => stdoutChunks.push(Buffer.from(chunk)))
    child.stderr?.on('data', chunk => stderrChunks.push(Buffer.from(chunk)))

    child.on('error', () => finalize(createUnavailableCommandStatus(command)))

    child.on('close', (code) => {
      const output = extractMarkedOutput(Buffer.concat([...stdoutChunks, ...stderrChunks]).toString('utf8'))
      const versionLine = output.split(VERSION_OUTPUT_LINE_SPLIT_RE).map(line => line.trim()).find(Boolean) ?? null

      finalize({
        command,
        available: code === 0,
        version: code === 0 ? versionLine : null,
      })
    })
  })
}

async function detectPackageManager() {
  if (process.platform === 'darwin') {
    const brew = await readCommandVersion('brew', ['--version'])
    return brew.available ? 'brew' : null
  }

  if (process.platform === 'win32') {
    const winget = await readCommandVersion('winget', ['--version'])
    return winget.available ? 'winget' : null
  }

  for (const candidate of ['brew', 'apt-get', 'dnf'] as const) {
    const status = await readCommandVersion(candidate, ['--version'])
    if (status.available) {
      return candidate
    }
  }

  return null
}

function buildEnvironmentInstallCommand(packageManager: string | null) {
  if (process.platform === 'darwin') {
    if (packageManager === 'brew') {
      return 'brew install git node pnpm'
    }

    return `${BREW_INSTALL_COMMAND} && eval "$(/opt/homebrew/bin/brew shellenv || /usr/local/bin/brew shellenv)" && brew install git node pnpm`
  }

  if (process.platform === 'win32') {
    if (packageManager !== 'winget') {
      throw new Error('未检测到 winget，暂时无法在 Windows 上自动安装开发环境。')
    }

    return [
      'winget install --id Git.Git -e --accept-package-agreements --accept-source-agreements',
      'winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements',
      'npm install -g pnpm',
    ].join('; ')
  }

  if (packageManager === 'brew') {
    return 'brew install git node pnpm'
  }

  if (packageManager === 'apt-get') {
    return 'sudo apt-get update && sudo apt-get install -y git nodejs npm && sudo npm install -g pnpm'
  }

  if (packageManager === 'dnf') {
    return 'sudo dnf install -y git nodejs npm && sudo npm install -g pnpm'
  }

  throw new Error('未检测到可用的系统包管理器，无法自动安装开发环境。')
}

function buildCliToolsInstallCommand(packageManager: string | null) {
  const envBootstrap = buildEnvironmentInstallCommand(packageManager)

  if (process.platform === 'darwin') {
    if (packageManager === 'brew') {
      return `${envBootstrap} && brew install --cask claude-code && npm install -g @openai/codex`
    }

    return `${envBootstrap} && curl -fsSL https://claude.ai/install.sh | bash && npm install -g @openai/codex`
  }

  if (process.platform === 'win32') {
    if (packageManager !== 'winget') {
      throw new Error('未检测到 winget，暂时无法在 Windows 上自动安装 CLI 工具。')
    }

    return `${envBootstrap}; winget install --id Anthropic.ClaudeCode -e --accept-package-agreements --accept-source-agreements; npm install -g @openai/codex`
  }

  return `${envBootstrap} && curl -fsSL https://claude.ai/install.sh | bash && npm install -g @openai/codex`
}

async function runSetupCommand(action: ElectronWorkspaceSetupAction) {
  const packageManager = await detectPackageManager()
  const command = action === 'install-environment'
    ? buildEnvironmentInstallCommand(packageManager)
    : buildCliToolsInstallCommand(packageManager)
  const { shell, args } = getSetupShellCommand(command)

  return await new Promise<ElectronWorkspaceSetupResult>((resolve, reject) => {
    const child = spawn(shell, args, {
      env: getSetupCommandEnv(),
      cwd: homedir(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const outputChunks: Buffer[] = []
    child.stdout?.on('data', chunk => outputChunks.push(Buffer.from(chunk)))
    child.stderr?.on('data', chunk => outputChunks.push(Buffer.from(chunk)))

    child.on('error', reject)
    child.on('close', (code) => {
      const success = code === 0
      const summary = action === 'install-environment'
        ? (success ? '编程环境安装完成。' : '编程环境安装失败。')
        : (success ? 'Claude Code 和 Codex CLI 安装完成。' : 'CLI 工具安装失败。')

      resolve({
        action,
        success,
        summary,
        command,
        log: Buffer.concat(outputChunks).toString('utf8').trim(),
      })
    })
  })
}

async function collectSetupStatus(): Promise<ElectronWorkspaceSetupStatus> {
  const [git, node, pnpm, claude, codex, packageManager] = await Promise.all([
    readCommandVersion('git'),
    readCommandVersion('node'),
    readCommandVersion('pnpm'),
    readCommandVersion('claude'),
    readCommandVersion('codex'),
    detectPackageManager(),
  ])

  return {
    platform: process.platform,
    packageManager,
    environment: {
      git,
      node,
      pnpm,
    },
    cli: {
      claude,
      codex,
    },
  }
}

function getTerminalBootstrapCommand(
  profiles: ElectronWorkspaceCliProfiles,
  profile?: ElectronWorkspaceCliProfile,
) {
  if (!profile) {
    return null
  }

  if (profile === 'claude') {
    return buildClaudeBootstrapCommand(profiles.claude)
  }

  return buildCodexBootstrapCommand()
}

async function getNodePty() {
  if (!nodePtyPromise) {
    nodePtyPromise = import('node-pty')
  }

  return await nodePtyPromise
}

async function createTerminalProcess(params: {
  shell: string
  cwd: string
  env: NodeJS.ProcessEnv
  cols?: number
  rows?: number
  initialCommand?: string
}) {
  const nodePty = await getNodePty()

  return nodePty.spawn(params.shell, getShellArgs(params.shell, params.initialCommand), {
    name: 'xterm-256color',
    cwd: params.cwd,
    env: params.env,
    cols: Math.max(20, params.cols ?? 120),
    rows: Math.max(8, params.rows ?? 32),
    useConpty: true,
  })
}

export async function resolveDefaultWorkspaceRoot() {
  const candidates = [
    process.cwd(),
    join(homedir(), 'jiabansoul', 'jiaban'),
    join(app.getPath('home'), 'jiabansoul', 'jiaban'),
    app.getPath('home'),
  ]

  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue
    }

    const looksLikeRepo = existsSync(join(candidate, '.git')) || existsSync(join(candidate, 'pnpm-workspace.yaml'))
    if (!looksLikeRepo && candidate !== app.getPath('home')) {
      continue
    }

    try {
      return await resolveExistingDirectory(candidate)
    }
    catch {
      continue
    }
  }

  return await resolveExistingDirectory(app.getPath('home'))
}

export async function createDashboardWorkspaceService() {
  let rootPath = await resolveDefaultWorkspaceRoot()
  const sessions = new Map<string, TerminalSessionRecord>()
  const terminalOutputListeners = new Set<(payload: ElectronWorkspaceTerminalOutputEvent) => void>()
  const revisionState: ElectronWorkspaceRevisionSnapshot = {
    revision: 0,
    changedAt: Date.now(),
  }
  let cliProfiles: ElectronWorkspaceCliProfiles = loadCliProfiles()
  const watcherDisposers: Array<() => void> = []
  let rootWatcher: ReturnType<typeof watch> | null = null
  let rootWatcherDisposerRegistered = false
  let emitIslandState: ((payload: ElectronIslandState) => void) | null = null
  let lastActiveProfile: ElectronWorkspaceCliProfile | null = null
  let activeSessionId: string | null = null

  function getFallbackActiveSessionId() {
    return Array.from(sessions.values())
      .sort(sortTerminalSessions)
      .at(0)
      ?.id ?? null
  }

  function getResolvedActiveSessionId() {
    if (activeSessionId && sessions.has(activeSessionId)) {
      return activeSessionId
    }

    return getFallbackActiveSessionId()
  }

  function updateActiveSessionId(sessionId?: string | null, options?: { emit?: boolean }) {
    const nextActiveSessionId = sessionId && sessions.has(sessionId)
      ? sessionId
      : getFallbackActiveSessionId()

    activeSessionId = nextActiveSessionId

    if (nextActiveSessionId) {
      lastActiveProfile = sessions.get(nextActiveSessionId)?.profile ?? lastActiveProfile
    }

    if (options?.emit !== false) {
      emitIslandStateSnapshot()
    }

    return activeSessionId
  }

  function createIslandStateSnapshot(): ElectronIslandState {
    const runningSessionCount = Array.from(sessions.values()).filter(session => session.status === 'running').length
    const orderedSessions = getTerminalSessions()

    return {
      projectName: basename(rootPath) || rootPath,
      rootPath,
      activeProfile: lastActiveProfile,
      sessionCount: sessions.size,
      runningSessionCount,
      status: runningSessionCount > 0 ? 'working' : 'idle',
      sessions: orderedSessions,
      activeSessionId: getResolvedActiveSessionId() ?? undefined,
      updatedAt: Date.now(),
    }
  }

  function emitIslandStateSnapshot() {
    emitIslandState?.(createIslandStateSnapshot())
  }

  function emitTerminalOutputPayload(payload: ElectronWorkspaceTerminalOutputEvent) {
    for (const listener of terminalOutputListeners) {
      listener(payload)
    }
  }

  function pushTerminalChunk(session: TerminalSessionRecord, chunk: string) {
    if (!chunk) {
      return
    }

    session.chunks.push(chunk)
    trimTerminalChunks(session.chunks)
    session.updatedAt = Date.now()
    refreshTerminalSummaryLine(session)

    emitTerminalOutputPayload({
      sessionId: session.id,
      chunk,
      session: createTerminalSnapshot(session),
    })
    emitIslandStateSnapshot()
  }

  function disposeRootWatcher() {
    if (!rootWatcher) {
      return
    }

    rootWatcher.close()
    rootWatcher = null
  }

  function attachRootWatcher(nextRootPath: string) {
    disposeRootWatcher()

    try {
      rootWatcher = watch(nextRootPath, {
        recursive: process.platform === 'darwin' || process.platform === 'win32',
      }, () => {
        touchRevision(revisionState)
      })

      if (!rootWatcherDisposerRegistered) {
        watcherDisposers.push(() => {
          disposeRootWatcher()
        })
        rootWatcherDisposerRegistered = true
      }
    }
    catch {
      // NOTICE: recursive workspace watching is best-effort here.
      // Some platforms/filesystems reject it, so we keep the workbench usable and
      // still rely on explicit mutation hooks to refresh the renderer state.
    }
  }

  attachRootWatcher(rootPath)

  async function resolveWorkspacePath(path?: string) {
    const requestedPath = path ? resolve(path) : rootPath
    return await realpath(requestedPath)
  }

  async function resolveWorkspaceTargetPath(path: string) {
    const requestedPath = resolve(path)
    const parentDirectoryPath = dirname(requestedPath)
    const resolvedParentDirectoryPath = await realpath(parentDirectoryPath)
    return join(resolvedParentDirectoryPath, basename(requestedPath))
  }

  function assertEditablePath(path: string) {
    if (path === rootPath) {
      throw new Error('Workspace root cannot be modified')
    }
  }

  async function closeAllTerminalSessions() {
    for (const sessionId of Array.from(sessions.keys())) {
      closeTerminal(sessionId)
    }
  }

  async function setWorkspaceRoot(nextRootPath: string) {
    const resolvedRootPath = await resolveExistingDirectory(nextRootPath)

    if (resolvedRootPath === rootPath) {
      return rootPath
    }

    rootPath = resolvedRootPath
    revisionState.revision = 0
    revisionState.changedAt = Date.now()
    await closeAllTerminalSessions()
    attachRootWatcher(rootPath)
    touchRevision(revisionState)
    emitIslandStateSnapshot()

    return rootPath
  }

  async function listDirectory(path?: string): Promise<ElectronWorkspaceDirectorySnapshot> {
    const directoryPath = await resolveWorkspacePath(path)
    const directoryStats = await stat(directoryPath)
    if (!directoryStats.isDirectory()) {
      throw new Error(`${directoryPath} is not a directory`)
    }

    const entries = await readdir(directoryPath, { withFileTypes: true })
    const normalizedEntries = entries
      .filter(entry => entry.name !== '.git')
      .map(entry => ({
        name: entry.name,
        path: join(directoryPath, entry.name),
        type: entry.isDirectory() ? 'directory' as const : 'file' as const,
      }))
      .sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1
        }

        return a.name.localeCompare(b.name)
      })

    return {
      root: rootPath,
      path: directoryPath,
      parentPath: directoryPath === rootPath ? null : resolve(directoryPath, '..'),
      entries: normalizedEntries,
    }
  }

  async function readWorkspaceFile(path: string): Promise<ElectronWorkspaceFileSnapshot> {
    const filePath = await resolveWorkspacePath(path)
    const fileStats = await stat(filePath)
    if (!fileStats.isFile()) {
      throw new Error(`${filePath} is not a file`)
    }

    const buffer = await readFile(filePath)
    const isBinary = buffer.subarray(0, 8000).includes(0)
    const tooLarge = buffer.byteLength > MAX_FILE_BYTES

    return {
      path: filePath,
      size: buffer.byteLength,
      content: isBinary ? '' : buffer.subarray(0, MAX_FILE_BYTES).toString('utf8'),
      isBinary,
      tooLarge,
    }
  }

  async function writeWorkspaceFile(path: string, content: string): Promise<ElectronWorkspaceWriteFileResult> {
    const filePath = await resolveWorkspacePath(path)
    const fileStats = await stat(filePath)
    if (!fileStats.isFile()) {
      throw new Error(`${filePath} is not a file`)
    }

    await writeFile(filePath, content, 'utf8')
    touchRevision(revisionState)

    return {
      path: filePath,
      size: Buffer.byteLength(content, 'utf8'),
    }
  }

  async function createFile(path: string): Promise<ElectronWorkspaceEntryMutationResult> {
    const filePath = await resolveWorkspaceTargetPath(path)
    await writeFile(filePath, '', { encoding: 'utf8', flag: 'wx' })
    touchRevision(revisionState)

    return {
      path: filePath,
      type: 'file',
    }
  }

  async function createDirectory(path: string): Promise<ElectronWorkspaceEntryMutationResult> {
    const directoryPath = await resolveWorkspaceTargetPath(path)
    await mkdir(directoryPath, { recursive: false })
    touchRevision(revisionState)

    return {
      path: directoryPath,
      type: 'directory',
    }
  }

  async function renameEntry(path: string, nextPath: string): Promise<ElectronWorkspaceRenameEntryResult> {
    const currentPath = await resolveWorkspacePath(path)
    assertEditablePath(currentPath)

    const targetPath = await resolveWorkspaceTargetPath(nextPath)
    if (currentPath === targetPath) {
      const currentStats = await stat(currentPath)
      return {
        previousPath: currentPath,
        path: currentPath,
        type: currentStats.isDirectory() ? 'directory' : 'file',
      }
    }

    const currentStats = await stat(currentPath)
    await rename(currentPath, targetPath)
    touchRevision(revisionState)

    return {
      previousPath: currentPath,
      path: targetPath,
      type: currentStats.isDirectory() ? 'directory' : 'file',
    }
  }

  async function deleteEntry(path: string) {
    const targetPath = await resolveWorkspacePath(path)
    assertEditablePath(targetPath)
    await rm(targetPath, { recursive: true, force: false })
    touchRevision(revisionState)
  }

  async function pickRoot(window?: BrowserWindow) {
    const dialogOptions: OpenDialogOptions = {
      title: '选择工作区目录',
      defaultPath: rootPath,
      properties: ['openDirectory', 'createDirectory'],
    }
    const result = window
      ? await dialog.showOpenDialog(window, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return setWorkspaceRoot(result.filePaths[0])
  }

  async function createTerminal(payload?: { cwd?: string, cols?: number, rows?: number, profile?: ElectronWorkspaceCliProfile, envOverride?: Record<string, string | undefined> }): Promise<ElectronWorkspaceTerminalSession> {
    const cwd = await resolveWorkspacePath(payload?.cwd)
    const shell = detectShell()
    const id = randomUUID()
    const activeCliProfiles = loadCliProfiles()
    cliProfiles = activeCliProfiles
    lastActiveProfile = payload?.profile ?? lastActiveProfile
    const bootstrapCommand = getTerminalBootstrapCommand(activeCliProfiles, payload?.profile)
    const shouldUseShellBootstrapCommand = supportsShellBootstrapCommand(shell)

    // Build base env from persisted profiles, then apply renderer-supplied override on top.
    // Renderer override wins so that UI changes take effect immediately without restart.
    const baseEnv = buildTerminalEnv(activeCliProfiles, payload?.profile)
    const finalEnv: NodeJS.ProcessEnv = { ...baseEnv }
    if (payload?.envOverride) {
      for (const [key, value] of Object.entries(payload.envOverride)) {
        if (value === undefined) {
          delete finalEnv[key]
        }
        else {
          finalEnv[key] = value
        }
      }
    }

    const childProcess = await createTerminalProcess({
      shell,
      cwd,
      env: finalEnv,
      cols: payload?.cols,
      rows: payload?.rows,
      initialCommand: shouldUseShellBootstrapCommand ? bootstrapCommand ?? undefined : undefined,
    })

    const session: TerminalSessionRecord = {
      id,
      cwd,
      shell,
      process: childProcess,
      chunks: [],
      disposables: [],
      status: 'running',
      exitCode: null,
      profile: payload?.profile ?? null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastOutputLine: null,
      pendingInputBuffer: '',
      lastSubmittedInputLine: null,
      lastWriteAt: 0,
      lastWriteData: null,
    }

    session.disposables.push(childProcess.onData((chunk) => {
      pushTerminalChunk(session, chunk)
    }))

    session.disposables.push(childProcess.onExit(({ exitCode }) => {
      session.status = 'exited'
      session.exitCode = exitCode
      session.updatedAt = Date.now()
      pushTerminalChunk(session, `\r\n[process exited with code ${exitCode ?? 0}]\r\n`)
      emitIslandStateSnapshot()
    }))

    sessions.set(id, session)
    activeSessionId = session.id
    emitIslandStateSnapshot()

    const profileDebugBanner = buildProfileDebugBanner(activeCliProfiles, payload?.profile)
    if (profileDebugBanner) {
      pushTerminalChunk(session, `${profileDebugBanner}\r\n`)
    }

    if (!shouldUseShellBootstrapCommand && bootstrapCommand) {
      childProcess.write(`${bootstrapCommand}\r`)
    }

    return createTerminalSnapshot(session)
  }

  function getSession(sessionId: string) {
    const session = sessions.get(sessionId)
    if (!session) {
      throw new Error(`Unknown terminal session: ${sessionId}`)
    }

    return session
  }

  function readTerminal(sessionId: string, cursor = 0): ElectronWorkspaceTerminalReadResult {
    const session = getSession(sessionId)
    const normalizedCursor = Math.max(0, Math.min(cursor, session.chunks.length))

    return {
      cursor: session.chunks.length,
      chunks: session.chunks.slice(normalizedCursor),
      session: createTerminalSnapshot(session),
    }
  }

  function getTerminalSessions(): ElectronWorkspaceTerminalSession[] {
    return Array.from(sessions.values())
      .sort(sortTerminalSessions)
      .map(createTerminalSnapshot)
  }

  function writeTerminal(sessionId: string, data: string) {
    const session = getSession(sessionId)
    if (session.status !== 'running') {
      return
    }

    if (shouldSkipDuplicateTerminalWrite(session, data)) {
      return
    }

    session.lastWriteAt = Date.now()
    session.lastWriteData = data
    appendTerminalInput(session, data)
    session.process.write(data)
  }

  function resizeTerminal(sessionId: string, cols: number, rows: number) {
    const session = getSession(sessionId)
    if (session.status !== 'running') {
      return
    }

    session.process.resize(Math.max(20, cols), Math.max(8, rows))
  }

  function closeTerminal(sessionId: string) {
    const session = sessions.get(sessionId)
    if (!session) {
      return
    }

    const processToKill = session.status === 'running'
      ? session.process
      : null

    for (const disposable of session.disposables) {
      disposable.dispose()
    }

    sessions.delete(sessionId)
    updateActiveSessionId(activeSessionId === sessionId ? null : activeSessionId)

    if (processToKill) {
      globalThis.setTimeout(() => {
        try {
          processToKill.kill()
        }
        catch {
          // Ignore teardown races when the PTY already exited on its own.
        }
      }, 0)
    }
  }

  function subscribeTerminalOutput(listener: (payload: ElectronWorkspaceTerminalOutputEvent) => void) {
    terminalOutputListeners.add(listener)

    return () => {
      terminalOutputListeners.delete(listener)
    }
  }

  function setIslandStateEmitter(listener: ((payload: ElectronIslandState) => void) | null) {
    emitIslandState = listener
    emitIslandStateSnapshot()
  }

  function setActiveSessionId(sessionId: string | null) {
    updateActiveSessionId(sessionId)
  }

  function setPreferredProfile(profile: ElectronWorkspaceCliProfile | null) {
    lastActiveProfile = profile
    emitIslandStateSnapshot()
  }

  function dispose() {
    terminalOutputListeners.clear()

    for (const sessionId of sessions.keys()) {
      closeTerminal(sessionId)
    }

    emitIslandState = null

    for (const disposeWatcher of watcherDisposers) {
      disposeWatcher()
    }
  }

  function getCliProfiles(): ElectronWorkspaceCliProfiles {
    cliProfiles = loadCliProfiles()
    return cliProfiles
  }

  async function setCliProfiles(profiles: ElectronWorkspaceCliProfiles) {
    cliProfiles = profiles
    await saveCliProfiles(profiles)
    await syncShellConfig(profiles)
    await syncCodexAuth(profiles)
    await syncCodexConfig(profiles)
  }

  async function getSetupStatus() {
    return await collectSetupStatus()
  }

  async function runSetupAction(action: ElectronWorkspaceSetupAction) {
    return await runSetupCommand(action)
  }

  return {
    getRoot: () => rootPath,
    pickRoot,
    getRevision: () => revisionState,
    getTerminalSessions,
    subscribeTerminalOutput,
    setIslandStateEmitter,
    setActiveSessionId,
    setPreferredProfile,
    getIslandState: createIslandStateSnapshot,
    listDirectory,
    readWorkspaceFile,
    writeWorkspaceFile,
    createFile,
    createDirectory,
    renameEntry,
    deleteEntry,
    createTerminal,
    readTerminal,
    writeTerminal,
    resizeTerminal,
    closeTerminal,
    getCliProfiles,
    setCliProfiles,
    getSetupStatus,
    runSetupAction,
    dispose,
  }
}
