import { defineScenario } from '../../src/scenario'

export default defineScenario({
  name: "the phone app's database runs in WAL mode",
  description:
    "A freshly installed phone app opens its database and adds a file. SQLite reports the database's journal mode as WAL, in which readers on other connections run beside the writer and a commit is rarely mid-fsync when iOS suspends the app.",
  devices: { phone: 'phone' },
  knownBug:
    'The journal mode is a developer toggle under Advanced, off by default, so the app opens its database with the rollback journal.',
  bugShowsAs: ['the journal mode is WAL'],
  async run({ devices: { phone }, seed, step, checkEqual }) {
    await step('phone adds a file', () => seed('phone', { count: 1, size: 1024 }))
    const [row] = await phone.sql<{ journal_mode: string }>('PRAGMA journal_mode')
    checkEqual('the journal mode is WAL', row?.journal_mode, 'wal')
  },
})
