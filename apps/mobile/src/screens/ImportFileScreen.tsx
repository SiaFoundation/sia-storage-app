import { type NavigationProp, useNavigation } from '@react-navigation/native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { StyleSheet, View } from 'react-native'
import { FileCarouselHeader } from '../components/FileCarousel/FileCarouselHeader'
import { FileImport } from '../components/FileImport'
import type { ImportStackParamList, RootTabParamList } from '../stacks/types'
import { colors } from '../styles/colors'

type Props = NativeStackScreenProps<ImportStackParamList, 'ImportFile'>

export function ImportFileScreen({ route }: Props) {
  const navigation = useNavigation<NavigationProp<RootTabParamList>>()
  const id = route.params.id
  const shareUrl = route.params.shareUrl

  return (
    <View style={styles.container}>
      <FileCarouselHeader
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
