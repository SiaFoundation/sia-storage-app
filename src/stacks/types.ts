import { type NavigatorScreenParams } from '@react-navigation/native'

export type MainStackParamList = {
  LibraryHome: undefined
  FileDetail: { id: string }
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

export type ImportStackParamList = {
  ImportFile: { shareUrl: string; id: string }
}

export type RootTabParamList = {
  MainTab: NavigatorScreenParams<MainStackParamList> | undefined
  SettingsTab: NavigatorScreenParams<SettingsStackParamList> | undefined
  ImportTab: NavigatorScreenParams<ImportStackParamList> | undefined
}
