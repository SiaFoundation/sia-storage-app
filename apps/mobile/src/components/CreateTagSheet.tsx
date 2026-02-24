import { TagIcon } from 'lucide-react-native'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { closeSheet, useSheetOpen } from '../stores/sheets'
import { createTag } from '../stores/tags'
import { overlay, palette, whiteA } from '../styles/colors'
import { ModalSheet } from './ModalSheet'

export function CreateTagSheet() {
  const isOpen = useSheetOpen('createTag')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef<TextInput | null>(null)

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 400)
    } else {
      setName('')
      setError('')
    }
  }, [isOpen])

  const handleClose = useCallback(() => {
    setName('')
    setError('')
    Keyboard.dismiss()
    closeSheet()
  }, [])

  const handleCreate = useCallback(async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      await createTag(trimmed)
      setName('')
      setError('')
      closeSheet()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create tag')
    }
  }, [name])

  return (
    <ModalSheet
      visible={isOpen}
      onRequestClose={handleClose}
      title="Create Tag"
      presentationStyle="formSheet"
      headerRight={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          onPress={handleClose}
          hitSlop={8}
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      }
    >
      <View style={styles.body}>
        <View style={styles.inputContainer}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder="Tag name"
            placeholderTextColor={palette.gray[500]}
            value={name}
            onChangeText={(text) => {
              setName(text)
              setError('')
            }}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={handleCreate}
          />
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable
          accessibilityRole="button"
          onPress={handleCreate}
          disabled={!name.trim()}
          style={[
            styles.createButton,
            !name.trim() && styles.createButtonDisabled,
          ]}
        >
          <TagIcon size={18} color={palette.gray[50]} />
          <Text style={styles.createButtonText}>Create</Text>
        </Pressable>
      </View>
    </ModalSheet>
  )
}

const styles = StyleSheet.create({
  cancelText: {
    color: palette.blue[400],
    fontSize: 17,
    fontWeight: '600',
  },
  body: {
    paddingHorizontal: 16,
  },
  inputContainer: {
    backgroundColor: overlay.panelMedium,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: whiteA.a10,
    marginBottom: 12,
  },
  input: {
    color: palette.gray[50],
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  error: {
    color: palette.red[500],
    fontSize: 13,
    marginBottom: 8,
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: palette.blue[500],
    borderRadius: 10,
    paddingVertical: 14,
  },
  createButtonDisabled: {
    opacity: 0.4,
  },
  createButtonText: {
    color: palette.gray[50],
    fontSize: 16,
    fontWeight: '600',
  },
})
