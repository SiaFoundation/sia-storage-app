import React, { useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { FileDetails } from '../components/FileDetails'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type MainStackParamList } from '../stacks/types'
import { useFileDetails } from '../stores/files'
import { FileActionsSheet } from '../components/FileActionsSheet'
import {
  MoreVerticalIcon,
  ShareIcon,
  LinkIcon,
  FullscreenIcon,
  TextAlignStart,
} from 'lucide-react-native'
import { BottomControlBar, iconColors } from '../components/BottomControlBar'
import { palette } from '../styles/colors'
import { openSheet } from '../stores/sheets'
import { useShareAction } from '../hooks/useShareAction'
import { FileDetailScreenHeader } from '../components/FileDetailScreenHeader'
import { FileConsumer } from '../components/FileConsumer'

type Props = NativeStackScreenProps<MainStackParamList, 'FileDetail'>

export function FileDetailScreen({ route, navigation }: Props) {
  const [viewStyle, setViewStyle] = useState<'consume' | 'detail'>('consume')
  const { data: file } = useFileDetails(route.params.id)
  const { handleShareFile, handleShareURL, canShare } = useShareAction({
    fileId: route.params.id,
  })
  return (
    <View style={styles.container}>
      {file && viewStyle === 'consume' ? (
        <FileConsumer
          file={file}
          header={
            <FileDetailScreenHeader
              title={file?.fileName ?? 'View'}
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
                title={file?.fileName ?? 'Details'}
                navigation={navigation}
              />
            }
          />
        )
      )}
      <BottomControlBar
        left={[
          {
            id: 'copyLink',
            disabled: !canShare,
            icon: <LinkIcon size={22} color={iconColors.white} />,
            onPress: handleShareURL,
          },
          {
            id: 'shareMenu',
            disabled: !canShare,
            icon: <ShareIcon size={22} color={iconColors.white} />,
            onPress: handleShareFile,
          },
        ]}
        right={[
          {
            id: 'viewSwitch',
            icon:
              viewStyle === 'consume' ? (
                <TextAlignStart color={iconColors.white} />
              ) : (
                <FullscreenIcon color={iconColors.white} />
              ),
            onPress: () =>
              viewStyle === 'consume'
                ? setViewStyle('detail')
                : setViewStyle('consume'),
          },
          {
            id: 'overflow',
            icon: <MoreVerticalIcon size={22} color={iconColors.white} />,
            onPress: () => openSheet('fileActions'),
          },
        ]}
      />
      <FileActionsSheet
        route={route}
        navigation={navigation}
        sheetName="fileActions"
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.gray[950], zIndex: 1 },
})
