import { useHosts } from '@siastorage/core/stores'
import { ChevronRightIcon } from 'lucide-react-native'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { colors, palette } from '../styles/colors'
import { SWRList } from './SWRList'

export function HostsList({
  onSelectHost,
}: {
  onSelectHost: (host: string) => void
}) {
  const response = useHosts()

  return (
    <SWRList
      response={response}
      keyField="publicKey"
      noDataMessage="No hosts yet"
      errorMessage="Failed to load hosts"
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          onPress={() => onSelectHost(item.publicKey)}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        >
          <View style={styles.avatar} />
          <View style={styles.rowBody}>
            <Text style={styles.host} numberOfLines={1}>
              {item.publicKey}
            </Text>
          </View>
          <ChevronRightIcon color={palette.gray[300]} size={18} />
        </Pressable>
      )}
    />
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: colors.bgPanel,
  },
  rowPressed: {
    backgroundColor: colors.bgPanel,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentPrimary,
    marginRight: 10,
  },
  avatarText: {
    color: palette.gray[50],
    fontWeight: '700',
    fontSize: 12,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  host: {
    color: palette.gray[100],
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    fontSize: 12,
  },
})
