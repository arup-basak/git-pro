# Git Pro

A desktop app for **full manual control over Git commits**. You can:

- push any branch or any single commit to any remote branch
- change the date, author or message of any commit and put the result on a separate branch
- reorder, squash and drop commits
- manage named stashes, preview exactly what applying one will do, and resolve conflicts in a 3-way merge editor
- read every diff with syntax highlighting

Git Pro drives the `git` you already have installed. Pushes and fetches use your existing SSH keys and credential helper, and every command it runs is shown in a command log.

---

## Contents

1. [Requirements](#requirements)
2. [Install and run](#install-and-run)
3. [Tour of the window](#tour-of-the-window)
4. [Opening repositories](#opening-repositories)
5. [Commit graph](#commit-graph)
6. [Changing commit dates, authors and messages](#changing-commit-dates-authors-and-messages)
7. [Reordering, squashing and dropping commits](#reordering-squashing-and-dropping-commits)
8. [Pushing to any branch](#pushing-to-any-branch)
9. [Staging and committing](#staging-and-committing)
10. [Stashes](#stashes)
11. [Merge editor](#merge-editor)
12. [Branches, remotes and tags](#branches-remotes-and-tags)
13. [Cherry-pick, revert, reset](#cherry-pick-revert-reset)
14. [Reflog, backups and undo](#reflog-backups-and-undo)
15. [Syntax highlighting and view settings](#syntax-highlighting-and-view-settings)
16. [Command log](#command-log)
17. [Menu bar and keyboard shortcuts](#menu-bar-and-keyboard-shortcuts)
18. [Where Git Pro stores things](#where-git-pro-stores-things)
19. [Troubleshooting](#troubleshooting)
20. [Limits and known gaps](#limits-and-known-gaps)
21. [Development](#development)

---

## Requirements

|         |                                                                                     |
| ------- | ----------------------------------------------------------------------------------- |
| OS      | macOS (Apple Silicon or Intel). Windows and Linux builds are possible but untested. |
| Git     | **2.40 or newer** (tested with 2.54). Check with `git --version`.                   |
| Node.js | 22 or newer, only to build from source (developed with Node 26 and npm 11).         |

## Install and run

```bash
npm install          # installs dependencies and downloads Electron
npm run dev          # start the app with hot reload
```

If `npm install` fails while downloading Electron (GitHub sometimes answers `504`), run
`npx install-electron` until it succeeds.

Build a macOS app:

```bash
npm run build:mac    # → dist/git-pro-<version>.dmg and dist/mac-arm64/Git Pro.app
npm run build:unpack # → an unpacked .app only (faster, no dmg)
npm start            # run the last production build without packaging
```

The build is not notarized. If an Apple signing certificate is in your Keychain, electron-builder signs the app with it automatically. To skip signing entirely:
`CSC_IDENTITY_AUTO_DISCOVERY=false npm run build:mac`.
On another Mac, open the unnotarized app with right-click → **Open** the first time.

---

## Tour of the window

```
┌ Toolbar: repo ▾ / branch  ↑ahead ↓behind │ Fetch  Pull  Push…  Stash  Edit history…   View  ⟳  Log ┐
├ Operation banner (only while a rebase / merge / cherry-pick / unresolved conflict is in progress)   ┤
├ Sidebar ────────────┬ Main view ───────────────────────────────────────────────────────────────────┤
│ All commits         │  Graph · Changes · Stashes · History editor · Merge editor · Reflog · Backups  │
│ Changes        (n)  │                                                                               │
│ Stashes        (n)  │                                                                               │
│ History editor      │                                                                               │
│ Reflog              │                                                                               │
│ Backups        (n)  │                                                                               │
│ Branches / Remotes  │                                                                               │
│ Tags / Stashes      │                                                                               │
├ Command log (toggle with “Log”) ────────────────────────────────────────────────────────────────────┤
└ Status bar: repository path · live progress · last git command ─────────────────────────────────────┘
```

- Every command is also in the **menu bar** (macOS top menu; a window menu bar on Windows and Linux), with keyboard shortcuts. See [Menu bar and keyboard shortcuts](#menu-bar-and-keyboard-shortcuts).
- Nearly everything in the sidebar and the graph has a **right-click menu**.
- The window title shows the open repository (on macOS, ⌘-click it to see the folder path).
- The app refreshes itself when anything changes in the repository, including changes made from a terminal. **⟳** forces a refresh.
- Notifications appear at the bottom-left. Errors include git's own output.

## Opening repositories

On the start screen:

- **Open repository…** picks any folder inside a Git working tree.
- **Clone…** asks for a URL, then the parent folder to clone into.
- **New repository…** runs `git init` in a folder you pick.
- **Recent** reopens a repository; hover a row and click × to forget it.

Once a repository is open, the **repo name ▾** in the toolbar switches between recent repositories, reveals the folder in Finder, or closes the repository.

---

## Commit graph

**All commits** shows every branch, remote branch and tag as a lane graph, newest first.

- **Filter by branch.** Click a branch, remote branch or tag in the sidebar. The filter chip in the graph header (×) goes back to all commits.
- **Search.** Use the search box with the **Message**, **Author** or **SHA** mode.
- **Navigate.** Click a commit to open the details panel; **↑/↓** move the selection.
- **Load more.** The graph loads 400 commits; **Load more** adds 1,000 at a time, up to 5,000.
- **Read the badges.** Blue = local branch (solid = checked out), green = remote branch, yellow = tag, red `HEAD` = detached HEAD.
- **Details panel.** Shows:
  - the message, the SHA (click to copy) and the parents (click to jump)
  - the **author and committer, each with their own date and UTC offset**
  - the changed files with `+/-` counts, and a diff that is syntax highlighted

Right-click a commit:

| Menu item                            | What it does                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Edit date / author / message…        | Opens the [History editor](#changing-commit-dates-authors-and-messages) starting at this commit |
| Push this commit to a remote branch… | Opens [Push](#pushing-to-any-branch) with this SHA as the source                                |
| New branch here… / Tag here…         | Create a branch or tag at this commit                                                           |
| Check out (detached)…                | `git switch --detach <sha>`                                                                     |
| Cherry-pick onto _branch_            | `git cherry-pick` (merge commits use `-m 1`)                                                    |
| Revert…                              | `git revert --no-edit`                                                                          |
| Reset _branch_ to here…              | soft / mixed / keep / hard; a [backup](#reflog-backups-and-undo) is made first                  |
| Copy SHA / Copy subject              | Clipboard                                                                                       |

---

## Changing commit dates, authors and messages

Git stores **two dates per commit**:

- the **author date**, which `git log` shows by default
- the **committer date**, which is when the commit object was created

Each date has its own UTC offset. Git Pro lets you set both exactly.

### Quick start: change one commit's date and push it to a separate branch

1. Right-click the commit in the graph → **Edit date / author / message…**.
   The History editor opens with every commit from that one up to the tip of the branch. The tip is the branch you are filtering by, or otherwise the current branch.
2. In the commit's row, click the **Author date** field and type `YYYY-MM-DD HH:mm:ss`, then press **Enter**.
   Alternatively, use the calendar icon. Do the same for **Committer date** if you want both changed.
   Edited fields turn amber.
3. Leave **New branch** selected and keep or change the suggested name (`<branch>-edited-YYYYMMDD-HHmm`).
4. Click **Create branch**. The original branch is not touched.
5. In the result dialog, click **Push _branch_…**, check the remote branch name and click **Push**.

### The History editor in detail

**Range (top bar)**

- **Tip** is the branch whose history you edit.
- **Load last N** edits the last N commits. **Whole history** starts from the root commit.
- "after _sha_" means the range starts after that commit.
- At most 2,000 commits per range.

**Rows**

- Newest is at the top.
- Each row shows the action, short SHA (✓ = signed), message, author, author date and committer date.

**Date fields**

- Type a date and time, then press **Enter**; **Esc** cancels.
- The offset menu (e.g. `+0530`) keeps the wall-clock time and moves the actual instant.
- A • marks your machine's current offset.

**Shift later commits with date edits** (on by default)

- When you move a commit's date, every newer commit in the range moves by the same amount, so the original spacing and order are kept.
- Turn it off to change a single commit only.

**Message, author and committer**

- Click a row's message to expand it.
- There you can edit the message, the author and committer name/email, reset that commit, or move it up/down.

**⚠ out of order**

- Shown when a commit is now dated before the commit below it. Git allows this; the warning is just a heads-up.

**Bulk tools**
Tick rows (or **Select all**) to show the bulk toolbar:

| Tool               | Effect on the selected commits                                           |
| ------------------ | ------------------------------------------------------------------------ |
| Apply to           | Choose author + committer dates, author only, or committer only          |
| Shift              | Move by an offset: `+2h`, `-1d 3h`, `90m`, `+1w`. Units are `w d h m s`. |
| Spread evenly      | Spread from a start to an end date, oldest commit first                  |
| Random (in order)  | Random times between start and end, still in commit order                |
| Set all            | One fixed date for all of them                                           |
| Committer = author | Copy each author date into the committer date                            |
| Reset dates        | Back to the original dates                                               |

**Output**

- **New branch** (default): the rewritten history goes to a new branch.
- **Rewrite _branch_ in place**: moves the branch itself. A [backup](#reflog-backups-and-undo) is created first, and you will need a force push (with lease) to update a remote.
- **Re-sign commits** appears when commits in the range are GPG/SSH signed. Rewriting removes signatures unless you tick it.

**Result dialog**

- Lists old → new SHAs.
- Lists other refs that still point at the original commits, such as the original branch or a remote branch.
- Offers **Show in graph**, **Check out**, and **Push _branch_…**.

### What happens under the hood

The footer always tells you which engine will run:

- **"metadata only, conflict-free"**: only dates, identities or messages changed.
  - Every affected commit is recreated with `git commit-tree` from its **original file tree**, and the commits after it are re-parented.
  - Your working tree is never touched, conflicts are impossible, and merge commits are preserved.
  - Editing nothing reproduces the identical SHA.
- **"structural edit — uses rebase"**: you reordered, squashed, fixed up or dropped commits.
  - See the next section.

---

## Reordering, squashing and dropping commits

In the History editor:

- **Reorder:** drag a row by its ⋮⋮ handle, or use the ↑/↓ buttons in the expanded row.
- **Action column:**
  - `pick` keeps the commit.
  - `squash` folds it into the commit **below** it and keeps both messages.
  - `fixup` folds it in and keeps only the lower commit's message.
  - `drop` removes the commit.
- **Keep committer dates:** without it, git sets rewritten commits' committer date to "now". Keeping the dates is on by default.
- **Autostash:** stashes uncommitted changes around the rebase. Without it, the working tree must be clean.
- You can mix structural changes with date, author and message edits in the same run.

When you click **Create branch**:

- Git Pro creates the branch, checks it out, and runs `git rebase -i` with a generated plan.
- **If a conflict happens**, the rebase pauses, the orange **operation banner** appears and the [merge editor](#merge-editor) is available.
  - Resolve the files, then press **Continue** in the banner.
  - **Skip** drops the commit being replayed. **Abort** returns everything to how it was.
- Ranges that contain **merge commits** can't be reordered, squashed or dropped. You can still edit their dates, authors and messages.

---

## Pushing to any branch

Open the **Push** dialog from any of these:

- the toolbar **Push…** button
- a branch's right-click **Push to…**
- a commit's **Push this commit to a remote branch…**
- a remote branch's **Push something to this branch…**

| Field                         | Meaning                                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Source                        | **Local branch**, or **Commit / ref**: any SHA, tag or expression such as `HEAD~2` (resolved to a SHA before pushing)               |
| Remote                        | Any configured remote                                                                                                               |
| Remote branch                 | Type any name. The hint says whether it **will be created** or **exists at _sha_** (and whether it is already up to date).          |
| Force                         | **No**; **With lease (safe)**: fails if the remote changed since your last fetch; **Force (dangerous)**: overwrites unconditionally |
| Set as upstream               | Make the remote branch the upstream of your local branch (branch sources only)                                                      |
| Push reachable annotated tags | `--follow-tags`                                                                                                                     |

- The **Command** box shows the exact `git push` that will run.
- **Dry run** checks the push without sending anything.
- Force pushes ask for confirmation, with an extra warning for `main`, `master`, `release*`, `prod*` and `production`.
- If a lease push is rejected, **Fetch** and look at what changed before trying again.

---

## Staging and committing

Open **Changes** in the sidebar (the badge counts changed files).

**Lists**

- **Staged** and **Changes** list files.
- If unmerged files exist, a **conflicts box** appears above them with **Open merge editor**.

**Acting on files**

- Click a file to see its diff.
- Hover a file for quick actions: **+** stage, **−** unstage, ↶ discard.
- Tick files to act on a selection: **Stage**, **Unstage**, **Stash…**, **Discard**.
- **Stage all / Unstage all / Discard all** apply to a whole list.
- Discarding asks for confirmation and deletes untracked files. It cannot be undone, so stash instead if unsure.

**Commit box** (bottom-left)

| Option               | Meaning                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------- |
| ⌘↵ / Commit          | Commit the staged files                                                                   |
| Amend                | Rewrite the last commit; fills in its message (and, with Custom date, its original dates) |
| Custom date          | Set the **author date**, and either "Committer = author" or a separate committer date     |
| More → Sign-off      | Add a `Signed-off-by` line                                                                |
| More → Skip hooks    | `--no-verify`                                                                             |
| More → Allow empty   | Commit with no changes                                                                    |
| More → Custom author | Commit as another name/email (the committer stays you)                                    |

---

## Stashes

Git Pro keeps two kinds of stash.

|            | **App stashes**                             | **Git stash stack**                                       |
| ---------- | ------------------------------------------- | --------------------------------------------------------- |
| Created by | Git Pro                                     | `git stash` in a terminal or another tool                 |
| Identity   | Stable id; never changes position           | `stash@{n}`, which shifts as entries are added or removed |
| Extras     | Name, group, notes, pin, scope, base commit | Message only                                              |
| Deleting   | Moves to **Recently deleted** (restorable)  | Drops permanently                                         |

### Creating a stash

Click **Stash** in the toolbar, or in Changes use **Stash all…**, **Stash staged…**, or tick files → **Stash…**. Then fill in:

- **Name** (defaults to `WIP on <branch>`), **Group** (suggests existing groups), **Notes**.
- **What to stash:** All changes / Staged only / Selected files.
- **Include untracked files.**
- **Keep changes in the working tree:** records a snapshot without touching your files.

### The Stashes view

**List** (left)

- Groups, with pinned stashes on top; then **Git stash stack**; then **Recently deleted**.
- The filter box searches names, notes, branches and groups.

**Header** (right)

- Shows the branch the stash was made on, the commit it is based on, its age and its scope.
- Buttons: ✎ edit, **Branch**, **Apply**, **Preview apply**, and ⋯ for more.

**Changes tab**

- The stash's files and diff. Untracked files show as `U`.

### Apply preview

The **Apply preview** tab simulates `git stash apply` against your current workspace without changing anything:

- **"Onto _branch_ @ _sha_ + N local changes"** is what the stash will be applied onto.
- **Applies cleanly** in green, or a count of conflicts and blocked files.
- Each file gets an outcome:

  | Mark            | Outcome                                                                                                                       |
  | --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
  | `M` / `A` / `D` | Will be modified / added / deleted                                                                                            |
  | `U`             | Untracked file that will be restored                                                                                          |
  | `!`             | **Conflict** — click _merge_ or **Preview merge** to see the result in a read-only merge editor                               |
  | `×`             | **Blocked** — you have uncommitted changes to that file, or an untracked file with that name already exists; git would refuse |

- Selecting a file shows the diff of exactly what will change in your working tree.
- **Restore staged state (--index)** also re-stages what was staged when the stash was made.
- **Apply** keeps the stash. **Apply & remove** moves an app stash to Recently deleted, or pops a stack entry. Both are disabled while files are blocked.

If a real apply conflicts, **the stash is always kept** and the merge editor opens.

### Other stash actions

| Action                   | Effect                                                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Branch                   | Create a branch at the commit the stash was based on, switch to it and apply there (never conflicts), then remove the stash |
| Edit…                    | Rename, regroup, edit notes                                                                                                 |
| Pin / Unpin              | Keep at the top of its group                                                                                                |
| Move into app stashes…   | (stack entries) Give a git stash a name, group and stable id                                                                |
| Restore / Delete forever | (Recently deleted) Bring it back, or drop it permanently                                                                    |

---

## Merge editor

The merge editor opens in three ways:

- automatically when a stash apply conflicts
- from the banner's **Open merge editor** during a rebase, cherry-pick, revert or merge
- from the conflicts box in Changes

In **preview** mode (from Apply preview), it is read-only.

**Layout**

- **Left:** conflicted files (● unresolved, ✓ resolved). **×** closes the editor.
- **Tabs:**
  - **Result** is where you resolve.
  - **Current**, **Incoming** and **Base** show the full file versions with line numbers.
- **Each conflict** shows Current and Incoming side by side, with the common **Base** below when git provides it. Stash applies and previews always include it. Choose one of:
  - **Current**
  - **Incoming**
  - **Both** (current then incoming)
  - **Base**
  - **Edit**, to write the result yourself with live syntax highlighting
  - **×** undoes the choice.
- **Toolbar:** ⌃/⌄ jump between conflicts. **All current / All incoming** resolve every block at once. **Edit as text** edits the whole file.

**Saving**

- **Save & mark resolved** writes the file and stages it (`git add`). It refuses while conflict markers remain.
- **Take current file / Take incoming file** resolve the whole file with one side.
- Modify/delete conflicts and binary files offer **Keep current**, **Keep incoming** or **Delete file** instead.
- When every file is resolved the editor closes. During a rebase, cherry-pick or merge, press **Continue** in the banner.

**What "Current" and "Incoming" mean**

| Situation               | Current                     | Incoming                  |
| ----------------------- | --------------------------- | ------------------------- |
| Stash apply             | Your branch / workspace     | The stash                 |
| Rebase (History editor) | The rewritten branch so far | The commit being replayed |
| Cherry-pick / revert    | Your branch                 | The commit being applied  |
| Merge / pull            | Your branch                 | The branch being merged   |

---

## Branches, remotes and tags

Every sidebar item has a right-click menu.

| Item                                  | Actions                                                                                                                                                                       |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Branch** (double-click = check out) | Check out · Push to… · Edit history… · New branch from here… · Rename… · Set upstream… · Copy name · Delete… (backed up first; asks before force-deleting an unmerged branch) |
| **Remote** (+ in the header adds one) | Fetch · Edit URL… · Copy URL · Remove remote… (only removes it locally)                                                                                                       |
| **Remote branch**                     | Check out as local branch… · New branch from here… · Push something to this branch… · Edit history… · Copy name · Delete on _remote_…                                         |
| **Tag**                               | Show in graph · New branch from tag… · Push to _remote_ · Copy name · Delete local tag… · Delete on _remote_…                                                                 |

- Branch rows show ↑ahead ↓behind their upstream, or `gone` if the upstream was deleted.
- **Tag here…** on a commit creates a lightweight or **annotated** tag; annotated tags can have a **custom tagger date**.
- Toolbar: **Fetch** fetches all remotes or one, pruning deleted branches. **Pull** offers fast-forward only, merge or rebase.

## Cherry-pick, revert, reset

These are available from the commit menu.

- **Cherry-pick / Revert:** conflicts stop the operation and show the banner.
- **Reset** modes:

  | Mode  | Effect                                                  |
  | ----- | ------------------------------------------------------- |
  | soft  | Keep the index and working tree                         |
  | mixed | Keep the working tree                                   |
  | keep  | Refuses if local changes would be lost                  |
  | hard  | Discards all local changes, after an extra confirmation |

  A backup of the branch position is taken first.

---

## Reflog, backups and undo

**Backups** (sidebar)

- Before Git Pro moves or deletes a branch it records the old position. That covers an in-place rewrite, an in-place rebase, a reset, a branch delete, or restoring a backup.
- The ref is `refs/git-pro/backups/<time>-<reason>/<branch>`.
- Each backup can be **Restored** in one of two ways:
  - as a **new branch**
  - by **moving the original branch back**. A backup of its current position is kept, and if the branch is checked out, `git reset --keep` is used so local changes are never lost.
- Backups are local only; they are never pushed. **Delete** removes them when you no longer need them.

**Reflog** (sidebar)

- Shows the last 500 positions of `HEAD` or any branch.
- Right-click an entry → **Show commit**, **New branch here…**, **Reset … to here…**, **Copy SHA**.

**Undo cheat-sheet**

| You did                             | To undo                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------- |
| Rewrote history into a new branch   | Delete that branch; the original is untouched                             |
| Rewrote / rebased a branch in place | Backups → the `rewrite` / `rebase` entry → Restore → move the branch back |
| Reset a branch                      | Backups → `reset` entry, or Reflog                                        |
| Deleted a branch                    | Backups → `delete` entry → Restore                                        |
| Applied & removed a stash           | Stashes → Recently deleted → Restore                                      |
| A rebase went wrong midway          | Banner → **Abort**                                                        |
| Force-pushed                        | Push the backup branch again (with Force)                                 |

---

## Syntax highlighting and view settings

Highlighting appears in every diff (commits, working tree, stashes, apply previews) and throughout the merge editor, including while you type in it.

- The language is detected from the file name (extension, or names like `Dockerfile` and `Makefile`). The diff header shows it.
- It uses VS Code's TextMate grammars via [Shiki](https://shiki.style), with 200+ languages. Each language loads the first time a file of that type is shown.
- **Changed-word marks:** in modified lines, the words that actually changed get a stronger red/green background.
- Very large diffs (over 8,000 lines on one side) and very long lines (over 2,000 characters) are shown as plain text to stay fast.

**View** in the toolbar (or ⌘, — also in the **View** menu) holds the per-machine settings:

| Setting                          | Default                                                                                                                                             |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Syntax highlighting on/off       | On                                                                                                                                                  |
| Theme                            | GitHub Dark. Others: GitHub Dimmed, VS Code Dark+, One Dark Pro, Vitesse, Tokyo Night, Catppuccin Mocha, Nord, Rosé Pine, Kanagawa, Vesper, Minimal |
| Highlight changed words in diffs | On                                                                                                                                                  |
| Wrap long lines in diffs         | On                                                                                                                                                  |
| Side-by-side diffs               | Off. When on, every diff shows the old version on the left and the new version on the right, with each changed line next to its replacement         |

## Command log

**Log** in the toolbar opens a panel listing every git command Git Pro ran, with its exit code and duration.

- Click an entry to see its stdout and stderr.
- **Changes & errors only** hides read-only commands.
- The status bar always shows the last command and live progress for fetch, push and clone.

## Menu bar and keyboard shortcuts

Every action is available from the menu bar. Items are enabled only when they make sense: they need an open repository, a selected commit or stash, changes to stage, an upstream to pull from, and so on. Their labels name what they act on, for example **Rename “main”…** or **Continue Rebase**. **Help → Keyboard Shortcuts** (⌘/) shows all shortcuts in the app.

| Menu                | Items                                                                                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Git Pro** (macOS) | About Git Pro (shows the app and git versions) · Settings… · Hide / Quit                                                                                                                                                                                           |
| **File**            | New Repository… · Open Repository… · Clone Repository… · Open Recent ▸ (with Clear Menu) · Reveal in Finder · Close Repository · Close Window (on Windows/Linux: Settings… and Exit)                                                                               |
| **Edit**            | Undo · Redo · Cut · Copy · Paste · Select All · Find Commits…                                                                                                                                                                                                      |
| **View**            | Commit Graph · Changes (_n_) · Stashes · History Editor · Reflog · Backups · Command Log · Refresh · Syntax Highlighting · Highlight Changed Words · Wrap Long Lines in Diffs · Syntax Theme ▸ · zoom · full screen · Reload Window                                |
| **Repository**      | Fetch All Remotes · Fetch ▸ (one remote) · Pull (Fast-forward Only / Merge / Rebase) · Push… · Edit History… · Resolve Conflicts… · Continue / Skip / Abort the rebase, merge, cherry-pick or revert in progress · Add Remote…                                     |
| **Branch**          | New Branch… · Check Out ▸ (all local branches, current one ticked) · Rename… · Set Upstream… · Push… · Show in Graph                                                                                                                                               |
| **Changes**         | Commit… (jumps to the commit box) · Amend Last Commit… · Stage All · Unstage All · Discard All Changes…                                                                                                                                                            |
| **Commit**          | Acts on the commit selected in the graph (shown at the top of the menu): Edit Date / Author / Message… · Push Commit to Remote Branch… · New Branch from Commit… · Tag Commit… · Check Out Commit (Detached)… · Cherry-pick · Revert · Reset to Commit… · Copy SHA |
| **Stash**           | New Stash… · Stash Staged Changes… · then, for the stash selected in the Stashes view: Preview Applying… · Apply · Apply and Remove                                                                                                                                |
| **Window**          | Minimize · Zoom · window list                                                                                                                                                                                                                                      |
| **Help**            | Git Pro Documentation (opens this README) · Keyboard Shortcuts                                                                                                                                                                                                     |

### Shortcuts

macOS keys are shown; on Windows and Linux use **Ctrl** instead of **⌘**.

| Keys | Action                   |     | Keys    | Action                                                        |
| ---- | ------------------------ | --- | ------- | ------------------------------------------------------------- |
| ⌘O   | Open repository          |     | ⌘1 … ⌘6 | Graph · Changes · Stashes · History editor · Reflog · Backups |
| ⇧⌘O  | Clone repository         |     | ⌘F      | Find commits                                                  |
| ⌘N   | New repository           |     | ⌘L      | Command log                                                   |
| ⇧⌘W  | Close repository         |     | ⌘R      | Refresh the repository                                        |
| ⇧⌘F  | Reveal in Finder         |     | ⌥⌘R     | Reload the window                                             |
| ⇧⌘T  | Fetch all remotes        |     | ⇧⌘E     | Edit history                                                  |
| ⇧⌘P  | Pull (fast-forward only) |     | ⌘E      | Edit the selected commit                                      |
| ⌘P   | Push…                    |     | ⇧⌘C     | Copy the selected commit's SHA                                |
| ⇧⌘N  | New branch               |     | ⇧⌘M     | Resolve conflicts                                             |
| ⇧⌘R  | Rename current branch    |     | ⌘K      | Go to the commit message box                                  |
| ⇧⌘A  | Stage all                |     | ⇧⌘S     | New stash                                                     |
| ⌘,   | Settings (code display)  |     | ⌘/      | Keyboard shortcuts                                            |

Inside views:

| Keys        | Where                                      | Action                        |
| ----------- | ------------------------------------------ | ----------------------------- |
| ⌘↵ / Ctrl+↵ | Commit box                                 | Commit                        |
| ↑ / ↓       | Commit graph (after clicking it)           | Move selection                |
| Enter / Esc | Date fields                                | Apply / cancel the typed date |
| Tab         | Merge editor's edit areas                  | Insert two spaces             |
| Enter       | Form dialogs (branch, tag, stash, remote…) | Submit                        |
| Esc         | Dialogs, menus, popovers                   | Close                         |

Shortcuts only fire when their menu item is enabled. For example, ⌘E does nothing until a commit is selected.

---

## Where Git Pro stores things

| What                           | Where                                                                                                            |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Recent repositories            | `~/Library/Application Support/<app name>/settings.json`                                                         |
| View settings (theme, toggles) | The app's local storage                                                                                          |
| App stashes                    | `refs/git-pro/stashes/<id>` in each repository                                                                   |
| Recently deleted stashes       | `refs/git-pro/stash-trash/<id>`                                                                                  |
| Stash names, groups, notes     | `.git/git-pro/stashes.json`. If lost, stashes are still listed, with names recovered from their commit messages. |
| Backups                        | `refs/git-pro/backups/…`                                                                                         |
| Rebase helper scripts          | `.git/git-pro/rebase-*/` (removed after success, older than 7 days cleaned up)                                   |

All `refs/git-pro/*` refs are local. They are not pushed by `git push` and they keep the referenced commits safe from garbage collection. Inspect them from a terminal with:

```bash
git for-each-ref refs/git-pro
```

---

## Troubleshooting

**Push or fetch fails with an authentication error**

- Git Pro never shows password prompts, so git cannot ask interactively.
- Use SSH keys loaded in your agent. On macOS: `ssh-add --apple-use-keychain ~/.ssh/id_ed25519`.
- Or use HTTPS with a credential helper (`git config --global credential.helper osxkeychain`). Push once from a terminal to save the credentials.

**The app uses a different git than my terminal**

- At startup Git Pro reads `PATH` from your login shell, so Homebrew git is found even when the app is launched from Finder.
- Check `which git` in a new terminal.

**Signed commits / "Re-sign commits" fails**

- Signing has no terminal for a passphrase prompt. Use `pinentry-mac` for GPG, or an SSH signing key held by your agent.

**A commit hook fails because it needs a terminal**

- Use **More → Skip hooks** in the commit box.

**"The stash stack changed. Refresh and try again."**

- A `stash@{n}` index moved because something else added or dropped a stash. Refresh and retry.

**"_branch_ moved since the editor was opened"**

- The branch got new commits after you opened the History editor. Click **Reload**.

**A rebase stopped with "exec failed"**

- A step that applies your date, author or message edits failed. The banner shows the in-progress rebase.
- Fix the cause (shown in the Log), then **Continue**, or **Abort**.

**The History editor refuses to reorder**

- The range contains merge commits. Narrow the range, or only edit metadata.

**Electron fails to download during `npm install`**

- Run `npx install-electron` again; GitHub release downloads are occasionally unavailable.

**"git merge-tree" errors in Apply preview**

- Git is older than 2.40. Update git.

## Limits and known gaps

- Staging is per file; there is no hunk- or line-level staging yet.
- The History editor handles at most 2,000 commits per range. The graph loads up to 5,000 commits.
- Reordering, squashing and dropping are not supported across merge commits.
- Dark theme only. One window, one repository at a time.
- No dedicated UI for submodules, worktrees, LFS or bisect. The banner can still abort a bisect.
- Built and tested on macOS only.

---

## Development

### Scripts

| Command                           | Purpose                                                                                                                                                     |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                     | Run with hot reload                                                                                                                                         |
| `npm run typecheck`               | TypeScript for main/preload/shared/tests and for the renderer                                                                                               |
| `npm run lint` / `npm run format` | ESLint / Prettier                                                                                                                                           |
| `npm test`                        | Vitest: git engine, stash, merge, highlighting and word-diff tests against **real temporary repositories**, with a bare repository as the remote            |
| `npm run test:e2e`                | Builds the app and drives it with Playwright (open a repo → retime → push; stash → preview → apply; conflict → merge editor; highlighting; native menu bar) |
| `npm run build:mac`               | Package a `.dmg`                                                                                                                                            |

The tests isolate git with a temporary `HOME` and `GIT_CONFIG_GLOBAL`, so your own git config (signing, hooks) does not interfere.

### Architecture

```
src/shared/      Types, the IPC contract (api.ts), menu contract (menu.ts: commands, state,
                 shortcuts), date and push helpers used by both sides
src/main/        Electron main process
  index.ts         Window (sandboxed renderer, context isolation), startup
  ipc.ts           One IPC channel; dispatches to the handler map; repo allowlist
  watcher.ts       Watches the repo and .git; tells the UI what changed (refs vs worktree)
  store.ts         Recent repositories
  menu.ts          Installs the application menu, forwards clicks to the renderer, window title
  menuTemplate.ts  Pure function: menu state → menu template (unit-tested)
  git/
    runner.ts      Spawns git (no shell), per-repo write queue, command log, progress
    parse.ts       Parsers for log, status v2, cat-file, diff
    log.ts         Graph, commit details, refs snapshot
    worktree.ts    Status, stage/unstage/discard, commit
    rewrite.ts     Metadata engine (git commit-tree)
    rebase.ts      Structural engine (git rebase -i with a generated todo)
    history.ts     Range loading and engine selection
    stash.ts       App stashes, stack stashes, apply preview (git merge-tree)
    stashStore.ts  Stash metadata file
    merge.ts       Conflict versions and resolution
    backup.ts      Backup refs
    opstate.ts     In-progress rebase/merge/cherry-pick/revert detection and control
    branches.ts, remotes.ts, commits.ts, tags.ts, reflog.ts
src/preload/     Exposes window.gitPro { invoke, on }
src/renderer/    React UI
  lib/             api (typed call), queries (React Query), store (UI state), actions,
                   menuBridge (reports menu state, runs menu commands), highlight (Shiki),
                   wordDiff, patch parser, settings, dialogs
  components/      graph, commit, changes, history, push, stash, merge, code, layout, views
tests/           *.test.ts (Vitest) and e2e/ (Playwright)
```

**Security**

- The renderer has no Node access.
- It can only call the methods in `GitProApi`, and only for repositories the user opened through a dialog or the recent list.
- Git runs with argument arrays, never through a shell, and with `GIT_TERMINAL_PROMPT=0`.

### Adding a git operation

1. Declare the method in `GitProApi` in `src/shared/api.ts`.
2. Implement it in a module under `src/main/git/`. Pass `{ write: true }` to `git()` for commands that change the repository.
3. Register it in the `handlers` map in `src/main/ipc.ts`, wrapping the repo id with `repo(repoId)`.
4. Call it from the renderer with `call('your.method', repoId, …)`. Usually you wrap it with `run()` from `lib/actions.ts` for toasts and refresh.
5. Add a Vitest test that runs it against a temporary repository (see `tests/helpers/tmpRepo.ts`).

### Adding a menu command

1. Add the id to `MenuCommand` in `src/shared/menu.ts`. If it has a shortcut, add it to `ACCELERATORS` and `SHORTCUT_GROUPS`.
2. Add the item in `src/main/menuTemplate.ts` with `cmd(...)` and an `enabled` rule based on `MenuState`. If the rule needs new information, add a field to `MenuState` and fill it in `useMenuState()` in `lib/menuBridge.ts`.
3. Handle the command in `runMenuCommand()` in `lib/menuBridge.ts`.
4. `tests/menu.test.ts` fails on duplicate or undocumented shortcuts. `tests/e2e/menu.spec.ts` shows how to click real menu items from Playwright.

### Test hooks

| Variable                  | Effect                                         |
| ------------------------- | ---------------------------------------------- |
| `GITPRO_USER_DATA=<dir>`  | Use a separate settings folder                 |
| `GITPRO_SEED_REPO=<path>` | Add a repository to the recent list at startup |
| `GITPRO_SHOTS=<dir>`      | (E2E) Save screenshots of each step            |
