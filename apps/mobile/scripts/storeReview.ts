#!/usr/bin/env bun

/**
 * Store Review: writes where the open mobile final PR's version is in App
 * Store and Google Play review into the PR, as its header's store lines and
 * its `store/app-store` and `store/google-play` statuses. The PR is ready to
 * merge while both stores have approved its candidate's build, and a draft
 * otherwise, and it merges the PR once both have the build live. Only each
 * state's name reaches the PR, never anything else a store returns.
 *
 * Usage:
 *   bun scripts/storeReview.ts
 */

import { execFileSync, spawnSync } from 'node:child_process'
import {
  type Store,
  headerLine,
  mobileFinalHeader,
  renderHeader,
  storeLabel,
  storeLine,
  withHeader,
} from '../../../scripts/release-header'
import { candidateFile, finalBranch, parseCandidateTag } from '../../../scripts/release-trains'
import { buildOf } from './submitStores'
import { appStoreReviewOf } from './stores/appStore'
import { playReviewOf } from './stores/googlePlay'
import type { StoreReview } from './stores/plan'

function gh(...args: string[]): string {
  return execFileSync('gh', args, { encoding: 'utf-8' }).trim()
}

type FinalPr = { number: number; body: string; headRefOid: string; isDraft: boolean }

function openFinal(): FinalPr | null {
  const list = JSON.parse(
    gh(
      'pr',
      'list',
      '--head',
      finalBranch('mobile'),
      '--state',
      'open',
      '--json',
      'number,body,headRefOid,isDraft',
    ),
  ) as FinalPr[]
  return list[0] ?? null
}

/** Each store's line for the header, keeping the time a state was first seen. */
function line(store: Store, body: string, review: StoreReview): string {
  const previous = headerLine(body, `${store}:`)
  return previous && storeLabel(store, previous) === review.label
    ? previous
    : storeLine(store, review.label, new Date())
}

function postStatus(sha: string, context: string, store: Store, review: StoreReview): void {
  gh(
    'api',
    `repos/{owner}/{repo}/statuses/${sha}`,
    '-f',
    `state=${review.status}`,
    '-f',
    `context=${context}`,
    '-f',
    `description=${store}: ${review.label}`.slice(0, 140),
  )
}

/**
 * A store whose state couldn't be read shows that, and the other store is
 * still written. The errors name only the request and its HTTP status.
 */
async function unlessFailed(review: Promise<StoreReview>): Promise<StoreReview> {
  try {
    return await review
  } catch (error) {
    console.error(`${error}`)
    return {
      label: "Couldn't be read, see the Store Review run",
      status: 'pending',
      approved: false,
      live: false,
    }
  }
}

async function main(): Promise<void> {
  const pr = openFinal()
  if (!pr) {
    console.log('no mobile final PR is open')
    return
  }
  const recorded = execFileSync('git', ['show', `${pr.headRefOid}:${candidateFile('mobile')}`], {
    encoding: 'utf-8',
  }).trim()
  const candidate = parseCandidateTag(recorded)
  if (candidate?.app !== 'mobile') throw new Error(`#${pr.number} names no mobile candidate`)
  const build = buildOf(candidate.version)
  const [apple, google] = await Promise.all([
    unlessFailed(appStoreReviewOf(build)),
    unlessFailed(playReviewOf(build.bundleId, build.buildNumber)),
  ])
  console.log(
    `#${pr.number}: ${build.version} build ${build.buildNumber} is ${apple.label} on the App Store and ${google.label} on Google Play`,
  )

  // Prepare or Finalize Release can rebuild the PR while the stores answer,
  // even for another candidate, so a PR that changed meanwhile is left for the
  // next run rather than given this candidate's state.
  const now = openFinal()
  if (now?.headRefOid !== pr.headRefOid || now.body !== pr.body) {
    console.log(`#${pr.number} changed while the stores were read, leaving it for the next run`)
    return
  }

  const header = renderHeader(
    mobileFinalHeader({
      version: build.version,
      candidate: candidate.version,
      buildNumber: build.buildNumber,
      appStore: line('App Store', pr.body, apple),
      googlePlay: line('Google Play', pr.body, google),
    }),
  )
  const body = withHeader(pr.body, header)
  if (body !== pr.body) gh('pr', 'edit', String(pr.number), '--body', body)
  postStatus(pr.headRefOid, 'store/app-store', 'App Store', apple)
  postStatus(pr.headRefOid, 'store/google-play', 'Google Play', google)
  // Back to draft too, as when an approved build is rejected later, so the PR
  // can merge only while both stores approve this candidate.
  const approved = apple.approved && google.approved
  if (approved && pr.isDraft) gh('pr', 'ready', String(pr.number))
  if (!approved && !pr.isDraft) gh('pr', 'ready', String(pr.number), '--undo')
  // A store holding an approved build keeps the PR open, as the reminder that
  // it still has to be released there.
  if (apple.live && google.live) merge(pr.number, pr.headRefOid)
}

/**
 * Merges the final PR at `head`, the commit whose candidate the stores were
 * read for, which tags the release. GitHub refuses the merge if Finalize
 * Release has since replaced the PR with another candidate, and the next run
 * reads the stores again. It needs the release bot's token, since only a
 * merge by the bot starts Publish Release and the bot may merge past main's
 * review rule. A merge GitHub refuses leaves the PR ready for someone to merge.
 */
function merge(pr: number, head: string): void {
  const token = process.env.BOT_TOKEN
  if (!token) {
    console.log(`#${pr} is ready, and merges once BOT_TOKEN is set`)
    return
  }
  const run = spawnSync(
    'gh',
    ['pr', 'merge', String(pr), '--rebase', '--match-head-commit', head],
    { encoding: 'utf-8', env: { ...process.env, GH_TOKEN: token } },
  )
  if (run.status === 0) console.log(`merged #${pr}`)
  else
    console.log(`::warning::#${pr} is ready but didn't merge: ${run.stderr.trim().split('\n')[0]}`)
}
