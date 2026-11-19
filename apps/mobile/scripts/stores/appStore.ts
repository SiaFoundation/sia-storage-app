/**
 * Submits an existing TestFlight build to App Store review, through the App
 * Store Connect API. The version is created with manual release, so an
 * approved version waits for someone to release it.
 */

import { readFileSync } from 'node:fs'
import { appStoreConnectToken } from './jwt'
import { type AppStoreVersion, planAppStore } from './plan'

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
      throw new Error(`App Store Connect ${method} ${path} failed with HTTP ${response.status}`)
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

export type AppStoreSubmission = {
  bundleId: string
  version: string
  buildNumber: string
  whatsNew: string
  dryRun: boolean
}

export async function submitToAppStore(s: AppStoreSubmission): Promise<void> {
  const call = client(await appStoreConnectToken(apiKey()))

  const app = many(await call('GET', `/v1/apps?filter[bundleId]=${s.bundleId}`)).find(
    (a) => a.attributes.bundleId === s.bundleId,
  )
  if (!app) throw new Error(`no App Store app has bundle id ${s.bundleId}`)

  const build = many(
    await call(
      'GET',
      `/v1/builds?filter[app]=${app.id}&filter[version]=${s.buildNumber}&filter[preReleaseVersion.version]=${s.version}&filter[preReleaseVersion.platform]=IOS`,
    ),
  )[0]
  if (!build) throw new Error(`TestFlight has no build ${s.buildNumber} of ${s.version}`)
  if (build.attributes.processingState !== 'VALID') {
    throw new Error(`build ${s.buildNumber} is ${build.attributes.processingState}, not VALID`)
  }
  if (build.attributes.expired) {
    throw new Error(`build ${s.buildNumber} has expired in TestFlight and can't be submitted`)
  }

  const versions: AppStoreVersion[] = many(
    await call(
      'GET',
      `/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&include=build&limit=50`,
    ),
  ).map((v) => ({
    id: v.id,
    versionString: String(v.attributes.versionString),
    state: String(v.attributes.appVersionState ?? v.attributes.appStoreState),
    buildId: v.relationships?.build?.data?.id ?? null,
  }))

  const plan = planAppStore(versions, s.version, build.id)
  if (plan.kind === 'done') {
    console.log(`App Store: nothing to do, ${plan.reason}`)
    return
  }
  if (plan.kind === 'blocked') throw new Error(plan.reason)
  if (s.dryRun) {
    console.log(
      `dry run: would attach build ${s.buildNumber}, set What's New and submit:\n${s.whatsNew}`,
    )
    return
  }

  const buildRef = { data: { type: 'builds', id: build.id } }
  const versionId =
    plan.kind === 'create'
      ? one(
          await call('POST', '/v1/appStoreVersions', {
            data: {
              type: 'appStoreVersions',
              attributes: { platform: 'IOS', versionString: s.version, releaseType: 'MANUAL' },
              relationships: { app: { data: { type: 'apps', id: app.id } }, build: buildRef },
            },
          }),
        ).id
      : plan.versionId
  if (plan.kind === 'update') {
    await call('PATCH', `/v1/appStoreVersions/${versionId}`, {
      data: {
        type: 'appStoreVersions',
        id: versionId,
        attributes: { releaseType: 'MANUAL' },
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
      `What's New is written in English only, and the listing has ${locales.join(', ')}`,
    )
  }
  await call('PATCH', `/v1/appStoreVersionLocalizations/${localizations[0].id}`, {
    data: {
      type: 'appStoreVersionLocalizations',
      id: localizations[0].id,
      attributes: { whatsNew: s.whatsNew },
    },
  })

  await submitForReview(call, app.id, versionId)
  console.log(`App Store: submitted ${s.version} with build ${s.buildNumber} for review`)
}

/**
 * Adds the version to a review submission and submits it. A submission left
 * unsubmitted by an earlier run, or sent back by review, is reused rather than
 * duplicated.
 */
async function submitForReview(
  call: ReturnType<typeof client>,
  appId: string,
  versionId: string,
): Promise<void> {
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
