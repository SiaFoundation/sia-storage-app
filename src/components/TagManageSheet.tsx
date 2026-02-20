import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { closeSheet, useSheetOpen } from '../stores/sheets'
import { removeTagFromFile, useTagsForFile } from '../stores/tags'
import { palette } from '../styles/colors'
import { ActionSheet } from './ActionSheet'
import { TagInput } from './TagInput'
import { TagPill } from './TagPill'

type TagManageSheetProps = {
  sheetName?: string
  fileId: string
}

export function TagManageSheet({
  sheetName = 'tagManage',
  fileId,
}: TagManageSheetProps) {
  const isOpen = useSheetOpen(sheetName)
  const { data: tags, mutate } = useTagsForFile(isOpen ? fileId : null)

  const existingTagIds = new Set((tags ?? []).map((t) => t.id))

  const handleRemoveTag = async (tagId: string) => {
    await removeTagFromFile(fileId, tagId)
    mutate()
  }

  const handleTagAdded = () => {
    mutate()
  }

  return (
    <ActionSheet visible={isOpen} onRequestClose={() => closeSheet()}>
      <View style={styles.container}>
        <Text style={styles.title}>Manage Tags</Text>
        {tags && tags.length > 0 && (
          <View style={styles.tagsSection}>
            <Text style={styles.sectionLabel}>Current tags</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.tagsContainer}
            >
              {tags.map((tag) => (
                <TagPill
                  key={tag.id}
                  tag={tag}
                  onRemove={() => handleRemoveTag(tag.id)}
                />
              ))}
            </ScrollView>
          </View>
        )}
        <View style={styles.inputSection}>
          <Text style={styles.sectionLabel}>Add tag</Text>
          <TagInput
            fileId={fileId}
            existingTagIds={existingTagIds}
            onTagAdded={handleTagAdded}
          />
        </View>
      </View>
    </ActionSheet>
  )
}

const styles = StyleSheet.create({
  container: {
    gap: 16,
  },
  title: {
    color: palette.gray[50],
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  tagsSection: {
    gap: 8,
  },
  sectionLabel: {
    color: palette.gray[400],
    fontSize: 12,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tagsContainer: {
    gap: 8,
    flexDirection: 'row',
  },
  inputSection: {
    gap: 8,
  },
})
