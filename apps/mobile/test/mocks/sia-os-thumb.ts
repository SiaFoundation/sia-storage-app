// Shared via jest.config moduleNameMapper. Defaults to returning null so
// production-shaped tests fall through to `resizeToWebP`; targeted unit
// tests override the implementation via `jest.mocked(getOsThumbnail)`.
export const getOsThumbnail = jest.fn<Promise<unknown>, [string, number]>(async () => null)
