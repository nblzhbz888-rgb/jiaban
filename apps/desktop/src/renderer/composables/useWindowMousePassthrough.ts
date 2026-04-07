import { electron } from '@jiaban/electron-eventa'
import { useElectronEventaInvoke } from '@jiaban/electron-vueuse'
import { onMounted, onUnmounted, shallowRef } from 'vue'

export function useWindowMousePassthrough() {
  const setIgnoreMouseEvents = useElectronEventaInvoke(electron.window.setIgnoreMouseEvents)
  const isPassthroughEnabled = shallowRef(false)

  async function enablePassthrough() {
    if (isPassthroughEnabled.value) {
      return
    }

    await setIgnoreMouseEvents([true, { forward: true }])
    isPassthroughEnabled.value = true
  }

  async function disablePassthrough() {
    if (!isPassthroughEnabled.value) {
      return
    }

    await setIgnoreMouseEvents([false, { forward: true }])
    isPassthroughEnabled.value = false
  }

  onMounted(() => {
    void enablePassthrough()
  })

  onUnmounted(() => {
    void disablePassthrough()
  })

  return {
    isPassthroughEnabled,
    enablePassthrough,
    disablePassthrough,
  }
}
