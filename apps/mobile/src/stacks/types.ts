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
  Status: undefined
  Imports: undefined
  ImportDetail: { importId: string }
  Unavailable: undefined
  Uploads: undefined
}

export type RootTabParamList = {
  MainTab: NavigatorScreenParams<MainStackParamList> | undefined
  MenuTab: NavigatorScreenParams<MenuStackParamList> | undefined
  ImportTab: NavigatorScreenParams<ImportStackParamList> | undefined
}

// The container root: the tab UI plus the status sheet, presentable from any
// tab. The sheet is one modal stack (Status at the root, imports nested
// inside) so every entry point lands in the same presentation and back always
// walks up to Status; dismissing returns to wherever the user was.
export type RootStackParamList = {
  Tabs: NavigatorScreenParams<RootTabParamList> | undefined
  StatusSheet: NavigatorScreenParams<ImportsStackParamList> | undefined
}
