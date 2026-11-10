import { ChevronDown, ChevronRight, Folder, FolderOpen, FolderTree, List } from 'lucide-react'
import { Fragment, useState, type ReactNode } from 'react'
import { buildFileTree, rowIndent, visibleRows } from '../lib/fileTree'
import { cx } from '../lib/format'
import { useViewSettings } from '../lib/settings'

/**
 * Switches every changed-file list between one flat list and a folder tree (remembered).
 * The icon shows the layout a click switches to.
 */
export function FileListModeToggle({ className }: { className?: string }) {
  const tree = useViewSettings((s) => s.fileListMode === 'tree')
  const set = useViewSettings((s) => s.set)
  const label = tree ? 'Show as flat list' : 'Group by folder'
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation()
        set({ fileListMode: tree ? 'list' : 'tree' })
      }}
      className={cx('shrink-0 rounded p-1 text-muted hover:bg-hover hover:text-fg', className)}
    >
      {tree ? <List size={13} /> : <FolderTree size={13} />}
    </button>
  )
}

/**
 * Renders changed files either flat (in the given order) or grouped into collapsible folders,
 * following the remembered `fileListMode`. Folder rows can carry the same controls as file rows,
 * applied to every file inside them.
 */
export function FileList<T>({
  items,
  pathOf,
  keyOf = pathOf,
  renderFile,
  dirLeading,
  dirActions
}: {
  items: readonly T[]
  pathOf: (t: T) => string
  keyOf?: (t: T) => string
  /** `depth` is 0 in the flat list; `tree` means the row should show only the file's base name. */
  renderFile: (item: T, row: { depth: number; tree: boolean }) => ReactNode
  /** Shown before a folder row (e.g. a checkbox for all its files). */
  dirLeading?: (files: T[]) => ReactNode
  /** Shown on hover at the right of a folder row. */
  dirActions?: (files: T[]) => ReactNode
}) {
  const mode = useViewSettings((s) => s.fileListMode)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())

  if (mode === 'list')
    return (
      <>
        {items.map((item) => (
          <Fragment key={keyOf(item)}>{renderFile(item, { depth: 0, tree: false })}</Fragment>
        ))}
      </>
    )

  const toggle = (path: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (!next.delete(path)) next.add(path)
      return next
    })

  return (
    <>
      {visibleRows(buildFileTree(items, pathOf), collapsed).map(({ node, depth }) => {
        if (node.kind === 'file')
          return (
            <Fragment key={`f:${keyOf(node.item)}`}>
              {renderFile(node.item, { depth, tree: true })}
            </Fragment>
          )
        const open = !collapsed.has(node.path)
        return (
          <div key={`d:${node.path}`} className="group/dir flex items-center">
            {dirLeading?.(node.files)}
            <div
              role="button"
              aria-expanded={open}
              title={node.path}
              onClick={() => toggle(node.path)}
              style={{ paddingLeft: rowIndent(depth) }}
              className="flex h-[24px] min-w-0 flex-1 cursor-default items-center gap-1.5 pr-2 hover:bg-hover"
            >
              {open ? (
                <ChevronDown size={12} className="shrink-0 text-faint" />
              ) : (
                <ChevronRight size={12} className="shrink-0 text-faint" />
              )}
              {open ? (
                <FolderOpen size={13} className="shrink-0 text-muted" />
              ) : (
                <Folder size={13} className="shrink-0 text-muted" />
              )}
              <span className="min-w-0 flex-1 truncate text-muted">{node.name}</span>
              {dirActions && (
                <span
                  className="hidden gap-0.5 group-hover/dir:flex"
                  onClick={(e) => e.stopPropagation()}
                >
                  {dirActions(node.files)}
                </span>
              )}
              <span className="text-[11px] text-faint tabular-nums">{node.files.length}</span>
            </div>
          </div>
        )
      })}
    </>
  )
}
