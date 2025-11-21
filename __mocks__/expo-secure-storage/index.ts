const store = new Map()
export default {
  setItem: jest.fn(async (key: string, value: string) => {
    store.set(key, value)
  }),
  getItem: jest.fn(async (key: string) => {
    return store.has(key) ? store.get(key) : null
  }),
}
