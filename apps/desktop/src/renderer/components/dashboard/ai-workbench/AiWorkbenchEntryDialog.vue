<script setup lang="ts">
import type { WorkspaceEntryDialogMode, WorkspaceEntryType } from './models'

import { Input } from '@jiaban/ui'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { computed, nextTick, useTemplateRef, watch } from 'vue'

const props = defineProps<{
  open: boolean
  name: string
  mode: WorkspaceEntryDialogMode
  pending: boolean
  errorMessage: string
  targetLabel: string
  parentLabel: string
  entryType: WorkspaceEntryType
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:name': [value: string]
  'confirm': []
}>()

const inputRef = useTemplateRef<HTMLInputElement>('inputRef')
const nameModel = computed({
  get: () => props.name,
  set: value => emit('update:name', value),
})

const title = computed(() => {
  switch (props.mode) {
    case 'create-file':
      return '新建文件'
    case 'create-directory':
      return '新建目录'
    case 'rename':
      return '重命名'
    case 'delete':
      return '删除'
  }

  return '文件操作'
})

const description = computed(() => {
  switch (props.mode) {
    case 'create-file':
      return `在 ${props.parentLabel} 下创建新文件。`
    case 'create-directory':
      return `在 ${props.parentLabel} 下创建新目录。`
    case 'rename':
      return `重命名当前${props.entryType === 'directory' ? '目录' : '文件'}。`
    case 'delete':
      return `删除 ${props.targetLabel}。目录会递归删除其中内容。`
  }

  return ''
})

const confirmLabel = computed(() => {
  switch (props.mode) {
    case 'create-file':
      return props.pending ? '创建中...' : '创建文件'
    case 'create-directory':
      return props.pending ? '创建中...' : '创建目录'
    case 'rename':
      return props.pending ? '处理中...' : '确认重命名'
    case 'delete':
      return props.pending ? '删除中...' : '确认删除'
  }

  return '确认'
})

const needsNameInput = computed(() => props.mode !== 'delete')

watch(() => props.open, async (isOpen) => {
  if (!isOpen || !needsNameInput.value) {
    return
  }

  await nextTick()
  inputRef.value?.focus()
  inputRef.value?.select()
})

function handleConfirm() {
  emit('confirm')
}
</script>

<template>
  <DialogRoot :open="props.open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-[9999] bg-black/45 backdrop-blur-sm data-[state=closed]:animate-fadeOut data-[state=open]:animate-fadeIn" />

      <DialogContent class="fixed left-1/2 top-1/2 z-[10000] w-[min(92vw,28rem)] rounded-[28px] bg-white p-6 shadow-xl outline-none -translate-x-1/2 -translate-y-1/2 data-[state=closed]:animate-contentHide data-[state=open]:animate-contentShow dark:bg-neutral-900">
        <DialogTitle class="text-lg text-neutral-900 font-semibold dark:text-neutral-100">
          {{ title }}
        </DialogTitle>

        <DialogDescription class="mt-2 text-sm text-neutral-500 leading-6 dark:text-neutral-400">
          {{ description }}
        </DialogDescription>

        <div class="mt-5 space-y-3">
          <template v-if="needsNameInput">
            <div>
              <div class="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
                {{ props.mode === 'rename' ? '新名称' : '名称' }}
              </div>
              <Input
                ref="inputRef"
                v-model="nameModel"
                placeholder="请输入名称"
                variant="primary-dimmed"
                @keydown.enter.prevent="handleConfirm"
              />
            </div>

            <div class="rounded-2xl bg-neutral-100 px-4 py-3 text-xs text-neutral-500 dark:bg-neutral-800/80 dark:text-neutral-300">
              目标目录 · {{ props.parentLabel }}
            </div>
          </template>

          <div
            v-else
            class="rounded-2xl bg-neutral-100 px-4 py-3 text-sm text-neutral-600 leading-6 dark:bg-neutral-800/80 dark:text-neutral-300"
          >
            {{ props.targetLabel }}
          </div>

          <div
            v-if="props.errorMessage"
            class="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-600 dark:bg-rose-950/40 dark:text-rose-300"
          >
            {{ props.errorMessage }}
          </div>
        </div>

        <div class="mt-6 flex justify-end gap-3">
          <button
            class="border border-neutral-300 rounded-2xl px-4 py-2 text-sm text-neutral-700 transition dark:border-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
            type="button"
            @click="emit('update:open', false)"
          >
            取消
          </button>
          <button
            :class="[
              'rounded-2xl px-4 py-2 text-sm text-white transition disabled:cursor-not-allowed disabled:opacity-50',
              props.mode === 'delete'
                ? 'bg-rose-600 hover:bg-rose-700'
                : 'bg-neutral-900 hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200',
            ]"
            :disabled="props.pending || (needsNameInput && !props.name.trim())"
            type="button"
            @click="handleConfirm"
          >
            {{ confirmLabel }}
          </button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
