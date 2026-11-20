# Releasing

Each app releases on its own train. Mobile, desktop and the CLI with its libraries never wait for
each other: a desktop fix ships while a mobile version sits in App Store review, and merging to
main is never blocked by a release.

## Trains

| Train      | Packages                       | Gate                     | Release PR branches                        |
| ---------- | ------------------------------ | ------------------------ | ------------------------------------------ |
| `mobile`   | `mobile`                       | candidates, store review | `release/mobile`, `release/mobile-final`   |
| `desktop`  | `desktop`                      | candidates, beta testing | `release/desktop`, `release/desktop-final` |
| `packages` | `cli`, `core`, `logger`, `web` | none                     | `release/packages`                         |

A changeset names packages of one train. A change that reaches mobile and desktop gets one
changeset for each, written for that app's users. `bun run check-changesets` enforces this.

The libraries are built into each app from source at the commit that app is cut from, so a
library version records changes and nothing else. No app waits for one.

## A gated train, mobile or desktop

1. **Candidate.** Every push to main rebuilds `release/<app>` when the train has changes its
   newest candidate does not. The PR bumps the app to `X.Y.Z-rc.N` and carries Copilot's
   What's New and tester notes. Merging it tags the candidate and sends it to testers: TestFlight
   and Play internal testing for mobile, the beta app for desktop.
2. **Finalize.** Run the Finalize Release workflow with the app, once a candidate has been
   tested. It names the newest candidate unless told another.
   - Mobile: submits the candidate's build to App Store and Google Play review, with the What's
     New the candidate carries, then opens the final PR as a draft. The App Store version is set
     to manual release, and Google Play holds an approved update under managed publishing.
   - Desktop: opens the final PR, ready to merge.
3. **Review**, mobile only. Every 15 minutes, Store Review reads both stores' review state and
   writes it into the final PR's header and its `store/app-store` and `store/google-play`
   statuses. The PR becomes ready to merge when both stores approve, and goes back to draft if
   either stops approving. Only the state is written, such as "In review" or "Rejected", never
   anything else a store returns, since the PR is public.
4. **Release.** Merging the final PR tags `<app>/vX.Y.Z` on the candidate's commit, next to its
   `-rc.N` tag, so the tag names the source users got.
   - Mobile: nothing is rebuilt. The tag releases the approved App Store version. Publish the
     Google Play update in Play Console, unless managed publishing is off, in which case it went
     live when Google approved it.
   - Desktop: the tag builds the shipping app from that commit.

Main keeps taking merges through all of this. While a final PR is open, new candidates of that
app keep its version number, so a fix during review is `1.15.1-rc.4`, not `1.16.0-rc.0`, and goes
to the same App Store version.

## The packages train

Every push to main with pending `cli`, `core`, `logger` or `web` changesets rebuilds
`release/packages`. Merging it tags each package's new version, and a CLI tag builds and attaches
its binaries.

## When review rejects a version

- **A problem in the build.** Merge the fix. The candidate PR cuts `1.15.1-rc.4`. Merge it, test
  it, and run Finalize again. The final PR is rebuilt for rc.4 and goes back to draft, and the new
  build replaces the old one in both stores:
  - App Store: a rejected version takes the new build and is resubmitted. A version still waiting
    for review or in review is removed from review first. A version Apple already approved can't
    change its build from the API, so Finalize stops and says so: reject that build in App Store
    Connect, then run it again.
  - Google Play: the new release replaces the one in review.
- **A problem in the listing**, such as screenshots or review notes: fix it in the store and
  resubmit there. No new build.

1.15.1 isn't tagged until its final PR merges after both stores approve, so no version is
skipped, and its What's New, rewritten at each candidate, still covers everything since 1.15.0.

## The final commit

The final PR is built on main's tip, so it can't conflict with work merged after the candidate.
It consumes the changesets the candidate shipped, the ones in the candidate's tree or listed in
its changelog, and leaves the rest for the next version. It sets the app's version to `X.Y.Z`,
writes the candidate's What's New entry with today's date, and names the candidate in
`apps/<app>/.release-candidate`, which Publish Release reads to find the commit to tag.

Prepare Release rebuilds an open release PR, candidate or final, when main changes a file it
changes or one of its train's changesets. `bun.lock` doesn't count: every cut changes it, but only
in its own packages' blocks, so cuts of different trains merge cleanly, and a candidate PR keeps
its sim runs when another train releases. Publish Release runs Prepare Release after every
release, so the other open release PRs are rebuilt against it.

## Release PR headers

Every release PR opens with where its version is, the current step in bold. A mobile candidate:

```
**Mobile 1.15.1-rc.4**
**Candidate** › Testing › Review › Released

Merging sends rc.4 to TestFlight and Google Play internal testing.
Mobile 1.15.1 from 1.15.1-rc.3 is in #1110, so this candidate stays 1.15.1.
```

A mobile final, with the App Store line Store Review keeps up to date:

```
**Mobile 1.15.1 from 1.15.1-rc.3, build 1150103**
Candidate › Testing › **Review** › Released

App Store: In review (since 2026-11-21 14:30 UTC)
Google Play: In review (since 2026-11-21 09:10 UTC)
Merge once both stores approve. Merging tags 1.15.1 and releases it on the App Store, then publish it in Play Console.
```

A desktop final:

```
**Desktop 0.0.2 from 0.0.2-rc.3**
Candidate › Beta › **Release**

Merging tags 0.0.2 and builds the shipping app.
```

## Re-running

Every step reads what already exists before changing anything, so re-running any of them is safe.

| To                                          | Run                                                  |
| ------------------------------------------- | ---------------------------------------------------- |
| rebuild the release PRs                     | Prepare Release                                      |
| resubmit a candidate                        | Finalize Release, or Release Stores with `submit`    |
| release an approved App Store version       | Release Stores with `release`                        |
| refresh a final PR's review state           | Store Review                                         |
| tag a merged candidate or packages PR again | Publish Release with its merge commit and `publish`  |
| tag a merged final PR again                 | Publish Release with its candidate tag and `promote` |
