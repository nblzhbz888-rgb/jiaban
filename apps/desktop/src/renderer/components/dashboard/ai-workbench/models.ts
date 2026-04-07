import type { ElectronWorkspaceFileSnapshot } from '../../../../shared/eventa'

const PATH_SEGMENT_RE = /[\\/]/
const PATH_SEGMENT_GLOBAL_RE = /[\\/]+/g
const TRAILING_PATH_SEPARATOR_RE = /[\\/]+$/
const LEADING_PATH_SEPARATOR_RE = /^[\\/]/

export type WorkbenchVariant = 'claude' | 'codex'
export type WorkbenchSidebarMode = 'api-config' | 'environment-install' | 'cli-install'
export type WorkspaceEntryType = 'file' | 'directory'
export type WorkspaceEntryDialogMode = 'create-file' | 'create-directory' | 'rename' | 'delete'

export interface WorkspaceTreeNode {
  name: string
  path: string
  type: WorkspaceEntryType
  depth: number
  parentPath: string | null
  isRoot?: boolean
}

export interface WorkspaceEditorTab {
  path: string
  name: string
  snapshot: ElectronWorkspaceFileSnapshot
  content: string
  isDirty: boolean
}

export interface WorkspaceEntryDialogState {
  mode: WorkspaceEntryDialogMode
  path: string
  parentPath: string
  entryType: WorkspaceEntryType
}

export function getEntryName(path: string) {
  return path.split(PATH_SEGMENT_RE).pop() || path
}

export function getParentPath(path: string) {
  const normalizedPath = path.replace(TRAILING_PATH_SEPARATOR_RE, '')
  const separatorIndex = Math.max(normalizedPath.lastIndexOf('/'), normalizedPath.lastIndexOf('\\'))

  if (separatorIndex <= 0) {
    return normalizedPath
  }

  return normalizedPath.slice(0, separatorIndex)
}

export function joinWorkspacePath(root: string, childName: string) {
  const separator = root.includes('\\') ? '\\' : '/'
  const normalizedRoot = root.endsWith(separator) ? root.slice(0, -1) : root
  const normalizedChildName = childName.replace(PATH_SEGMENT_GLOBAL_RE, separator)
  return `${normalizedRoot}${separator}${normalizedChildName}`
}

export function replacePathPrefix(path: string, previousPath: string, nextPath: string) {
  if (path === previousPath) {
    return nextPath
  }

  const separator = previousPath.includes('\\') ? '\\' : '/'
  const prefix = previousPath.endsWith(separator) ? previousPath : `${previousPath}${separator}`
  if (!path.startsWith(prefix)) {
    return path
  }

  return `${nextPath}${path.slice(previousPath.length)}`
}

export function getRelativePath(rootPath: string, path: string) {
  if (path === rootPath) {
    return 'workspace root'
  }

  return path
    .replace(`${rootPath}/`, '')
    .replace(`${rootPath}\\`, '')
}

export function getAncestorDirectoryPaths(rootPath: string, targetPath: string) {
  if (!targetPath.startsWith(rootPath)) {
    return []
  }

  const separator = rootPath.includes('\\') ? '\\' : '/'
  const suffix = targetPath.slice(rootPath.length).replace(LEADING_PATH_SEPARATOR_RE, '')
  if (!suffix) {
    return [rootPath]
  }

  const segments = suffix.split(PATH_SEGMENT_RE).filter(Boolean)
  const directories = [rootPath]
  let currentPath = rootPath

  for (const segment of segments.slice(0, -1)) {
    currentPath = `${currentPath}${separator}${segment}`
    directories.push(currentPath)
  }

  return directories
}

export function isSameOrDescendantPath(path: string, targetPath: string) {
  if (path === targetPath) {
    return true
  }

  const separator = targetPath.includes('\\') ? '\\' : '/'
  const prefix = targetPath.endsWith(separator) ? targetPath : `${targetPath}${separator}`
  return path.startsWith(prefix)
}
