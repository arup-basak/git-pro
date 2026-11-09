# Git Pro

A desktop app (Electron + React + TypeScript) for full manual control over Git commits:
push anything anywhere, rewrite commit dates/authors/messages onto separate branches,
manage structured stashes with an apply preview, and resolve conflicts in a 3-way merge editor.

It drives your installed `git` CLI, so pushes use your existing SSH keys and credential helper.

## Run

```bash
npm install          # if the Electron download fails (GitHub 5xx), re-run: npx install-electron
npm run dev          # development with hot reload
npm run build:mac    # unsigned .dmg in dist/
```

Checks:

```bash
npm run typecheck && npm run lint
npm test             # git engine tests against real temporary repos (+ a bare repo as remote)
npm run test:e2e     # builds the app and drives it with Playwright
```

## What you can do

| Area | Features |
| --- | --- |
| **Graph** | All refs or one branch, lane graph, search by message / author / SHA, commit details with author **and** committer dates, per-file diffs |
| **Push** | Push a local branch **or any commit** to **any** remote branch (new or existing), set upstream, follow tags, dry run, `--force-with-lease` (expected SHA from your tracking ref) or plain force with confirmation; exact command preview |
| **History editor** | Pick a range (last N, from a commit, whole history). Per commit: author/committer date + UTC offset, author/committer identity, message. Bulk: shift by offset (`+2h`, `-1d 3h`), spread evenly, random-in-order, set all, committer = author. Reorder (drag), squash, fixup, drop. Output to a **new branch** (default) or in place |
| **Commit** | Stage/unstage/discard per file or selection, commit/amend with custom author, author date, committer date, sign-off, skip hooks, allow empty |
| **Stashes** | Named stashes with group, notes, pin; stash all / staged only / selected files; snapshot mode (keep working tree); **apply preview** (dry-run 3-way merge showing the resulting workspace, conflicts and blocked files); apply, apply & remove, stash → branch; Recently deleted with restore; plain `git stash` entries listed separately and adoptable |
| **Merge editor** | Per-conflict Current / Incoming / Both / Base / Edit, full-file tabs, edit-as-text, take whole side, delete-vs-modify handling. Works for stash apply, rebase, cherry-pick, revert and merge conflicts, plus read-only previews |
| **Other** | Branches (create at any commit, rename, delete, upstream), remote branches, tags (annotated with custom tagger date, push/delete remote), cherry-pick, revert, reset (soft/mixed/keep/hard), rebase/merge continue/skip/abort, reflog, command log |

## How history rewriting works

* **Metadata only** (dates, identities, messages): every affected commit is rebuilt with
  `git commit-tree` on its **original tree**, descendants are re-parented. No working-tree
  changes, no conflicts possible, merges preserved. An edit that changes nothing reproduces the
  identical SHA.
* **Structural** (reorder/squash/fixup/drop): `git rebase -i` with a generated todo list;
  metadata edits are applied by guarded `exec` steps. Conflicts stop the rebase and open the
  operation banner + merge editor.

## Safety model

* Rewrites go to a new branch by default; the original branch is untouched.
* Before any in-place rewrite, reset, branch delete or backup restore, the old position is saved
  under `refs/git-pro/backups/<time>-<reason>/<branch>` (local only, never pushed). See **Backups**.
* App stashes live under `refs/git-pro/stashes/<id>` with metadata in
  `.git/git-pro/stashes.json`; deleted ones move to `refs/git-pro/stash-trash/<id>`.
  A stash whose apply conflicts is never dropped.
* The renderer is sandboxed (`contextIsolation`, `sandbox`, no Node); it can only run git in
  repositories you opened through a dialog. Git is spawned without a shell.

## Layout

```
src/shared/     types, IPC contract (api.ts), date + push helpers shared by both sides
src/main/git/   git engine: runner, parsers, log/refs, worktree, branches, remotes, rewrite
                (commit-tree), rebase, stash (+ stashStore), merge, backups, opstate
src/main/       window, IPC dispatcher with repo allowlist, .git watcher, settings
src/preload/    typed window.gitPro bridge
src/renderer/   React UI (views under components/, state in lib/store.ts, queries in lib/queries.ts)
tests/          vitest engine tests, tests/e2e Playwright tests
```
