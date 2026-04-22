# Sia Storage

Private, encrypted cloud storage powered by the [Sia](https://sia.tech) decentralized network. Sia Storage is a cross-platform app that works on iOS, Android, macOS, Linux, and Windows. See whats coming next in [ROADMAP.md](ROADMAP.md).

## Apps

| App                            | Platforms             | Status      |
| ------------------------------ | --------------------- | ----------- |
| [`apps/mobile`](apps/mobile)   | iOS, Android          | Beta        |
| [`apps/desktop`](apps/desktop) | macOS, Linux, Windows | Coming soon |
| [`apps/cli`](apps/cli)         | macOS, Linux, Windows | Coming soon |
| [`apps/web`](apps/web)         | Browser               | Coming soon |

## Packages

| Package                                            | Description                          |
| -------------------------------------------------- | ------------------------------------ |
| [`packages/core`](packages/core)                   | Database, services, adapters, config |
| [`packages/node-adapters`](packages/node-adapters) | Node-side adapters                   |
| [`packages/logger`](packages/logger)               | Structured logging                   |

## Development

```bash
bun install

# Mobile
bun run mobile:start
bun run mobile:dev:ios:device
bun run mobile:dev:android:device

# Test
bun run lint
bun run typecheck
bun run test
```

## License

[MIT](LICENSE) © The Sia Foundation
