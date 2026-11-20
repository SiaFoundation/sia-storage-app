/**
 * Submits an existing TestFlight build to App Store review, reads where it is
 * in review, and releases it once approved, through the App Store Connect
 * API. Apple releases an approved version itself, unless it was switched to
 * manual release in App Store Connect.
 */

import { readFileSync } from 'node:fs'
import { appStoreConnectToken } from './jwt'
import {
  type StoreReview,
  type AppStoreVersion,
  appStoreReview,
  planAppStore,
  planAppStoreRelease,
} from './plan'

const API = 'https://api.appstoreconnect.apple.com'

type Resource = {
  id: string
  type: string
  attributes: Record<string, unknown>
  relationships?: Record<string, { data?: { id: string } | null }>
}

function apiKey(): { keyId: string; issuerId: string; privateKey: string } {
  const json = process.env.APP_STORE_CONNECT_API_KEY_JSON
  if (!json) throw new Error('APP_STORE_CONNECT_API_KEY_JSON is not set')
  const key = JSON.parse(json) as Record<string, string | undefined>
  const privateKey =
    key.key_content || (key.key_filepath && readFileSync(key.key_filepath, 'utf-8'))
  if (!key.key_id || !key.issuer_id || !privateKey) {
    throw new Error('APP_STORE_CONNECT_API_KEY_JSON needs key_id, issuer_id and key_content')
  }
  return { keyId: key.key_id, issuerId: key.issuer_id, privateKey }
}

/**
 * The request with its query and every id taken out, such as
 * `GET /v1/appStoreVersions/{id}`. Workflow logs in a public repo are public,
 * so an error names only which kind of request failed.
 */
export function requestShape(method: string, path: string): string {
  const resource = path
    .split('?')[0]
    .split('/')
    .map((segment) => (segment === '' || /^(v\d+|[A-Za-z]+)$/.test(segment) ? segment : '{id}'))
    .join('/')
  return `${method} ${resource}`
}

function client(token: string) {
  return async function call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ data: Resource | Resource[] }> {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!response.ok) {
      throw new Error(
        `App Store Connect ${requestShape(method, path)} failed with HTTP ${response.status}`,
      )
    }
    return response.status === 204 ? { data: [] } : ((await response.json()) as { data: Resource })
  }
}

function many(result: { data: Resource | Resource[] }): Resource[] {
  return Array.isArray(result.data) ? result.data : [result.data]
}

function one(result: { data: Resource | Resource[] }): Resource {
  return many(result)[0]
}

/** A build of one version of the app, as TestFlight has it. */
export type AppStoreBuild = { bundleId: string; version: string; buildNumber: string }

export type AppStoreSubmission = AppStoreBuild & { whatsNew: string; dryRun: boolean }

type Call = ReturnType<typeof client>

/** The app, the build, and every App Store version of the app. */
async function lookUp(
  b: AppStoreBuild,
): Promise<{ call: Call; appId: string; build: Resource; versions: AppStoreVersion[] }> {
  const call = client(await appStoreConnectToken(apiKey()))
  const app = many(await call('GET', `/v1/apps?filter[bundleId]=${b.bundleId}`)).find(
    (a) => a.attributes.bundleId === b.bundleId,
  )
  if (!app) throw new Error(`no App Store app has bundle id ${b.bundleId}`)

  const build = many(
    await call(
      'GET',
      `/v1/builds?filter[app]=${app.id}&filter[version]=${b.buildNumber}&filter[preReleaseVersion.version]=${b.version}&filter[preReleaseVersion.platform]=IOS`,
    ),
  )[0]
  if (!build) throw new Error(`TestFlight has no build ${b.buildNumber} of ${b.version}`)
  return { call, appId: app.id, build, versions: await versionsOf(call, app.id) }
}

async function versionsOf(call: Call, appId: string): Promise<AppStoreVersion[]> {
  return many(
    await call(
      'GET',
      `/v1/apps/${appId}/appStoreVersions?filter[platform]=IOS&include=build&limit=50`,
    ),
  ).map((v) => ({
    id: v.id,
    versionString: String(v.attributes.versionString),
    state: String(v.attributes.appVersionState ?? v.attributes.appStoreState),
    buildId: v.relationships?.build?.data?.id ?? null,
  }))
}

/** Where the build's version is in App Store review. */
export async function appStoreReviewOf(b: AppStoreBuild): Promise<StoreReview> {
  const { build, versions } = await lookUp(b)
  return appStoreReview(versions, b.version, build.id)
}

/** Releases the build's version once Apple has approved it. */
export async function releaseOnAppStore(b: AppStoreBuild & { dryRun: boolean }): Promise<void> {
  const { call, build, versions } = await lookUp(b)
  const plan = planAppStoreRelease(versions, b.version, build.id)
  if (plan.kind === 'done') {
    console.log(`App Store: nothing to do, ${plan.reason}`)
    return
  }
  if (plan.kind === 'blocked') throw new Error(plan.reason)
  if (b.dryRun) {
    console.log(`dry run: would release ${b.version} with build ${b.buildNumber}`)
    return
  }
  await call('POST', '/v1/appStoreVersionReleaseRequests', {
    data: {
      type: 'appStoreVersionReleaseRequests',
      relationships: {
        appStoreVersion: { data: { type: 'appStoreVersions', id: plan.versionId } },
      },
    },
  })
  console.log(`App Store: released ${b.version} with build ${b.buildNumber}`)
}

