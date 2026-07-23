import type { NavigatorScreenParams } from '@react-navigation/native'

export type MainStackParamList = {
  LibraryHome: { openFileId?: string } | undefined
  TagLibrary: { tagId: string; tagName: string }
  DirectoryScreen: {
    directoryId: string
    directoryName: string
    directoryPath: string
  }
  Search: undefined
}

export type SwitchIndexerStackParamList = {
  SwitchIndexerHome: undefined
  SwitchRecoveryPhrase: { indexerURL: string }
  SwitchFinished: { indexerURL: string }
}

export type MenuStackParamList = {
  MenuHome: undefined
  SwitchIndexer: NavigatorScreenParams<SwitchIndexerStackParamList> | undefined
  Logs: undefined
  Advanced: undefined
  LearnRecoveryPhrase: undefined
  LearnHowItWorks: undefined
  LearnIndexer: undefined
  LearnSiaNetwork: undefined
}

export type OnboardingStackParamList = {
  Welcome: undefined
  AdvancedIndexer: undefined
  RecoveryPhrase: { indexerURL: string }
}

export type ImportStackParamList = {
  ImportFile: { shareUrl: string; id: string }
}

export type ImportsStackParamList = {
  Imports: undefined
  ImportDetail: { importId: string }
}

export type RootTabParamList = {
  MainTab: NavigatorScreenParams<MainStackParamList> | undefined
  MenuTab: NavigatorScreenParams<MenuStackParamList> | undefined
  ImportTab: NavigatorScreenParams<ImportStackParamList> | undefined
}

// The container root: the tab UI plus modal flows presentable from any tab.
// Imports live here (not in the settings stack) because their common entry is
// the library status sheet; a modal returns to wherever the user was instead
// of unwinding through Settings.
export type RootStackParamList = {
  Tabs: NavigatorScreenParams<RootTabParamList> | undefined
  ImportsModal: NavigatorScreenParams<ImportsStackParamList> | undefined
}
