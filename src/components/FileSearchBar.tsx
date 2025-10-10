import React, { useEffect, useRef, useState } from 'react'
import {
  View,
  TextInput,
  Pressable,
  Text,
  StyleSheet,
  Keyboard,
} from 'react-native'
import { SearchIcon, XIcon } from 'lucide-react-native'
import { palette, whiteA } from '../styles/colors'
import { clearSearchQuery, setSearchQuery, useFilesView } from '../stores/files'
import { useDebouncedValue } from '../hooks/useDebouncedValue'

export function FileSearchBar({
  onExit,
}: {
  onExit?: () => void
}): React.ReactElement {
  const { searchQuery } = useFilesView()
  const [text, setText] = useState(searchQuery ?? '')
  const inputRef = useRef<TextInput | null>(null)
  const debounced = useDebouncedValue(text, 300)

  useEffect(() => {
    setText(searchQuery ?? '')
  }, [searchQuery])

  useEffect(() => {
    setSearchQuery(debounced)
  }, [debounced])

  return (
    <View style={styles.wrap}>
      <View style={styles.inputRow}>
        <SearchIcon size={18} color={whiteA.a70} />
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={setText}
          onBlur={() => {
            if ((text ?? '').trim().length === 0) {
              onExit?.()
            }
          }}
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
