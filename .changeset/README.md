# Changesets

This directory stores changeset files for upcoming releases.

## Creating a Changeset

Run `knope changeset` or create a markdown file manually:

```markdown
---
default: patch
---

Description of what changed
```

Change types: `patch`, `minor`, `major`

Changesets are optional - conventional commit messages also work.
