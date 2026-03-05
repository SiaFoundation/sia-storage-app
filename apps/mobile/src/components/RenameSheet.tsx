import { PencilIcon } from 'lucide-react-native'
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
import { overlay, palette, whiteA } from '../styles/colors'
import { ModalSheet } from './ModalSheet'

type Props = {
  sheetName: string
  title: string
  placeholder: string
  initialValue: string
  onRename: (newName: string) => Promise<void>
}

export function RenameSheet({
  sheetName,
  title,
  placeholder,
  initialValue,
  onRename,
}: Props) {
  const isOpen = useSheetOpen(sheetName)
  const [name, setName] = useState(initialValue)
  const [error, setError] = useState('')
  const inputRef = useRef<TextInput | null>(null)

  const handleShow = useCallback(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (isOpen) {
      setName(initialValue)
    } else {
      setError('')
    }
  }, [isOpen, initialValue])

  const handleClose = useCallback(() => {
    setError('')
    Keyboard.dismiss()
    closeSheet()
  }, [])

  const handleRename = useCallback(async () => {
    const trimmed = name.trim()
    if (!trimmed || trimmed === initialValue) return
    try {
      await onRename(trimmed)
      closeSheet()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rename')
    }
  }, [name, initialValue, onRename])

  const canSubmit = name.trim().length > 0 && name.trim() !== initialValue

  return (
    <ModalSheet
      visible={isOpen}
      onRequestClose={handleClose}
      onShow={handleShow}
      title={title}
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
            placeholder={placeholder}
            placeholderTextColor={palette.gray[500]}
            value={name}
            onChangeText={(text) => {
              setName(text)
              setError('')
            }}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={handleRename}
            selectTextOnFocus
          />
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable
          accessibilityRole="button"
          onPress={handleRename}
          disabled={!canSubmit}
          style={[
            styles.renameButton,
            !canSubmit && styles.renameButtonDisabled,
          ]}
        >
          <PencilIcon size={18} color={palette.gray[50]} />
          <Text style={styles.renameButtonText}>Rename</Text>
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
  renameButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: palette.blue[500],
    borderRadius: 10,
    paddingVertical: 14,
  },
  renameButtonDisabled: {
    opacity: 0.4,
  },
  renameButtonText: {
    color: palette.gray[50],
    fontSize: 16,
    fontWeight: '600',
  },
})
