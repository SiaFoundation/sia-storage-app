import { execFileSync } from 'child_process'
import * as fs from 'fs'
import { COMMENT_MARKER } from './comment'

/*
 * Posts the benchmark comment on a PR, or edits the one an earlier run posted,
 * so a PR carries one benchmark comment however many times the job runs.
 * Needs GH_TOKEN with pull-requests: write, GITHUB_REPOSITORY and PR_NUMBER.
 *
 *   node --import tsx src/ci/postComment.ts results/ci/comment.md
 */

function gh(args: string[], input?: string): string {
  return execFileSync('gh', args, { encoding: 'utf8', input })
}

function main() {
  const [file] = process.argv.slice(2)
  const repo = process.env.GITHUB_REPOSITORY
  const pr = process.env.PR_NUMBER
  if (!file || !repo || !pr) {
    throw new Error('usage: postComment.ts <comment.md>, with GITHUB_REPOSITORY and PR_NUMBER set')
  }
  const body = fs.readFileSync(file, 'utf8')

  const ids = gh([
    'api',
    '--paginate',
    `repos/${repo}/issues/${pr}/comments`,
    '--jq',
    // Only the workflow's own comments, so a person quoting the marker never
    // has their comment overwritten.
    `.[] | select(.user.login == "github-actions[bot]" and (.body | startswith("${COMMENT_MARKER}"))) | .id`,
  ])
    .split('\n')
    .filter(Boolean)

  const payload = JSON.stringify({ body })
  if (ids.length > 0) {
    gh(['api', '-X', 'PATCH', `repos/${repo}/issues/comments/${ids[0]}`, '--input', '-'], payload)
    console.log(`Updated comment ${ids[0]}`)
  } else {
    gh(['api', '-X', 'POST', `repos/${repo}/issues/${pr}/comments`, '--input', '-'], payload)
    console.log('Posted a new comment')
  }
}

main()
