import { ACCELERATORS, LOCAL_SHORTCUTS, SHORTCUT_GROUPS, prettyAccelerator } from '@shared/menu'
import { useUi } from '../../lib/store'
import { Modal } from '../ui'

const MAC = /Mac/.test(navigator.userAgent)

function Keys({ accel }: { accel: string }) {
  return (
    <kbd className="mono rounded border border-line-strong bg-panel-2 px-1.5 py-0.5 text-[11px] text-fg">
      {prettyAccelerator(accel, MAC)}
    </kbd>
  )
}

export function ShortcutsDialog() {
  const open = useUi((s) => s.shortcutsOpen)
  const setOpen = useUi((s) => s.setShortcutsOpen)
  if (!open) return null
  return (
    <Modal
      open
      width={720}
      onOpenChange={setOpen}
      title="Keyboard shortcuts"
      description="Every menu shortcut also appears next to its item in the menu bar."
    >
      <div className="grid grid-cols-2 gap-x-8 gap-y-4">
        {SHORTCUT_GROUPS.map((g) => (
          <div key={g.title}>
            <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-faint uppercase">
              {g.title}
            </div>
            {g.items.map(([cmd, label]) => (
              <div key={cmd} className="flex h-7 items-center justify-between gap-3 text-[13px]">
                <span className="text-muted">{label}</span>
                {ACCELERATORS[cmd] && <Keys accel={ACCELERATORS[cmd]!} />}
              </div>
            ))}
          </div>
        ))}
        <div>
          <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-faint uppercase">
            In views
          </div>
          {LOCAL_SHORTCUTS.map((s) => (
            <div key={s.label} className="flex h-7 items-center justify-between gap-3 text-[13px]">
              <span className="text-muted">{s.label}</span>
              <Keys accel={s.keys} />
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}
