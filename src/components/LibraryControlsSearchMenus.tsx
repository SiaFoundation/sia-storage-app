import React from 'react'
import { View, Text, ScrollView } from 'react-native'
import { ArrowUp, ArrowDown, XIcon } from 'lucide-react-native'
import {
  clearCategories,
  toggleCategory,
  useLibrary,
  setSortCategory,
  toggleDir,
  categories,
} from '../stores/library'
import { palette, whiteA } from '../styles/colors'
import { Pill } from './Pill'

export function LibraryControlsSearchMenus() {
  const { selectedCategories, sortBy, sortDir } = useLibrary()

  return (
    <View style={{ width: '90%', alignSelf: 'center', gap: 6 }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 12,
          gap: 8,
          alignItems: 'center',
        }}
        style={{ overflow: 'visible' }}
        bounces
        keyboardShouldPersistTaps="always"
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
          paddingHorizontal: 12,
          gap: 8,
          alignItems: 'center',
        }}
        style={{ overflow: 'visible' }}
        bounces
        keyboardShouldPersistTaps="always"
      >
        {categories.map((cat) => {
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
        })}
        {!!selectedCategories.size && (
          <Pill onPress={clearCategories}>
            <XIcon size={14} color={whiteA.a70} />
          </Pill>
        )}
      </ScrollView>
    </View>
  )
}
