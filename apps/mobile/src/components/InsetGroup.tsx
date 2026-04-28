import Clipboard from '@react-native-clipboard/clipboard'
import type React from 'react'
import { Children, Fragment, useCallback } from 'react'
import {
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native'
import { useToast } from '../lib/toastContext'
import { colors, palette } from '../styles/colors'

type SectionProps = {
  header?: string
  footer?: string
  children: React.ReactNode
}

export function InsetGroupSection({ header, footer, children }: SectionProps) {
  const items = Children.toArray(children).filter(Boolean)
  return (
    <View style={styles.section}>
      {header ? (
        <View style={styles.headerRow}>
          <Text style={styles.header}>{header.toUpperCase()}</Text>
        </View>
      ) : null}
      <View style={styles.card}>
        {items.map((child, index) => (
          <Fragment key={index}>
            {index > 0 ? <View style={styles.divider} /> : null}
            {child}
          </Fragment>
        ))}
      </View>
      {footer ? <Text style={styles.footer}>{footer}</Text> : null}
    </View>
  )
}

type LinkProps = {
  label: string
  onPress: () => void
  destructive?: boolean
  disabled?: boolean
  value?: string
  trailing?: React.ReactNode
  description?: string
  accessibilityLabel?: string
  /**
   * Whether to render the trailing chevron. iOS convention: show it only for
   * rows that navigate to a sub-screen; omit for external URLs, sheet/alert
   * openers, and one-shot actions. Defaults to true for back-compat; call
   * sites should pass `false` for non-navigating rows.
   */
  showChevron?: boolean
}

export function InsetGroupLink({
  label,
  onPress,
  destructive,
  disabled,
  value,
  trailing,
  description,
  accessibilityLabel,
  showChevron = true,
}: LinkProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      disabled={disabled}
      android_ripple={{ color: palette.gray[700] }}
      style={({ pressed }) => [
        styles.row,
        pressed && !disabled ? styles.rowPressed : null,
        disabled ? styles.rowDisabled : null,
      ]}
    >
      <View style={styles.labelCol}>
        <Text
          numberOfLines={1}
          style={[styles.label, destructive ? styles.labelDestructive : null]}
        >
          {label}
        </Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>
      {value ? (
        <Text numberOfLines={1} style={styles.value}>
          {value}
        </Text>
      ) : null}
      {trailing ?? (showChevron ? <Text style={styles.chevron}>›</Text> : null)}
    </Pressable>
  )
}

type ValueRowProps = {
  label: string
  value?: string
  valueSlot?: React.ReactNode
  mono?: boolean
  description?: string
}

export function InsetGroupValueRow({ label, value, valueSlot, mono, description }: ValueRowProps) {
  return (
    <View style={styles.row}>
      <View style={styles.labelCol}>
        <Text numberOfLines={1} style={styles.label}>
          {label}
        </Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>
      {valueSlot ??
        (value ? (
          <Text numberOfLines={1} style={[styles.value, mono ? styles.valueMono : null]}>
            {value}
          </Text>
        ) : null)}
    </View>
  )
}

type ToggleRowProps = {
  label: string
  value: boolean
  onValueChange: (v: boolean) => void
  description?: string
  disabled?: boolean
}

export function InsetGroupToggleRow({
  label,
  value,
  onValueChange,
  description,
  disabled,
}: ToggleRowProps) {
  return (
    <View style={styles.row}>
      <View style={styles.labelCol}>
        <Text style={styles.label}>{label}</Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onValueChange} disabled={disabled} />
    </View>
  )
}

type InputRowProps = {
  label: string
  description?: string
} & Pick<
  TextInputProps,
  | 'value'
  | 'defaultValue'
  | 'onChangeText'
  | 'onBlur'
  | 'onFocus'
  | 'placeholder'
  | 'keyboardType'
  | 'autoCapitalize'
  | 'autoCorrect'
  | 'editable'
  | 'secureTextEntry'
>

export function InsetGroupInputRow({ label, description, ...inputProps }: InputRowProps) {
  return (
    <View style={styles.row}>
      <View style={styles.inputLabelCol}>
        <Text numberOfLines={1} style={styles.label}>
          {label}
        </Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>
      <TextInput
        {...inputProps}
        numberOfLines={1}
        placeholderTextColor={palette.gray[500]}
        style={styles.input}
      />
    </View>
  )
}

type CopyRowProps = {
  label: string
  value: string
  accessibilityLabel?: string
  truncateHead?: number
  truncateTail?: number
}

export function InsetGroupCopyRow({
  label,
  value,
  accessibilityLabel,
  truncateHead = 6,
  truncateTail = 6,
}: CopyRowProps) {
  const toast = useToast()
  const handleCopy = useCallback(() => {
    Clipboard.setString(value)
    toast.show(`Copied ${label.toLowerCase()}`)
  }, [label, toast, value])
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `Copy ${label.toLowerCase()}`}
      onPress={handleCopy}
      android_ripple={{ color: palette.gray[700] }}
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
    >
      <View style={styles.labelCol}>
        <Text style={styles.label}>{label}</Text>
      </View>
      <Text style={[styles.value, styles.valueMono]}>
        {truncateMiddle(value, truncateHead, truncateTail)}
      </Text>
    </Pressable>
  )
}

function truncateMiddle(value: string, head: number, tail: number): string {
  if (value.length <= head + tail + 3) return value
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 28,
    paddingHorizontal: 16,
  },
  headerRow: {
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  header: {
    color: palette.gray[400],
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0.4,
  },
  footer: {
    color: palette.gray[400],
    fontSize: 13,
    paddingHorizontal: 16,
    paddingTop: 6,
  },
  card: {
    backgroundColor: colors.bgPanel,
    borderRadius: 10,
    overflow: 'hidden',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle,
    marginLeft: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    minHeight: 44,
    paddingVertical: 11,
  },
  rowPressed: {
    backgroundColor: palette.gray[800],
  },
  rowDisabled: {
    opacity: 0.4,
  },
  labelCol: {
    flex: 1,
    flexShrink: 1,
    marginRight: 12,
  },
  inputLabelCol: {
    maxWidth: 96,
    flexShrink: 1,
    marginRight: 12,
  },
  label: {
    color: palette.gray[100],
    fontSize: 16,
  },
  labelDestructive: {
    color: colors.textDanger,
  },
  description: {
    color: palette.gray[400],
    fontSize: 13,
    marginTop: 2,
  },
  value: {
    color: palette.gray[400],
    fontSize: 15,
    flexShrink: 0,
  },
  valueMono: {
    fontFamily: 'Menlo',
  },
  chevron: {
    color: palette.gray[500],
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 8,
  },
  input: {
    flex: 1,
    color: palette.gray[100],
    fontSize: 16,
    textAlign: 'right',
    paddingVertical: 0,
    marginLeft: 12,
  },
})
