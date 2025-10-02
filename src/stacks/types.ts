export type MainStackParamList = {
  Home: undefined
  FileDetail: { id: string }
  ImportFile: { shareUrl?: string }
}

export type SettingsStackParamList = {
  SettingsHome: undefined
  Hosts: undefined
  HostDetail: { publicKey: string }
  Indexer: undefined
  Sync: undefined
  Logs: undefined
  Advanced: undefined
}

export type AuthStackParamList = {
  Connect: undefined
}

export type RootTabParamList = {
  MainTab: undefined
  SettingsTab: undefined
  LogsTab: undefined
}
