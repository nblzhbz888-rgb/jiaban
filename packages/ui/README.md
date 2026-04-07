# @jiaban/ui

A stylized UI component library built with [Reka UI](https://reka-ui.com/) and [UnoCSS](https://unocss.dev/).

## Get started

Install the library:

```shell
ni @jiaban/ui -D # from @antfu/ni, can be installed via `npm i -g @antfu/ni`
pnpm i @jiaban/ui -D
yarn i @jiaban/ui -D
npm i @jiaban/ui -D
```

This library requires `unocss` with Attributify Mode and a style reset.

First, install `unocss` if you haven't already:

```shell
pnpm i -D unocss
```

Next, in your `uno.config.ts`, add `presetAttributify()` to your presets array:
```ts
import { defineConfig, presetAttributify } from 'unocss'

export default defineConfig({
  presets: [
    presetAttributify(),
    // ...your other presets
  ],
})
```

Finally, import the reset styles in your `main.ts`:
```ts
import '@unocss/reset/tailwind.css'
```

## Usage

```vue
<script setup lang="ts">
import { Button } from '@jiaban/ui'
</script>

<template>
  <Button>Click me</Button>
</template>
```

## Components

- [Animations](src/components/Animations)
- [Form](src/components/Form)

## License

[MIT](../../LICENSE)
