import { useMemo } from 'react'
import { View, Text, StyleSheet, Clipboard } from 'react-native'
import { type FileRecord } from '../../db/files'
import { FileStatus } from '../../lib/file'
import { useToast } from '../../lib/toastContext'

export function FileMeta({
  file,
  status,
}: {
  file: FileRecord
  status: FileStatus
}) {
  const toast = useToast()
  const humanSize = useMemo(() => {
    if (file.fileSize == null) return null
    const units = ['B', 'KB', 'MB', 'GB']
    let s = file.fileSize
    let u = 0
    while (s >= 1024 && u < units.length - 1) {
      s /= 1024
      u += 1
    }
    return `${s.toFixed(1)} ${units[u]}`
  }, [file.fileSize])

  console.log('FileMeta', status.cachedUri)

  return (
    <View style={styles.container}>
      {file.fileName ? (
        <Text style={styles.photoFileName} numberOfLines={2}>
          {file.fileName}
        </Text>
      ) : null}
      <View style={styles.photoMetaRow}>
        {humanSize ? (
          <Text style={styles.photoMetaText}>{humanSize}</Text>
        ) : null}
        <View style={styles.photoDot} />
        <Text style={styles.photoMetaText}>
          {new Date(file.createdAt).toLocaleString()}
        </Text>
      </View>
      <View style={styles.separator} />
      <Text
        style={styles.sectionTitle}
        onPress={() => {
          if (!status.cachedUri) return
          Clipboard.setString(status.cachedUri)
          toast.show('Copied cached URI')
        }}
      >
        Cached URI
      </Text>
      {file.fileName ? (
        <Text style={styles.sectionValue} numberOfLines={2}>
          {status.cachedUri || 'No cached URI'}
        </Text>
      ) : null}
      <View style={styles.separator} />
      <Text style={styles.sectionTitle}>Slabs ({file.slabs?.length})</Text>
      {file.slabs?.map((s) => (
        <Text key={s.id} style={styles.sectionValue} numberOfLines={2}>
          {s.id}
        </Text>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
    backgroundColor: '#ffffff',
    borderTopColor: '#d0d7de',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  photoFileName: {
    color: '#111827',
    marginBottom: 6,
  },
  sectionTitle: {
    color: '#111827',
    fontWeight: '700',
    marginBottom: 6,
  },
  sectionValue: {
    color: '#57606a',
    fontWeight: '400',
    marginBottom: 6,
    overflow: 'hidden',
  },
  photoMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  photoMetaText: { color: '#374151', fontSize: 12 },
  photoDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#9ca3af',
  },
  photoStatus: { color: '#6b7280', fontSize: 12 },
  separator: {
    height: 1,
    backgroundColor: '#d0d7de',
    opacity: 0.2,
    marginVertical: 12,
  },
})