export async function submitToAppStore(s: AppStoreSubmission): Promise<void> {
  const { call, appId, build, versions } = await lookUp(s)
  if (build.attributes.processingState !== 'VALID') {
    throw new Error(`build ${s.buildNumber} is ${build.attributes.processingState}, not VALID`)
  }
  if (build.attributes.expired) {
    throw new Error(`build ${s.buildNumber} has expired in TestFlight and can't be submitted`)
  }

  const plan = planAppStore(versions, s.version, build.id)
  if (plan.kind === 'done') {
    console.log(`App Store: nothing to do, ${plan.reason}`)
    return
  }
  if (plan.kind === 'blocked') throw new Error(plan.reason)
  if (s.dryRun) {
    const replacing = plan.kind === 'replace' ? 'remove the version from review, ' : ''
    console.log(
      `dry run: would ${replacing}attach build ${s.buildNumber}, set What's New and submit:\n${s.whatsNew}`,
    )
    return
  }
  if (plan.kind === 'replace') await removeFromReview(call, appId, plan.versionId)

  const buildRef = { data: { type: 'builds', id: build.id } }
  const versionId =
    plan.kind === 'create'
      ? one(
          await call('POST', '/v1/appStoreVersions', {
            data: {
              type: 'appStoreVersions',
              // A new version releases as soon as Apple approves it. An existing
              // one keeps its release option, so a version someone switched to
              // manual release in App Store Connect stays held when resubmitted.
              attributes: {
                platform: 'IOS',
                versionString: s.version,
                releaseType: 'AFTER_APPROVAL',
              },
              relationships: { app: { data: { type: 'apps', id: appId } }, build: buildRef },
            },
          }),
        ).id
      : plan.versionId
  if (plan.kind !== 'create') {
    await call('PATCH', `/v1/appStoreVersions/${versionId}`, {
      data: {
        type: 'appStoreVersions',
        id: versionId,
        relationships: { build: buildRef },
      },
    })
  }

  const localizations = many(
    await call('GET', `/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations`),
  )
  const locales = localizations.map((l) => String(l.attributes.locale))
  if (localizations.length !== 1 || !locales[0].startsWith('en')) {
    throw new Error(
      `What's New is written in English only, and the listing has ${locales.length} languages`,
    )
  }
  await call('PATCH', `/v1/appStoreVersionLocalizations/${localizations[0].id}`, {
    data: {
      type: 'appStoreVersionLocalizations',
      id: localizations[0].id,
      attributes: { whatsNew: s.whatsNew },
    },
  })

  await submitForReview(call, appId, versionId)
  console.log(`App Store: submitted ${s.version} with build ${s.buildNumber} for review`)
}

/**
 * Cancels the review submission holding the version, so it can take another
 * build. Apple finishes a cancel on its side, so this waits until the version
 * leaves review, for up to three minutes.
 */
async function removeFromReview(call: Call, appId: string, versionId: string): Promise<void> {
  const submissions = many(
    await call(
      'GET',
      `/v1/reviewSubmissions?filter[app]=${appId}&filter[platform]=IOS&filter[state]=WAITING_FOR_REVIEW,IN_REVIEW`,
    ),
  )
  for (const submission of submissions) {
    await call('PATCH', `/v1/reviewSubmissions/${submission.id}`, {
      data: { type: 'reviewSubmissions', id: submission.id, attributes: { canceled: true } },
    })
  }
  for (let tries = 0; tries < 18; tries++) {
    const version = (await versionsOf(call, appId)).find((v) => v.id === versionId)
    if (version && !['WAITING_FOR_REVIEW', 'IN_REVIEW'].includes(version.state)) return
    await Bun.sleep(10_000)
  }
  throw new Error('the version was still in review three minutes after removing it')
}

/**
 * Adds the version to a review submission and submits it. A submission left
 * unsubmitted by an earlier run, or sent back by review, is reused rather than
 * duplicated.
 */
async function submitForReview(call: Call, appId: string, versionId: string): Promise<void> {
  const open = many(
    await call(
      'GET',
      `/v1/reviewSubmissions?filter[app]=${appId}&filter[platform]=IOS&filter[state]=READY_FOR_REVIEW,UNRESOLVED_ISSUES&include=items`,
    ),
  )[0]
  const submissionId =
    open?.id ??
    one(
      await call('POST', '/v1/reviewSubmissions', {
        data: {
          type: 'reviewSubmissions',
          attributes: { platform: 'IOS' },
          relationships: { app: { data: { type: 'apps', id: appId } } },
        },
      }),
    ).id
  const items = many(
    await call('GET', `/v1/reviewSubmissions/${submissionId}/items?include=appStoreVersion`),
  )
  if (!items.some((i) => i.relationships?.appStoreVersion?.data?.id === versionId)) {
    await call('POST', '/v1/reviewSubmissionItems', {
      data: {
        type: 'reviewSubmissionItems',
        relationships: {
          reviewSubmission: { data: { type: 'reviewSubmissions', id: submissionId } },
          appStoreVersion: { data: { type: 'appStoreVersions', id: versionId } },
        },
      },
    })
  }
  await call('PATCH', `/v1/reviewSubmissions/${submissionId}`, {
    data: { type: 'reviewSubmissions', id: submissionId, attributes: { submitted: true } },
  })
}
