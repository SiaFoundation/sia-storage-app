#!/usr/bin/env bun

/**
 * Store Review: writes where the open mobile final PR's version is in App
 * Store review into the PR, as its header's App Store line and its
 * `store/app-store` status. The PR is ready to merge only while Apple has
 * approved its candidate's build, and a draft otherwise.
 *
 * Google Play's API reports no review state, so the header leaves that to
 * Play Console. Only the state's name reaches the PR, never what App Store
 * Connect returns.
 *
 * Usage:
 *   bun scripts/storeReview.ts
 */

import { execFileSync } from 'node:child_process'
import {
  appStoreLine,
  headerLine,
  mobileFinalHeader,
  renderHeader,
  withHeader,
} from '../../../scripts/release-header'
import { candidateFile, finalBranch, parseCandidateTag } from '../../../scripts/release-trains'
import { buildOf } from './submitStores'
import { appStoreReviewOf } from './stores/appStore'

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

/** The label of an App Store line, without the time it was first seen. */
function labelOf(line: string | null): string | null {
  return line?.replace(/^App Store: /, '').replace(/ \(since [^)]*\)$/, '') ?? null
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
  const review = await appStoreReviewOf(build)
  console.log(`#${pr.number}: ${build.version} build ${build.buildNumber} is ${review.label}`)

  // Prepare or Finalize Release can rebuild the PR while App Store Connect
  // answers, even for another candidate, so a PR that changed meanwhile is
  // left for the next run rather than given this candidate's state.
  const now = openFinal()
  if (now?.headRefOid !== pr.headRefOid || now.body !== pr.body) {
    console.log(
      `#${pr.number} changed while App Store Connect was read, leaving it for the next run`,
    )
    return
  }

  const previous = headerLine(pr.body, 'App Store:')
  if (labelOf(previous) !== review.label) {
    const header = renderHeader(
      mobileFinalHeader({
        version: build.version,
        candidate: candidate.version,
        buildNumber: build.buildNumber,
        appStore: appStoreLine(review.label, new Date()),
      }),
    )
    gh('pr', 'edit', String(pr.number), '--body', withHeader(pr.body, header))
  }
  gh(
    'api',
    `repos/{owner}/{repo}/statuses/${pr.headRefOid}`,
    '-f',
    `state=${review.status}`,
    '-f',
    'context=store/app-store',
    '-f',
    `description=App Store: ${review.label}`.slice(0, 140),
  )
  // Back to draft too, as when the approved build is rejected in App Store
  // Connect, so the PR can merge only while Apple approves this candidate.
  if (review.approved && pr.isDraft) gh('pr', 'ready', String(pr.number))
  if (!review.approved && !pr.isDraft) gh('pr', 'ready', String(pr.number), '--undo')
}

if (import.meta.main) await main()
