/**
 * Puts a build already uploaded to internal testing on the Play production
 * track as a full rollout and sends it for review, and reads where it is in
 * review, through the Play Developer API. With managed publishing on, an
 * approved release waits for someone to publish it from Play Console, which
 * the API has no call for.
 */

import { googleAccessToken } from './jwt'
import {
  type PlayRelease,
  type PlayReleaseSummary,
  type StoreReview,
  planGooglePlay,
  playReview,
} from './plan'

export type GooglePlaySubmission = {
  packageName: string
  version: string
  versionCode: string
  whatsNew: string
  dryRun: boolean
}

function serviceAccount(): { client_email: string; private_key: string; token_uri?: string } {
  const json = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_KEY_JSON
  if (!json) throw new Error('GOOGLE_PLAY_SERVICE_ACCOUNT_KEY_JSON is not set')
  return JSON.parse(json)
}

/** Where the production release holding `versionCode` is in review. */
export async function playReviewOf(packageName: string, versionCode: string): Promise<StoreReview> {
  const token = await googleAccessToken(serviceAccount())
  const response = await fetch(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/tracks/production/releases`,
    { headers: { authorization: `Bearer ${token}` } },
  )
  if (!response.ok) {
    throw new Error(
      `Google Play GET tracks/production/releases failed with HTTP ${response.status}`,
    )
  }
  const { releases = [] } = (await response.json()) as { releases?: PlayReleaseSummary[] }
  return playReview(releases, versionCode)
}

export async function submitToGooglePlay(s: GooglePlaySubmission): Promise<void> {
  const token = await googleAccessToken(serviceAccount())
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${s.packageName}/edits`
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!response.ok) {
      // The edit's id is left out, since workflow logs in a public repo are public.
      const shape = path.replace(/^\/[^/:]+/, '/{edit}')
      throw new Error(`Google Play ${method} edits${shape} failed with HTTP ${response.status}`)
    }
    return (response.status === 204 ? {} : await response.json()) as T
  }

  // An edit is a draft of the whole listing, and nothing changes until it is
  // committed, so every exit before the commit deletes it unchanged.
  const { id } = await call<{ id: string }>('POST', '')
  let committed = false
  try {
    const { bundles = [] } = await call<{ bundles?: { versionCode: number }[] }>(
      'GET',
      `/${id}/bundles`,
    )
    if (!bundles.some((b) => String(b.versionCode) === s.versionCode)) {
      throw new Error(`Play has no uploaded bundle with version code ${s.versionCode}`)
    }
    const { releases = [] } = await call<{ releases?: PlayRelease[] }>(
      'GET',
      `/${id}/tracks/production`,
    )
    const plan = planGooglePlay(releases, s.versionCode)
    if (plan.kind === 'done') {
      console.log(`Google Play: nothing to do, ${plan.reason}`)
      return
    }
    if (plan.kind === 'blocked') throw new Error(plan.reason)

    const { defaultLanguage } = await call<{ defaultLanguage: string }>('GET', `/${id}/details`)
    if (s.dryRun) {
      console.log(
        `dry run: would release version code ${s.versionCode} as ${s.version} to production with:\n${s.whatsNew}`,
      )
      return
    }
    await call('PUT', `/${id}/tracks/production`, {
      track: 'production',
      releases: [
        {
          name: s.version,
          versionCodes: [s.versionCode],
          status: 'completed',
          releaseNotes: [{ language: defaultLanguage, text: s.whatsNew }],
        },
      ],
    })
    await call('POST', `/${id}:commit`)
    committed = true
    console.log(`Google Play: sent ${s.version} (${s.versionCode}) to production review`)
  } finally {
    if (!committed) await call('DELETE', `/${id}`).catch(() => {})
  }
}
