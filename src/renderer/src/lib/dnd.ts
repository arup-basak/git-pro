import type { DragEvent } from 'react'
import { create } from 'zustand'

/* Drag and drop between the commit graph and the sidebar (native HTML5 drag events). */

/** What is being dragged. */
export type DragPayload =
  | { kind: 'commit'; sha: string; subject?: string }
  | { kind: 'branch'; name: string; remote: boolean }

/** Where it can be dropped: a local branch, or a remote branch (`origin/main`). */
export type DropTarget =
  { kind: 'branch'; name: string; current: boolean } | { kind: 'remote'; short: string }

export type DropAction =
  | { kind: 'cherry-pick'; sha: string; branch: string; current: boolean }
  | { kind: 'move'; sha: string; branch: string; current: boolean }
  | { kind: 'rebase'; branch: string; onto: string }
  | { kind: 'merge'; source: string; target: string }
  | { kind: 'push'; sourceKind: 'commit' | 'branch'; source: string; remote: string; dest: string }

export interface DropChoice {
  label: string
  danger?: boolean
  action: DropAction
}

const short = (sha: string): string => sha.slice(0, 8)

export function payloadLabel(p: DragPayload): string {
  return p.kind === 'commit' ? `commit ${short(p.sha)}` : p.name
}

export function targetLabel(t: DropTarget): string {
  return t.kind === 'branch' ? t.name : t.short
}

/** The choices offered when `p` is dropped on `t` (empty: not a valid drop). */
export function dropActions(p: DragPayload, t: DropTarget): DropChoice[] {
  if (t.kind === 'remote') {
    const [remote, ...rest] = t.short.split('/')
    const dest = rest.join('/')
    if (!remote || !dest) return []
    if (p.kind === 'commit') {
      return [
        {
          label: `Push ${short(p.sha)} to ${t.short}…`,
          action: { kind: 'push', sourceKind: 'commit', source: p.sha, remote, dest }
        }
      ]
    }
    if (p.remote) return []
    return [
      {
        label: `Push ${p.name} to ${t.short}…`,
        action: { kind: 'push', sourceKind: 'branch', source: p.name, remote, dest }
      }
    ]
  }

  const b = t.name
  if (p.kind === 'commit') {
    return [
      {
        label: `Cherry-pick ${short(p.sha)} onto ${b}`,
        action: { kind: 'cherry-pick', sha: p.sha, branch: b, current: t.current }
      },
      {
        label: `Rebase ${b} onto ${short(p.sha)}…`,
        action: { kind: 'rebase', branch: b, onto: p.sha }
      },
      {
        label: t.current ? `Reset ${b} to ${short(p.sha)}…` : `Move ${b} to ${short(p.sha)}…`,
        danger: true,
        action: { kind: 'move', sha: p.sha, branch: b, current: t.current }
      }
    ]
  }
  if (p.name === b) return []
  return [
    { label: `Merge ${p.name} into ${b}…`, action: { kind: 'merge', source: p.name, target: b } },
    ...(p.remote
      ? []
      : [
          {
            label: `Rebase ${p.name} onto ${b}…`,
            action: { kind: 'rebase' as const, branch: p.name, onto: b }
          }
        ]),
    { label: `Rebase ${b} onto ${p.name}…`, action: { kind: 'rebase', branch: b, onto: p.name } }
  ]
}

interface DragState {
  payload: DragPayload | null
  /** Key of the drop target under the pointer (for highlighting). */
  over: string | null
  /** A finished drop waiting for the user to pick an action. */
  menu: { x: number; y: number; payload: DragPayload; target: DropTarget } | null
}

export const useDrag = create<DragState>(() => ({ payload: null, over: null, menu: null }))

const MIME = 'application/x-gitpro-ref'

/** Props that make an element a drag source. */
export function dragSource(payload: DragPayload) {
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.stopPropagation() // a badge inside a draggable row wins over the row
      e.dataTransfer.setData(MIME, JSON.stringify(payload))
      e.dataTransfer.setData('text/plain', payload.kind === 'commit' ? payload.sha : payload.name)
      e.dataTransfer.effectAllowed = 'copyMove'
      useDrag.setState({ payload, over: null })
    },
    onDragEnd: () => useDrag.setState({ payload: null, over: null })
  }
}

function payloadOf(e: DragEvent): DragPayload | null {
  const p = useDrag.getState().payload
  if (p) return p
  try {
    return JSON.parse(e.dataTransfer.getData(MIME)) as DragPayload
  } catch {
    return null
  }
}

/** Props that make an element a drop target; `key` identifies it for highlighting. */
export function dropTarget(target: DropTarget, key: string) {
  return {
    onDragOver: (e: DragEvent) => {
      const p = useDrag.getState().payload
      if (!p || dropActions(p, target).length === 0) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (useDrag.getState().over !== key) useDrag.setState({ over: key })
    },
    onDragLeave: () => {
      if (useDrag.getState().over === key) useDrag.setState({ over: null })
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const payload = payloadOf(e)
      useDrag.setState({ payload: null, over: null })
      if (payload && dropActions(payload, target).length) {
        useDrag.setState({ menu: { x: e.clientX, y: e.clientY, payload, target } })
      }
    }
  }
}

/** True while a valid drag hovers the target with this key. */
export function useDropHover(key: string): boolean {
  return useDrag((s) => s.over === key)
}
