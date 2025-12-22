import { type NavigatorScreenParams } from '@react-navigation/native'

export type MainStackParamList = {
  LibraryHome: { openFileId?: string } | undefined
}

export type SwitchIndexerStackParamList = {
  SwitchIndexer: undefined
  SwitchRecoveryPhrase: { indexerURL: string }
  SwitchFinished: { indexerURL: string }
}

export type SettingsStackParamList = {
  SettingsHome: undefined
  Hosts: undefined
  HostDetail: { publicKey: string }
  Indexer: undefined
  SwitchIndexer: NavigatorScreenParams<SwitchIndexerStackParamList> | undefined
  Sync: undefined
  Logs: undefined
  Advanced: undefined
  Debug: undefined
}

export type OnboardingStackParamList = {
  Welcome: undefined
  ChooseIndexer: undefined
  RecoveryPhrase: { indexerURL: string }
  FinishedOnboarding: { indexerURL: string }
}

export type ImportStackParamList = {
  ImportFile: { shareUrl: string; id: string }
}

export type RootTabParamList = {
  MainTab: NavigatorScreenParams<MainStackParamList> | undefined
  SettingsTab: NavigatorScreenParams<SettingsStackParamList> | undefined
  ImportTab: NavigatorScreenParams<ImportStackParamList> | undefined
}
