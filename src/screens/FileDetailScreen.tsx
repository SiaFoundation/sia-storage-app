import { FileDetails } from '../components/FileDetails'
import { type NativeStackScreenProps } from '@react-navigation/native-stack'
import { type FeedStackParamList } from '../navigation/types'
import { useFileDetails } from '../lib/filesContext'
import { FileActionsSheet } from '../components/FileActionsSheet'

type Props = NativeStackScreenProps<FeedStackParamList, 'FileDetail'>

export default function FileDetailScreen({ route, navigation }: Props) {
  const { data: file } = useFileDetails(route.params.id)
  return (
    <>
      {file && <FileDetails file={file} />}
      <FileActionsSheet route={route} navigation={navigation} />
    </>
  )
}
