import { View, Text, StyleSheet, StyleProp, ViewStyle } from 'react-native'
import { palette } from '../styles/colors'

export function GroupTitle({
  title,
  indicator,
}: {
  title: string
  indicator?: React.ReactNode
}) {
  return (
    <View style={styles.titleContainer}>
      <Text style={styles.title}>{title}</Text>
      {indicator}
    </View>
  )
}

export function RowGroup({
  title,
  children,
  indicator,
  style,
}: {
  children: React.ReactNode
  title: string
  indicator?: React.ReactNode
  style?: StyleProp<ViewStyle>
}) {
  return (
    <View style={style}>
      <GroupTitle title={title} indicator={indicator} />
      <View style={styles.containerContent}>{children}</View>
    </View>
  )
}

export function SubGroupTitle({ title }: { title: string }) {
  return <Text style={styles.subtitle}>{title}</Text>
}

export function RowSubGroup({
  title,
  children,
  style,
}: {
  children: React.ReactNode
  title: string
  style?: StyleProp<ViewStyle>
}) {
  return (
    <View style={style}>
      <SubGroupTitle title={title} />
      <View style={styles.containerContent}>{children}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  containerContent: {
    marginTop: 4,
    borderRadius: 12,
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  title: {
    color: palette.gray[50],
    fontWeight: '700',
    fontSize: 16,
  },
  subtitle: {
    color: palette.gray[50],
    fontWeight: '600',
    marginBottom: 6,
  },
})
