<script setup lang="ts">
import { useTheme } from '@jiaban/ui'
import { onMounted, watch } from 'vue'
import { RouterView } from 'vue-router'
import { Toaster } from 'vue-sonner'

import ResizeHandler from './components/ResizeHandler.vue'

const { isDark } = useTheme()
const LIGHT_THEME_COLOR = 'rgb(255 255 255)'
const DARK_THEME_COLOR = 'rgb(18 18 18)'

function ensureThemeColorMetaTag() {
  let meta = document.querySelector('meta[name="theme-color"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    document.head.appendChild(meta)
  }

  return meta
}

function updateThemeColor() {
  ensureThemeColorMetaTag().setAttribute('content', isDark.value ? DARK_THEME_COLOR : LIGHT_THEME_COLOR)
}

watch(isDark, updateThemeColor, { immediate: true })
onMounted(updateThemeColor)
</script>

<template>
  <Toaster />
  <ResizeHandler />
  <RouterView />
</template>
