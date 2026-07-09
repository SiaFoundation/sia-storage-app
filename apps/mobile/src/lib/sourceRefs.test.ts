import { releaseGrant } from 'import-sources'
import { SourceRefs } from './sourceRefs'

describe('SourceRefs wrapper', () => {
  it('releaseGrant swallows and logs a native throw (best-effort by contract)', async () => {
    jest.mocked(releaseGrant).mockRejectedValueOnce(new Error('boom'))
    await expect(SourceRefs.releaseGrant('android-uri:x')).resolves.toBeUndefined()
  })
})
