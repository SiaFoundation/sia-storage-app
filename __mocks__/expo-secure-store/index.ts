const store = new Map<string, string>()

export const setItemAsync = jest.fn(async (key: string, value: string) => {
  store.set(key, value)
})

export const getItemAsync = jest.fn(async (key: string) => {
  return store.has(key) ? store.get(key) ?? null : null
})

export const deleteItemAsync = jest.fn(async (key: string) => {
  store.delete(key)
})
