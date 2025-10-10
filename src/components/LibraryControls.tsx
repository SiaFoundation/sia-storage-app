import React, { useState } from 'react'
import { View, Pressable, Text, ScrollView } from 'react-native'
import {
  Grid2X2Icon,
  ListIcon,
  ArrowUp,
  ArrowDown,
  XIcon,
} from 'lucide-react-native'
import { BottomControlBar, iconColors } from './BottomControlBar'
import { FileSearchControl } from './FileSearchControl'
import { FileSearchBar } from './FileSearchBar'
import {
  clearCategories,
  toggleCategory,
  useFilesView,
  setSortCategory,
  toggleDir,
  type Category,
} from '../stores/files'
import { palette, whiteA } from '../styles/colors'
import { Pill } from './Pill'
import { toggleLibraryViewMode, useLibraryViewMode } from '../stores/settings'
import { openSheet } from '../stores/sheets'

export function LibraryControls() {
  const viewMode = useLibraryViewMode()
  const [searchActive, setSearchActive] = useState(false)
  const { selectedCategories, sortBy, sortDir } = useFilesView()

  return (
    <>
      <BottomControlBar
        keyboardAware
        overlayTop={
          searchActive ? (
            <View style={{ width: '90%', alignSelf: 'center', gap: 6 }}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{
                  paddingHorizontal: 6,
                  gap: 8,
                  alignItems: 'center',
                }}
                style={{ overflow: 'visible' }}
                bounces
              >
                <Pill onPress={() => toggleDir()}>
                  {sortDir === 'ASC' ? (
                    <ArrowUp size={14} color={palette.gray[50]} />
                  ) : (
                    <ArrowDown size={14} color={palette.gray[50]} />
                  )}
                  <Text
                    style={{
                      color: palette.gray[50],
                      fontSize: 12,
                      fontWeight: '600',
                    }}
                  >
                    {sortDir === 'ASC' ? 'Asc' : 'Desc'}
                  </Text>
                </Pill>
                <Pill
                  onPress={() => setSortCategory('DATE')}
                  selected={sortBy === 'DATE'}
                >
                  <Text
                    style={{
                      color: palette.gray[50],
                      fontSize: 12,
                      fontWeight: '600',
                    }}
                  >
                    Date
                  </Text>
                </Pill>
                <Pill
                  onPress={() => setSortCategory('NAME')}
                  selected={sortBy === 'NAME'}
                >
                  <Text
                    style={{
                      color: palette.gray[50],
                      fontSize: 12,
                      fontWeight: '600',
                    }}
                  >
                    Name
                  </Text>
                </Pill>
              </ScrollView>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{
                  paddingHorizontal: 6,
                  gap: 8,
                  alignItems: 'center',
                }}
                style={{ overflow: 'visible' }}
                bounces
              >
                {(['Video', 'Image', 'Audio', 'Files'] as Category[]).map(
                  (cat) => {
                    const selected = selectedCategories.has(cat)
                    return (
                      <Pill
                        key={cat}
                        onPress={() => toggleCategory(cat)}
                        selected={selected}
                      >
                        <Text
                          style={{
                            color: palette.gray[50],
                            fontSize: 12,
                            fontWeight: '600',
                          }}
                        >
                          {cat}
                        </Text>
                      </Pill>
                    )
                  }
                )}
                {!!selectedCategories.size && (
                  <Pill onPress={clearCategories}>
                    <XIcon size={14} color={whiteA.a70} />
                  </Pill>
                )}
              </ScrollView>
            </View>
          ) : null
        }
        content={
          searchActive ? (
            <FileSearchBar onExit={() => setSearchActive(false)} />
          ) : (
            <View
              style={{
                flex: 1,
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <Pressable
                  accessibilityRole="button"
                  onPress={toggleLibraryViewMode}
                >
                  {viewMode.data === 'gallery' ? (
                    <Grid2X2Icon size={18} color={iconColors.active} />
                  ) : (
                    <ListIcon size={18} color={iconColors.active} />
                  )}
                </Pressable>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => openSheet('addFile')}
              >
                <Text style={{ color: palette.gray[50], fontSize: 22 }}>+</Text>
              </Pressable>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setSearchActive((s) => !s)}
                >
                  <FileSearchControl
                    onOpen={() => setSearchActive((s) => !s)}
                  />
                </Pressable>
              </View>
            </View>
          )
        }
      />
    </>
  )
}
