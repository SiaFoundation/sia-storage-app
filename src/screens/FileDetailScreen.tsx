import { FileDetails } from '../components/FileDetails'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type MainStackParamList } from '../stacks/types'
import { useFileDetails } from '../stores/files'
import { FileActionsSheet } from '../components/FileActionsSheet'

type Props = NativeStackScreenProps<MainStackParamList, 'FileDetail'>

export function FileDetailScreen({ route, navigation }: Props) {
  const { data: file } = useFileDetails(route.params.id)
  return (
    <>
      {file && <FileDetails file={file} />}
      <FileActionsSheet route={route} navigation={navigation} />
    </>
  )
}
