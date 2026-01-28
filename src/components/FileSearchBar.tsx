import { SearchIcon, XIcon } from 'lucide-react-native'
import { useEffect, useRef, useState } from 'react'
import {
  type EmitterSubscription,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { clearSearchQuery, setSearchQuery, useLibrary } from '../stores/library'
import { palette, whiteA } from '../styles/colors'

export function FileSearchBar({ onExit }: { onExit: () => void }) {
  const { searchQuery } = useLibrary()
  const [text, setText] = useState(searchQuery ?? '')
  const inputRef = useRef<TextInput | null>(null)
  const debounced = useDebouncedValue(text, 300)

  useEffect(() => {
    setText(searchQuery ?? '')
  }, [searchQuery])

  useEffect(() => {
    setSearchQuery(debounced)
  }, [debounced])

  useEffect(() => {
    let sub: EmitterSubscription | null = null
    // Delay the subscription to avoid race conditions with the keyboard.
    const timeout = setTimeout(() => {
      const hideEvent =
        Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
      sub = Keyboard.addListener(hideEvent, () => {
        onExit()
      })
    }, 200)
    return () => {
      if (sub) sub.remove()
      clearTimeout(timeout)
    }
  }, [onExit])

  return (
    <View style={styles.wrap}>
      <View style={styles.inputRow}>
        <SearchIcon color={whiteA.a70} />
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={setText}
          placeholder="Search files"
          placeholderTextColor={whiteA.a50}
          style={styles.input}
          returnKeyType="done"
          onSubmitEditing={() => Keyboard.dismiss()}
          autoFocus
        />
        {!!text && (
          <Pressable
            onPress={() => {
              setText('')
              clearSearchQuery()
            }}
            accessibilityRole="button"
          >
            <XIcon size={16} color={whiteA.a70} />
          </Pressable>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
  },
  inputRow: {
    height: '100%',
    paddingHorizontal: 0,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  input: {
    flex: 1,
    color: palette.gray[50],
    paddingVertical: 0,
  },
})
