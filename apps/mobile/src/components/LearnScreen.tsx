import type React from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, palette } from '../styles/colors'
import BlocksGrid from './BlocksGrid'

const BACKGROUND_OPACITY = 0.08

type LearnScreenProps = {
  children: React.ReactNode
}

export function LearnScreen({ children }: LearnScreenProps) {
  const { bottom } = useSafeAreaInsets()

  return (
    <View style={styles.container}>
      <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
        <BlocksGrid
          cols={5}
          rows={12}
          tileScale={0.15}
          animation="none"
          style={{ flex: 1 }}
          opacity={BACKGROUND_OPACITY}
        />
      </View>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottom + 24 }]}
      >
        {children}
      </ScrollView>
    </View>
  )
}

type LearnSectionProps = {
  title: string
  children: React.ReactNode
}

export function LearnSection({ title, children }: LearnSectionProps) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  )
}

type LearnTextProps = {
  children: React.ReactNode
}

export function LearnText({ children }: LearnTextProps) {
  return <Text style={styles.text}>{children}</Text>
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgCanvas,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    color: palette.gray[50],
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  text: {
    color: palette.gray[200],
    fontSize: 16,
    lineHeight: 24,
  },
})
