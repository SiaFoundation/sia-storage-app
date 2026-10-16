import { act, render } from '@testing-library/react-native'
import { FlatList } from 'react-native'
import { FileGallery } from './FileGallery'

// The shared setup replaces react-native with a stub that has no components.
jest.unmock('react-native')
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))
jest.mock('@siastorage/core/stores', () => ({
  useFileList: () => ({
    data: Array.from({ length: 1000 }, (_, i) => ({ id: `file-${i}` })),
    size: 1,
    setSize: jest.fn(),
    isValidating: false,
    hasMore: false,
  }),
}))
jest.mock('../hooks/useFlatListControls', () => ({
  useFlatListControls: () => ({ isLoadingMore: false, handleEndReached: jest.fn() }),
}))
jest.mock('./FileGalleryItem', () => ({ FileGalleryItem: () => null }))

describe('FileGallery', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('a scroll retry pending when the column count changes is not sent to the new list', async () => {
    const scrollToIndex = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation()
    jest.spyOn(FlatList.prototype, 'scrollToOffset').mockImplementation()
    const renderList = FlatList.prototype.render
    let list!: FlatList
    jest.spyOn(FlatList.prototype, 'render').mockImplementation(function (this: FlatList) {
      list = this
      return renderList.call(this)
    })
    await render(<FileGallery filters={{} as never} onPressItem={jest.fn()} />)
    const layout = (width: number) =>
      act(async () => {
        list.props.onLayout?.({
          nativeEvent: { layout: { width, height: 800, x: 0, y: 0 } },
        } as never)
      })
    await layout(402)
    expect(list.props.numColumns).toBe(3)

    // Row 300 of the three-column list, which the five-column list does not have.
    await act(async () => {
      list.props.onScrollToIndexFailed?.({
        index: 300,
        averageItemLength: 130,
        highestMeasuredFrameIndex: 0,
      })
    })
    const threeColumns = list
    await layout(669)
    expect(list).not.toBe(threeColumns)
    expect(list.props.numColumns).toBe(5)
    await act(async () => jest.advanceTimersByTime(100))

    expect(scrollToIndex).not.toHaveBeenCalledWith({ index: 300, animated: false })
  })
})
