import type { NavigatorScreenParams } from '@react-navigation/native'

export type MainStackParamList = {
  LibraryHome: { openFileId?: string } | undefined
  TagLibrary: { tagId: string; tagName: string }
  DirectoryScreen: { directoryId: string; directoryName: string }
  Search: undefined
}

export type SwitchIndexerStackParamList = {
  SwitchIndexer: undefined
  SwitchRecoveryPhrase: { indexerURL: string }
  SwitchFinished: { indexerURL: string }
}

export type MenuStackParamList = {
  MenuHome: undefined
  Hosts: undefined
  HostDetail: { publicKey: string }
  Indexer: undefined
  SwitchIndexer: NavigatorScreenParams<SwitchIndexerStackParamList> | undefined
  Sync: undefined
  Logs: undefined
  Advanced: undefined
  LearnRecoveryPhrase: undefined
  LearnHowItWorks: undefined
  LearnIndexer: undefined
  LearnSiaNetwork: undefined
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
  MenuTab: NavigatorScreenParams<MenuStackParamList> | undefined
  ImportTab: NavigatorScreenParams<ImportStackParamList> | undefined
}
