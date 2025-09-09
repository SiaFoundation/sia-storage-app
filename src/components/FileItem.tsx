import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import shareLink from '../functions/shareLink'

type Props = {
  id: string
  length: number
  offset: number
}

export default function FileItem({ id, length, offset }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Text>id: {id}</Text>
        <Text>length: {length}</Text>
      </View>
      <View style={styles.row}>
        <Text>offset: {offset}</Text>
        <Pressable style={styles.button}>
          <Text
            style={styles.buttonText}
            onPress={() => shareLink({ url: 'google.com' })}
          >
            Share
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    display: 'flex',
    gap: 4,

    padding: 10,

    borderColor: 'lightgray',
    borderStyle: 'solid',
    borderBottomWidth: 1,
  },
  row: {
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  button: {
    backgroundColor: '#517891',
    padding: 5,
    borderRadius: 5,
  },
  buttonText: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    fontSize: 12,
    color: '#cbd5e1',
  },
})
