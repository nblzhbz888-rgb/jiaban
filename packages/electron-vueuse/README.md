# @jiaban/electron-vueuse

VueUse-like composables and helpers shared across Jiaban Electron apps.

## What it provides

- Renderer composables for common Electron behaviors (`mouse`, `window bounds`, `auto updater`, etc.)
- A reusable Eventa context/invoke pattern (`useElectronEventaContext`, `useElectronEventaInvoke`)
- Eventa context/invoke ergonomics for renderer code
- Main-process loop utilities (`useLoop`, `createRendererLoop`)

For IPC contract definitions, use `@jiaban/electron-eventa`.

## Usage

```ts
import { electron } from '@jiaban/electron-eventa'
import { useElectronEventaInvoke } from '@jiaban/electron-vueuse'

const openSettings = useElectronEventaInvoke(electron.window.getBounds)
```

```ts
import { createRendererLoop } from '@jiaban/electron-vueuse/main'
```
