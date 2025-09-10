import { useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  Image,
  StyleSheet,
  Dimensions,
  ScrollView,
  Platform,
} from 'react-native'
import { type UploadedItem } from '../Upload'
import PhotoStatusBadge from './PhotoStatusBadge'
import MapView, { Marker } from 'react-native-maps'

export function PhotoDetail({ item }: { item: UploadedItem }) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null
  )

  const screen = Dimensions.get('window')
  const screenWidth = screen.width

  // Ensure the map can display the full world width by enforcing an aspect ratio ~2.1:1.
  const worldMapHeight = useMemo(() => {
    const horizontalPadding = 32 // Left + right padding in `mapSection`.
    const availableWidth = Math.max(0, screenWidth - horizontalPadding)
    const aspectRatio = 2.1
    const calculatedHeight = Math.round(availableWidth / aspectRatio)
    return Math.max(160, calculatedHeight)
  }, [screenWidth])

  useEffect(() => {
    let mounted = true
    if (item.uri) {
      Image.getSize(
        item.uri,
        (w, h) => {
          if (mounted) setSize({ width: w, height: h })
        },
        () => {
          if (mounted) setSize(null)
        }
      )
    }
    return () => {
      mounted = false
    }
  }, [item.uri])

  const imageHeight = useMemo(() => {
    if (!size) return screenWidth
    const h = (screenWidth * size.height) / Math.max(1, size.width)
    return Math.max(240, Math.round(h))
  }, [size, screenWidth])

  const humanSize = useMemo(() => {
    if (item.fileSize == null) return null
    const units = ['B', 'KB', 'MB', 'GB']
    let s = item.fileSize
    let u = 0
    while (s >= 1024 && u < units.length - 1) {
      s /= 1024
      u += 1
    }
    return `${s.toFixed(1)} ${units[u]}`
  }, [item.fileSize])

  const pins = useMemo(() => {
    return Array.from({ length: 30 }, (_, i) => {
      // Keep within typical visible bounds and avoid extreme poles.
      const latitude = -80 + Math.random() * 160 // [-80, 80]
      const longitude = -180 + Math.random() * 360 // [-180, 180]
      return { id: `pin-${i}`, latitude, longitude }
    })
  }, [])

  return (
    <View style={styles.photoScreen}>
      <ScrollView
        style={styles.photoScroll}
        contentContainerStyle={styles.photoScrollContent}
        showsVerticalScrollIndicator
      >
        <View style={[styles.photoContainer, { height: imageHeight }]}>
          <ScrollView
            style={styles.photoZoom}
            contentContainerStyle={styles.photoZoomContent}
            maximumZoomScale={4}
            minimumZoomScale={1}
            bouncesZoom
            centerContent
          >
            <Image
              source={{ uri: item.uri }}
              style={styles.photoImage}
              resizeMode="cover"
            />
          </ScrollView>
          <PhotoStatusBadge status={item.status} />
        </View>

        <View style={styles.photoMetaSection}>
          {item.fileName ? (
            <Text style={styles.photoFileName} numberOfLines={2}>
              {item.fileName}
            </Text>
          ) : null}
          <View style={styles.photoMetaRow}>
            {humanSize ? (
              <Text style={styles.photoMetaText}>{humanSize}</Text>
            ) : null}
            <View style={styles.photoDot} />
            <Text style={styles.photoMetaText}>
              {new Date(item.createdAt).toLocaleString()}
            </Text>
          </View>
        </View>

        <View style={[styles.mapSection, { height: worldMapHeight }]}>
          <MapView
            style={styles.map}
            mapType={Platform.OS === 'ios' ? 'mutedStandard' : 'standard'}
            showsCompass={false}
            showsScale={false}
            showsIndoors={false}
            showsTraffic={false}
            zoomEnabled={false}
            rotateEnabled={false}
            pitchEnabled={false}
            scrollEnabled={false}
            toolbarEnabled={false}
          >
            {pins.map((p) => (
              <Marker
                key={p.id}
                coordinate={{ latitude: p.latitude, longitude: p.longitude }}
              />
            ))}
          </MapView>
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  photoScreen: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  photoScroll: { flex: 1 },
  photoScrollContent: { paddingBottom: 16 },
  photoContainer: {
    width: '100%',
    backgroundColor: '#ffffff',
  },
  photoZoom: { flex: 1 },
  photoZoomContent: { flexGrow: 1, justifyContent: 'center' },
  photoImage: { width: '100%', height: '100%' },
  photoMetaSection: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
    backgroundColor: '#ffffff',
    borderTopColor: '#d0d7de',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  photoFileName: {
    color: '#111827',
    fontWeight: '700',
    marginBottom: 6,
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
  mapSection: {
    height: 280,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    backgroundColor: '#ffffff',
  },
  map: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },
})

export default PhotoDetail
