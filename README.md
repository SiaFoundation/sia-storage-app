# Sia Storage

Private, encrypted cloud storage powered by the [Sia](https://sia.tech) decentralized network.

## Apps

| App | Stack | Description |
|-----|-------|-------------|
| [`apps/mobile`](apps/mobile) | React Native + Expo | iOS & Android |
| [`apps/desktop`](apps/desktop) | Electron + Vite | macOS, Linux, Windows |
| [`apps/cli`](apps/cli) | Bun + Commander | macOS, Linux, Windows |

## Packages

| Package | Description |
|---------|-------------|
| [`packages/core`](packages/core) | Database, services, adapters, config |
| [`packages/logger`](packages/logger) | Structured logging |

## Development

```bash
bun install

# Mobile
bun run mobile:start
bun run mobile:dev:ios:device
bun run mobile:dev:android:device

# Checks
bun run lint
bun run typecheck
bun run test
```
