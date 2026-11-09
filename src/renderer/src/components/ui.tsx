import * as ContextMenu from '@radix-ui/react-context-menu'
import * as Dialog from '@radix-ui/react-dialog'
import * as Dropdown from '@radix-ui/react-dropdown-menu'
import { TZ_OPTIONS, fromInputValue, localTz, toInputValue } from '@shared/dates'
import type { GitDate } from '@shared/types'
import { CalendarDays, ChevronRight, X } from 'lucide-react'
import {
  forwardRef,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes
} from 'react'
import { cx } from '../lib/format'

type Variant = 'default' | 'primary' | 'danger' | 'ghost'

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: Variant
    size?: 'sm' | 'md'
    icon?: ReactNode
  }
>(function Button({ variant = 'default', size = 'md', icon, className, children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md border font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        size === 'sm' ? 'h-6 px-2 text-xs' : 'h-7 px-2.5 text-[13px]',
        variant === 'primary' && 'border-accent-strong bg-accent-strong text-white hover:bg-accent',
        variant === 'danger' && 'border-bad/60 bg-bad/15 text-bad hover:bg-bad/25',
        variant === 'default' && 'border-line-strong bg-panel-2 text-fg hover:bg-hover',
        variant === 'ghost' &&
          'border-transparent bg-transparent text-muted hover:bg-hover hover:text-fg',
        className
      )}
    >
      {icon}
      {children}
    </button>
  )
})

export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
  title
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: ReactNode
  disabled?: boolean
  title?: string
}) {
  return (
    <label
      title={title}
      className={cx(
        'inline-flex cursor-pointer items-center gap-1.5 text-[13px]',
        disabled && 'opacity-40'
      )}
    >
      <input
        type="checkbox"
        className="accent-accent-strong"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  )
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cx('field pr-6', className)}>
      {children}
    </select>
  )
}

