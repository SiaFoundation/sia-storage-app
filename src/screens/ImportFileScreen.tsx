import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { useNavigation, type NavigationProp } from '@react-navigation/native'
import React from 'react'
import { StyleSheet, View } from 'react-native'
import {
  type ImportStackParamList,
  type RootTabParamList,
} from '../stacks/types'
import { FileDetailScreenHeader } from '../components/FileDetailScreenHeader'
import { colors } from '../styles/colors'
import { convertSiaShareUrlToHttp } from '../lib/shareUrl'
import { FileImport } from '../components/FileImport'

type Props = NativeStackScreenProps<ImportStackParamList, 'ImportFile'>

export function ImportFileScreen({ route }: Props) {
  const navigation = useNavigation<NavigationProp<RootTabParamList>>()
  const id = route.params.id
  const shareUrl = convertSiaShareUrlToHttp(route.params.shareUrl)

  return (
    <View style={styles.container}>
      <FileDetailScreenHeader
        title="Import File"
        navigation={navigation}
        icon="close"
      />
      {id && shareUrl && (
        <FileImport
          key={`${id}-${shareUrl}`}
          id={id}
          shareUrl={shareUrl}
          navigation={navigation}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgCanvas,
  },
})
