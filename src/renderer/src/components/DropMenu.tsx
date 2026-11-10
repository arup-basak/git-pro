import { useEffect } from 'react'
import { runDropAction } from '../lib/actions'
import { dropActions, payloadLabel, targetLabel, useDrag } from '../lib/dnd'
import { PointerMenu, type MenuEntry } from './ui'

/** Shows the choices after something is dropped on a branch, and clears stale drags. */
export function DropMenuHost() {
  const menu = useDrag((s) => s.menu)
  useEffect(() => {
    // A drag can end anywhere (or its source row can scroll out and unmount).
    const clear = (): void => {
      if (useDrag.getState().payload) useDrag.setState({ payload: null, over: null })
    }
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    return () => {
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', clear)
    }
  }, [])
  if (!menu) return null
  const entries: MenuEntry[] = [
    { label: `${payloadLabel(menu.payload)} → ${targetLabel(menu.target)}`, disabled: true },
    { separator: true },
    ...dropActions(menu.payload, menu.target).map((c) => ({
      label: c.label,
      danger: c.danger,
      onSelect: () => void runDropAction(c.action)
    }))
  ]
  return (
    <PointerMenu
      at={{ x: menu.x, y: menu.y }}
      entries={entries}
      onClose={() => useDrag.setState({ menu: null })}
    />
  )
}
