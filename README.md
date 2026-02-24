# Sia Storage

Private, encrypted cloud storage powered by the [Sia](https://sia.tech) decentralized network.

## Repo structure

Monorepo managed with [bun workspaces](https://bun.sh/docs/install/workspaces).

```
apps/
  mobile/       React Native + Expo (iOS & Android)
  web/          Vite + React (browser)

packages/
  core/         Shared database, config, adapters, utilities
  logger/       Structured logging
```

## Development

```bash
bun install

# Mobile
bun run mobile:start             # Expo dev server
bun run mobile:dev:ios:simulator  # iOS simulator
bun run mobile:dev:android:device # Android device

# Web
bun run web:dev                   # Vite dev server

# Checks
bun run lint
bun run typecheck
bun run test
```
