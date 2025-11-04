import React, { useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { FileDetails } from '../components/FileDetails'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type MainStackParamList } from '../stacks/types'
import { useFileDetails } from '../stores/files'
import { FileActionsSheet } from '../components/FileActionsSheet'
import { palette } from '../styles/colors'
import { FileDetailScreenHeader } from '../components/FileDetailScreenHeader'
import { FileViewer } from '../components/FileViewer'
import { FileDetailsControlBar } from '../components/FileDetailsControlBar'

type Props = NativeStackScreenProps<MainStackParamList, 'FileDetail'>

export function FileDetailScreen({ route, navigation }: Props) {
  const [viewStyle, setViewStyle] = useState<'consume' | 'detail'>('consume')
  const { data: file } = useFileDetails(route.params.id)

  return (
    <View style={styles.container}>
      {file && viewStyle === 'consume' ? (
        <FileViewer
          file={file}
          header={
            <FileDetailScreenHeader
              file={file}
              title={file?.name ?? 'View'}
              navigation={navigation}
            />
          }
        />
      ) : (
        file && (
          <FileDetails
            file={file}
            header={
              <FileDetailScreenHeader
                file={file}
                title={file?.name ?? 'Details'}
                navigation={navigation}
              />
            }
          />
        )
      )}
      <FileActionsSheet
        route={route}
        navigation={navigation}
        sheetName="fileActions"
      />
      <FileDetailsControlBar
        route={route}
        viewStyle={viewStyle}
        setViewStyle={setViewStyle}
        navigation={navigation}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.gray[950], zIndex: 1 },
})
