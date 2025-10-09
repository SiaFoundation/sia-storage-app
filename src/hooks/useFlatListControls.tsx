import * as React from 'react'

type Params<T> = {
  data: T[] | undefined
  size: number
  setSize: (size: number | ((_size: number) => number)) => any
  isValidating: boolean
  hasMore: boolean
}

export function useFlatListControls<T>({
  data,
  size,
  setSize,
  isValidating,
  hasMore,
}: Params<T>) {
  const isLoadingMore = !!data && isValidating && hasMore

  const handleEndReached = React.useCallback(() => {
    if (!isLoadingMore && hasMore) setSize(size + 1)
  }, [isLoadingMore, hasMore, setSize, size])

  return { isLoadingMore, handleEndReached }
}
