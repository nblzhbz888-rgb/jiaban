import { electron } from '@jiaban/electron-eventa'
import { useElectronEventaInvoke } from '@jiaban/electron-vueuse'
import { useDebounceFn } from '@vueuse/core'
import { computed, shallowRef } from 'vue'

interface UseIslandWindowFrameOptions {
  hasPendingApproval: Readonly<{ value: boolean }>
  screenAvailWidth: Readonly<{ value: number }>
}

interface IslandWindowFramePreset {
  compactWidth: number
  compactHeight: number
  expandedWidth: number
}

interface IslandWindowFrameSize {
  width: number
  height: number
}

const COMPACT_WINDOW_WIDTH = 328
const COMPACT_WINDOW_HEIGHT = 40

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function useIslandWindowFrame(options: UseIslandWindowFrameOptions) {
  const getWindowBounds = useElectronEventaInvoke(electron.window.getBounds)
  const setWindowBounds = useElectronEventaInvoke(electron.window.setBounds)
  const lastAppliedSize = shallowRef<IslandWindowFrameSize | null>(null)

  const framePreset = computed<IslandWindowFramePreset>(() => {
    const safeScreenWidth = options.screenAvailWidth.value || 1440
    const compactPanelWidth = Math.max(720, safeScreenWidth - 40)
    const expandedWidth = options.hasPendingApproval.value
      ? (safeScreenWidth <= 860 ? compactPanelWidth : clamp(safeScreenWidth - 96, 760, 840))
      : (safeScreenWidth <= 820 ? compactPanelWidth : clamp(safeScreenWidth - 96, 760, 840))

    return {
      compactWidth: COMPACT_WINDOW_WIDTH,
      compactHeight: COMPACT_WINDOW_HEIGHT,
      expandedWidth,
    }
  })

  const islandStyleVars = computed(() => ({
    '--island-shell-compact-width': `${framePreset.value.compactWidth}px`,
    '--island-shell-expanded-width': `${framePreset.value.expandedWidth}px`,
  }))

  const syncWindowFrame = useDebounceFn(async (size?: IslandWindowFrameSize) => {
    const nextWidth = clamp(
      Math.ceil(size?.width ?? framePreset.value.compactWidth),
      framePreset.value.compactWidth,
      framePreset.value.expandedWidth,
    )
    const nextHeight = Math.max(
      framePreset.value.compactHeight,
      Math.ceil(size?.height ?? framePreset.value.compactHeight),
    )
    const previousSize = lastAppliedSize.value

    if (previousSize && previousSize.width === nextWidth && previousSize.height === nextHeight) {
      return
    }

    const currentBounds = await getWindowBounds()
    const centerX = currentBounds.x + currentBounds.width / 2

    await setWindowBounds([{
      x: Math.round(centerX - nextWidth / 2),
      y: currentBounds.y,
      width: nextWidth,
      height: nextHeight,
    }])

    lastAppliedSize.value = {
      width: nextWidth,
      height: nextHeight,
    }
  }, 16)

  return {
    islandStyleVars,
    syncWindowFrame,
  }
}