export function Badge({
  children,
  color = 'default',
  title
}: {
  children: ReactNode
  color?: 'default' | 'branch' | 'current' | 'remote' | 'tag' | 'head' | 'warn'
  title?: string
}) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex h-[18px] max-w-[220px] shrink-0 items-center truncate rounded px-1.5 text-[11px] leading-none font-medium',
        color === 'default' && 'bg-line text-muted',
        color === 'branch' && 'bg-accent/15 text-accent',
        color === 'current' && 'bg-accent-strong text-white',
        color === 'remote' && 'bg-ok/15 text-ok',
        color === 'tag' && 'bg-warn/15 text-warn',
        color === 'head' && 'bg-bad/20 text-bad',
        color === 'warn' && 'bg-warn/20 text-warn'
      )}
    >
      {children}
    </span>
  )
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 520
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: number
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/55" />
        <Dialog.Content
          style={{ width }}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[88vh] max-w-[95vw] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-line-strong bg-panel shadow-2xl outline-none"
          onOpenAutoFocus={(e) => {
            const el = (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>(
              '[data-autofocus]'
            )
            if (el) {
              e.preventDefault()
              el.focus()
            }
          }}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
            <div>
              <Dialog.Title className="text-[14px] font-semibold">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-0.5 text-xs text-muted">
                  {description}
                </Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{String(title)}</Dialog.Description>
              )}
            </div>
            <Dialog.Close className="rounded p-1 text-muted hover:bg-hover hover:text-fg">
              <X size={14} />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-4 py-3">{children}</div>
          {footer && (
            <div className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/* ---------- menus ---------- */

const menuContent =
  'z-50 min-w-[220px] rounded-md border border-line-strong bg-panel-2 p-1 text-[13px] shadow-xl'
const menuItem =
  'flex h-7 cursor-default items-center gap-2 rounded px-2 outline-none select-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent-strong data-[highlighted]:text-white'

export interface MenuEntry {
  label?: string
  icon?: ReactNode
  onSelect?: () => void
  danger?: boolean
  disabled?: boolean
  separator?: boolean
  sub?: MenuEntry[]
  hint?: string
}

function ContextEntries({ entries }: { entries: MenuEntry[] }) {
  return (
    <>
      {entries.map((e, i) =>
        e.separator ? (
          <ContextMenu.Separator key={i} className="my-1 h-px bg-line" />
        ) : e.sub ? (
          <ContextMenu.Sub key={i}>
            <ContextMenu.SubTrigger className={menuItem}>
              {e.icon}
              <span className="flex-1">{e.label}</span>
              <ChevronRight size={12} />
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className={menuContent}>
                <ContextEntries entries={e.sub} />
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>
        ) : (
          <ContextMenu.Item
            key={i}
            disabled={e.disabled}
            onSelect={e.onSelect}
            className={cx(menuItem, e.danger && 'text-bad data-[highlighted]:bg-bad')}
          >
            {e.icon}
            <span className="flex-1 truncate">{e.label}</span>
            {e.hint && <span className="text-[11px] opacity-60">{e.hint}</span>}
          </ContextMenu.Item>
        )
      )}
    </>
  )
}

export function WithContextMenu({
  entries,
  children
}: {
  entries: () => MenuEntry[]
  children: ReactNode
}) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={menuContent}>
          <ContextEntries entries={entries()} />
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

function DropdownEntries({ entries }: { entries: MenuEntry[] }) {
  return (
    <>
      {entries.map((e, i) =>
        e.separator ? (
          <Dropdown.Separator key={i} className="my-1 h-px bg-line" />
        ) : e.sub ? (
          <Dropdown.Sub key={i}>
            <Dropdown.SubTrigger className={menuItem}>
              {e.icon}
              <span className="flex-1">{e.label}</span>
              <ChevronRight size={12} />
            </Dropdown.SubTrigger>
            <Dropdown.Portal>
              <Dropdown.SubContent className={menuContent}>
                <DropdownEntries entries={e.sub} />
              </Dropdown.SubContent>
            </Dropdown.Portal>
          </Dropdown.Sub>
        ) : (
          <Dropdown.Item
            key={i}
            disabled={e.disabled}
            onSelect={e.onSelect}
            className={cx(menuItem, e.danger && 'text-bad data-[highlighted]:bg-bad')}
          >
            {e.icon}
            <span className="flex-1 truncate">{e.label}</span>
            {e.hint && <span className="text-[11px] opacity-60">{e.hint}</span>}
          </Dropdown.Item>
        )
      )}
    </>
  )
}

export function DropdownButton({
  trigger,
  entries,
  align = 'start'
}: {
  trigger: ReactNode
  entries: MenuEntry[]
  align?: 'start' | 'end'
}) {
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>{trigger}</Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align={align} sideOffset={4} className={menuContent}>
          <DropdownEntries entries={entries} />
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  )
}

/* ---------- date + timezone field ---------- */

const DATE_TEXT = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/

/** Parses "YYYY-MM-DD HH:mm[:ss]" as wall-clock time in `tz`. */
function parseDateText(text: string, tz: string): GitDate | null {
  const m = DATE_TEXT.exec(text.trim())
  if (!m) return null
  try {
    return fromInputValue(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}`, tz)
  } catch {
    return null
  }
}

/**
 * Exact git date editor: monospace "YYYY-MM-DD HH:mm:ss" (independent of OS locale) + UTC offset,
 * with a native picker on demand. Commits on Enter/blur.
 */
export function DateField({
  value,
  onChange,
  disabled,
  changed
}: {
  value: GitDate
  onChange: (d: GitDate) => void
  disabled?: boolean
  compact?: boolean
  changed?: boolean
}) {
  const display = toInputValue(value).replace('T', ' ')
  const [draft, setDraft] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  const invalid = draft !== null && parseDateText(draft, value.tz) === null
  const tzs = TZ_OPTIONS.includes(value.tz) ? TZ_OPTIONS : [...TZ_OPTIONS, value.tz].sort()
  const commit = (): void => {
    if (draft === null) return
    const d = parseDateText(draft, value.tz)
    setDraft(null)
    if (d && d.ts !== value.ts) onChange(d)
  }
  return (
    <div className="flex items-center gap-1">
      <div className="relative">
        <input
          data-date
          disabled={disabled}
          spellCheck={false}
          title="YYYY-MM-DD HH:mm:ss — press Enter to apply"
          className={cx(
            'field mono w-[172px] pr-6',
            changed && 'border-edit/70 text-edit',
            invalid && 'border-bad text-bad'
          )}
          value={draft ?? display}
          onFocus={() => setDraft(display)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit()
              e.currentTarget.blur()
            } else if (e.key === 'Escape') {
              setDraft(null)
              e.currentTarget.blur()
            }
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          title="Pick date"
          className="absolute top-1/2 right-1 -translate-y-1/2 rounded p-0.5 text-faint hover:text-fg"
          onClick={() => picker.current?.showPicker()}
        >
          <CalendarDays size={12} />
        </button>
        <input
          ref={picker}
          type="datetime-local"
          step={1}
          tabIndex={-1}
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-0 h-0 w-0 opacity-0"
          value={toInputValue(value)}
          onChange={(e) => {
            if (!e.target.value) return
            try {
              onChange(fromInputValue(e.target.value, value.tz))
            } catch {
              // incomplete value
            }
          }}
        />
      </div>
      <select
        className={cx('field mono w-[74px] px-1', changed && 'border-edit/70')}
        disabled={disabled}
        value={value.tz}
        title="UTC offset. Changing it keeps the wall-clock time and moves the instant."
        onChange={(e) => onChange(fromInputValue(toInputValue(value), e.target.value))}
      >
        {tzs.map((tz) => (
          <option key={tz} value={tz}>
            {tz}
            {tz === localTz() ? ' •' : ''}
          </option>
        ))}
      </select>
    </div>
  )
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <span
      style={{ width: size, height: size }}
      className="inline-block animate-spin rounded-full border-2 border-muted/40 border-t-accent"
    />
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center text-muted">
      {children}
    </div>
  )
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex h-7 items-center justify-between px-3 text-[11px] font-semibold tracking-wide text-faint uppercase">
      <span>{children}</span>
      {right}
    </div>
  )
}
