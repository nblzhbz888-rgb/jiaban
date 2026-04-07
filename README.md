# Jiaban

Jiaban is an independent desktop workspace maintained by 梁宗靖 for managing Claude Code and Codex sessions in one place.

## What this repository contains

- `apps/desktop`: the Electron desktop application.
- `packages/*`: shared runtime, protocol, UI, i18n, and Electron helper packages used by the desktop app.
- `start.command`: macOS startup script.
- `start.bat`: Windows startup script.

## Development

```bash
pnpm install
pnpm dev
```

## Startup scripts

- macOS: run `start.command`
- Windows: run `start.bat`

## Build

```bash
pnpm --dir apps/desktop build
```

## Author

梁宗靖

## Legal

- Current project identity and ongoing development: [`COPYRIGHT.md`](./COPYRIGHT.md)
- Third-party notices retained for bundled or inherited open-source parts: [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)
