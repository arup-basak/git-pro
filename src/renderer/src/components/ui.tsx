import * as ContextMenu from '@radix-ui/react-context-menu'
import * as Dialog from '@radix-ui/react-dialog'
import * as Dropdown from '@radix-ui/react-dropdown-menu'
import * as Popover from '@radix-ui/react-popover'
import * as SelectPrimitive from '@radix-ui/react-select'
import { TZ_OPTIONS, fromInputValue, localTz, toInputValue } from '@shared/dates'
import type { GitDate } from '@shared/types'
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react'
import {
  forwardRef,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode
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

export interface SelectOption<T extends string = string> {
  value: T
  label: ReactNode
  /** Faint text on the right of the list row (not shown in the closed field). */
  hint?: string
  disabled?: boolean
  title?: string
}

/** Radix forbids "" as an item value, but our forms use it ("(none)", "Custom…"). */
const EMPTY_VALUE = '\u0000'
const toItemValue = (v: string): string => (v === '' ? EMPTY_VALUE : v)
const fromItemValue = (v: string): string => (v === EMPTY_VALUE ? '' : v)

/** Single-choice dropdown drawn by the app (not the OS menu). */
export function Select<T extends string>({
  value,
  onChange,
  options,
  className,
  disabled,
  title,
  placeholder = '—',
  mono,
  'aria-label': ariaLabel
}: {
  value: T
  onChange: (v: T) => void
  options: ReadonlyArray<SelectOption<T>>
  className?: string
  disabled?: boolean
  title?: string
  placeholder?: string
  mono?: boolean
  'aria-label'?: string
}) {
  const selected = options.find((o) => o.value === value)
  return (
    <SelectPrimitive.Root
      value={toItemValue(value)}
      onValueChange={(v) => onChange(fromItemValue(v) as T)}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        title={title}
        aria-label={ariaLabel}
        className={cx(
          'field flex min-w-0 items-center justify-between gap-1 pr-1.5 text-left disabled:cursor-not-allowed disabled:opacity-40 data-[state=open]:border-accent',
          mono && 'mono',
          className
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder}>
          <span className="block truncate">{selected?.label}</span>
        </SelectPrimitive.Value>
        <SelectPrimitive.Icon className="shrink-0 text-faint">
          <ChevronDown size={12} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className={cx(
            menuContent,
            'flex max-h-[min(360px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] flex-col',
            mono && 'mono'
          )}
        >
          <SelectPrimitive.Viewport>
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={toItemValue(o.value)}
                disabled={o.disabled}
                title={o.title}
                className={cx(menuItem, 'relative pl-6')}
              >
                <SelectPrimitive.ItemIndicator className="absolute left-1.5 flex">
                  <Check size={12} />
                </SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                {o.hint && <span className="ml-auto pl-3 text-[11px] opacity-60">{o.hint}</span>}
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}

export interface ComboOption {
  value: string
  /** Extra description shown next to the value in the list. */
  label?: string
}

const COMBO_LIMIT = 200

/**
 * A free-text field with app-drawn suggestions (replaces `<datalist>`). Typing filters the list
 * (prefix matches first); ↑/↓ + Enter or a click picks one. Enter with nothing highlighted, or any
 * value not in the list, is left to the caller.
 */
export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  className,
  mono,
  autoFocus,
  disabled
}: {
  value: string
  onChange: (v: string) => void
  options: ReadonlyArray<ComboOption>
  placeholder?: string
  className?: string
  mono?: boolean
  autoFocus?: boolean
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  /** True once the user types; false shows every option (e.g. after picking one). */
  const [filtering, setFiltering] = useState(false)
  const [active, setActive] = useState(-1)
  const anchor = useRef<HTMLDivElement>(null)
  const listId = useId()

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase()
    if (!filtering || !q) return options
    const exact: ComboOption[] = []
    const prefix: ComboOption[] = []
    const rest: ComboOption[] = []
    for (const o of options) {
      const v = o.value.toLowerCase()
      const l = o.label?.toLowerCase() ?? ''
      if (v === q) exact.push(o)
      else if (v.startsWith(q) || l.startsWith(q)) prefix.push(o)
      else if (v.includes(q) || l.includes(q)) rest.push(o)
    }
    return [...exact, ...prefix, ...rest]
  }, [options, value, filtering])
  const shown = matches.slice(0, COMBO_LIMIT)
  const visible = open && shown.length > 0

  useEffect(() => {
    if (visible && active >= 0)
      document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [visible, active, listId])

  const show = (all: boolean): void => {
    if (all) setFiltering(false)
    setActive(-1)
    setOpen(true)
  }
  const pick = (o: ComboOption): void => {
    onChange(o.value)
    setFiltering(false)
    setOpen(false)
  }

  return (
    <Popover.Root open={visible} onOpenChange={(o) => !o && setOpen(false)}>
      <Popover.Anchor asChild>
        <div ref={anchor} className={cx('relative', className)}>
          <input
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={visible}
            aria-controls={visible ? listId : undefined}
            aria-activedescendant={visible && active >= 0 ? `${listId}-${active}` : undefined}
            className={cx('field w-full', options.length > 0 && 'pr-6', mono && 'mono')}
            value={value}
            placeholder={placeholder}
            disabled={disabled}
            spellCheck={false}
            autoComplete="off"
            data-autofocus={autoFocus || undefined}
            onChange={(e) => {
              onChange(e.target.value)
              setFiltering(true)
              setActive(-1)
              setOpen(true)
            }}
            onClick={() => !open && show(false)}
            onBlur={() => setOpen(false)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                if (!visible) return show(false)
                const n = shown.length
                setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % n : i <= 0 ? n - 1 : i - 1))
              } else if (e.key === 'Enter' && visible && active >= 0) {
                e.preventDefault()
                pick(shown[active])
              } else if (e.key === 'Escape' && visible) {
                // Close the list only, not the dialog around it.
                e.preventDefault()
                e.stopPropagation()
                setOpen(false)
              } else if (e.key === 'Enter' || e.key === 'Tab') {
                setOpen(false)
              }
            }}
          />
          {options.length > 0 && (
            <button
              type="button"
              tabIndex={-1}
              disabled={disabled}
              aria-label="Show suggestions"
              className="absolute top-1/2 right-1 -translate-y-1/2 rounded p-0.5 text-faint hover:text-fg"
              onMouseDown={(e) => {
                // Keep focus (and the caret) in the input.
                e.preventDefault()
                anchor.current?.querySelector('input')?.focus()
                if (visible) setOpen(false)
                else show(true)
              }}
            >
              <ChevronDown size={12} />
            </button>
          )}
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            if (anchor.current?.contains(e.target as Node)) e.preventDefault()
          }}
          // Clicks in the list (items, scrollbar) must not take focus from the input.
          onMouseDown={(e) => e.preventDefault()}
          className={cx(
            menuContent,
            'max-h-[min(280px,var(--radix-popover-content-available-height))] w-[var(--radix-popover-trigger-width)] overflow-y-auto',
            mono && 'mono'
          )}
        >
          <div role="listbox" id={listId}>
            {shown.map((o, i) => (
              <div
                key={o.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                data-highlighted={i === active || undefined}
                className={menuItem}
                onMouseMove={() => i !== active && setActive(i)}
                onClick={() => pick(o)}
              >
                <span className="min-w-0 flex-1 truncate">{o.value}</span>
                {o.label && o.label !== o.value && (
                  <span className="max-w-[55%] truncate text-[11px] opacity-60">{o.label}</span>
                )}
              </div>
            ))}
            {matches.length > shown.length && (
              <div className="px-2 py-1 text-[11px] text-faint">
                {matches.length - shown.length} more — keep typing to narrow down
              </div>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** Mutually exclusive choices shown as a row of buttons. A null `value` selects none. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className
}: {
  value: T | null
  onChange: (v: T) => void
  /** [value, label, tooltip?] */
  options: ReadonlyArray<readonly [T, string, string?]>
  className?: string
}) {
  return (
    <div role="radiogroup" className={cx('flex rounded-md border border-line p-0.5', className)}>
      {options.map(([v, label, title]) => (
        <button
          type="button"
          role="radio"
          aria-checked={value === v}
          key={v}
          title={title}
          onClick={() => onChange(v)}
          className={cx(
            'h-6 flex-1 rounded px-2 text-xs whitespace-nowrap',
            value === v ? 'bg-line-strong text-fg' : 'text-muted hover:text-fg'
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

export function Badge({
  children,
  color = 'default',
  title,
  className,
  ...rest
}: {
  children: ReactNode
  color?: 'default' | 'branch' | 'current' | 'remote' | 'tag' | 'head' | 'warn'
  title?: string
} & Omit<HTMLAttributes<HTMLSpanElement>, 'color' | 'title' | 'children'>) {
  return (
    <span
      title={title}
      {...rest}
      className={cx(
        'inline-flex h-[18px] max-w-[220px] shrink-0 items-center truncate rounded px-1.5 text-[11px] leading-none font-medium',
        className,
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
        <Dialog.Overlay className="no-drag fixed inset-0 z-40 bg-black/55" />
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

const pad2 = (n: number): string => String(n).padStart(2, '0')

interface Wall {
  y: number
  /** 0-based */
  m: number
  d: number
  H: number
  M: number
  S: number
}

function toWall(d: GitDate): Wall {
  const [date, time] = toInputValue(d).split('T')
  const [y, m, day] = date.split('-').map(Number)
  const [H, M, S] = time.split(':').map(Number)
  return { y, m: m - 1, d: day, H, M, S }
}

function fromWall(w: Wall, tz: string): GitDate {
  // Normalises overflow (e.g. day 0 or 32) through Date.UTC.
  const t = new Date(Date.UTC(w.y, w.m, w.d, w.H, w.M, w.S))
  const v =
    `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}` +
    `T${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())}:${pad2(t.getUTCSeconds())}`
  return fromInputValue(v, tz)
}

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

/** One 2-digit time part (hours/minutes/seconds); ↑/↓ step and wrap. */
function TimePart({
  value,
  max,
  label,
  onChange
}: {
  value: number
  max: number
  label: string
  onChange: (n: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input
      aria-label={label}
      inputMode="numeric"
      spellCheck={false}
      className="field mono h-6 w-8 px-0 text-center"
      value={draft ?? pad2(value)}
      onFocus={(e) => {
        setDraft(pad2(value))
        e.currentTarget.select()
      }}
      onBlur={() => setDraft(null)}
      onChange={(e) => {
        const t = e.target.value.replace(/\D/g, '').slice(-2)
        setDraft(t)
        if (t !== '' && Number(t) <= max) onChange(Number(t))
      }}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
        e.preventDefault()
        const n = (value + (e.key === 'ArrowUp' ? 1 : max) + 1) % (max + 1)
        setDraft(pad2(n))
        onChange(n)
      }}
    />
  )
}

/** Month grid + time, in the date's own UTC offset. Changes apply immediately. */
function Calendar({
  value,
  onChange,
  onDone
}: {
  value: GitDate
  onChange: (d: GitDate) => void
  onDone: () => void
}) {
  const w = toWall(value)
  const [view, setView] = useState({ y: w.y, m: w.m })
  const grid = useRef<HTMLDivElement>(null)
  const [now] = useState(() => Math.floor(Date.now() / 1000))
  const today = toWall({ ts: now, tz: value.tz })

  const set = (next: Wall): void => {
    const d = fromWall(next, value.tz)
    const nw = toWall(d)
    setView({ y: nw.y, m: nw.m })
    onChange(d)
  }
  const shiftMonth = (by: number): void => {
    const t = new Date(Date.UTC(view.y, view.m + by, 1))
    setView({ y: t.getUTCFullYear(), m: t.getUTCMonth() })
  }

  // Keep keyboard focus on the selected day as it moves.
  useEffect(() => {
    if (grid.current?.contains(document.activeElement))
      grid.current.querySelector<HTMLElement>('[data-selected]')?.focus()
  }, [value.ts])

  const first = new Date(Date.UTC(view.y, view.m, 1))
  const lead = (first.getUTCDay() + 6) % 7
  const days = Array.from({ length: 42 }, (_, i) => {
    const t = new Date(Date.UTC(view.y, view.m, 1 + i - lead))
    return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() }
  })
  const same = (a: { y: number; m: number; d: number }, b: { y: number; m: number; d: number }) =>
    a.y === b.y && a.m === b.m && a.d === b.d

  const onGridKey = (e: KeyboardEvent): void => {
    const step = {
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      ArrowUp: [0, -7],
      ArrowDown: [0, 7],
      PageUp: [-1, 0],
      PageDown: [1, 0]
    }[e.key]
    if (!step) return
    e.preventDefault()
    const m = w.m + step[0]
    // Jan 31 + 1 month → Feb 28/29, not Mar 3.
    const d = step[0] ? Math.min(w.d, new Date(Date.UTC(w.y, m + 1, 0)).getUTCDate()) : w.d
    set({ ...w, m, d: d + step[1] })
  }

  const monthLabel = new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(first)

  return (
    <div className="w-[264px]">
      <div className="mb-1.5 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          className="rounded p-1 text-muted hover:bg-hover hover:text-fg"
          onClick={() => shiftMonth(-1)}
        >
          <ChevronLeft size={14} />
        </button>
        <span className="text-[13px] font-medium">{monthLabel}</span>
        <button
          type="button"
          aria-label="Next month"
          className="rounded p-1 text-muted hover:bg-hover hover:text-fg"
          onClick={() => shiftMonth(1)}
        >
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="grid grid-cols-7 text-center text-[10px] text-faint">
        {WEEKDAYS.map((d) => (
          <span key={d} className="py-0.5">
            {d}
          </span>
        ))}
      </div>
      <div ref={grid} role="grid" className="grid grid-cols-7 gap-px" onKeyDown={onGridKey}>
        {days.map((day) => {
          const selected = same(day, w)
          return (
            <button
              key={`${day.y}-${day.m}-${day.d}`}
              type="button"
              role="gridcell"
              aria-selected={selected}
              data-selected={selected || undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => set({ ...w, ...day })}
              className={cx(
                'h-7 rounded text-xs tabular-nums outline-none focus-visible:ring-1 focus-visible:ring-accent',
                selected
                  ? 'bg-accent-strong text-white'
                  : day.m === view.m
                    ? 'text-fg hover:bg-hover'
                    : 'text-faint hover:bg-hover',
                !selected && same(day, today) && 'ring-1 ring-line-strong ring-inset'
              )}
            >
              {day.d}
            </button>
          )
        })}
      </div>
      <div className="mt-2 flex items-center gap-1 border-t border-line pt-2">
        <TimePart label="Hours" value={w.H} max={23} onChange={(H) => set({ ...w, H })} />
        <span className="text-faint">:</span>
        <TimePart label="Minutes" value={w.M} max={59} onChange={(M) => set({ ...w, M })} />
        <span className="text-faint">:</span>
        <TimePart label="Seconds" value={w.S} max={59} onChange={(S) => set({ ...w, S })} />
        <span className="mono ml-1 text-[11px] text-faint">{value.tz}</span>
        <span className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => set(toWall({ ts: Math.floor(Date.now() / 1000), tz: value.tz }))}
        >
          Now
        </Button>
        <Button size="sm" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  )
}

/**
 * Exact git date editor: monospace "YYYY-MM-DD HH:mm:ss" (independent of OS locale) + UTC offset,
 * with a calendar on demand. Commits on Enter/blur.
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
  const [picking, setPicking] = useState(false)
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
      <Popover.Root open={picking} onOpenChange={setPicking}>
        <Popover.Anchor className="relative">
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
          <Popover.Trigger asChild>
            <button
              type="button"
              tabIndex={-1}
              disabled={disabled}
              title="Pick date"
              className="absolute top-1/2 right-1 -translate-y-1/2 rounded p-0.5 text-faint hover:text-fg data-[state=open]:text-accent"
            >
              <CalendarDays size={12} />
            </button>
          </Popover.Trigger>
        </Popover.Anchor>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={4}
            collisionPadding={8}
            onOpenAutoFocus={(e) => {
              e.preventDefault()
              ;(e.currentTarget as HTMLElement | null)
                ?.querySelector<HTMLElement>('[data-selected]')
                ?.focus()
            }}
            className="z-50 rounded-lg border border-line-strong bg-panel-2 p-2 shadow-xl outline-none"
          >
            <Calendar value={value} onChange={onChange} onDone={() => setPicking(false)} />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <Select
        mono
        className={cx('w-[74px] pl-1.5', changed && 'border-edit/70')}
        disabled={disabled}
        value={value.tz}
        title="UTC offset. Changing it keeps the wall-clock time and moves the instant."
        aria-label="UTC offset"
        onChange={(tz) => onChange(fromInputValue(toInputValue(value), tz))}
        options={tzs.map((tz) => ({
          value: tz,
          label: tz,
          hint: tz === localTz() ? 'local' : undefined
        }))}
      />
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

/** A dropdown menu opened at a screen position (e.g. where something was dropped). */
export function PointerMenu({
  at,
  entries,
  onClose
}: {
  at: { x: number; y: number }
  entries: MenuEntry[]
  onClose: () => void
}) {
  return (
    <Dropdown.Root open onOpenChange={(o) => !o && onClose()}>
      <Dropdown.Trigger asChild>
        <span
          aria-hidden
          style={{ position: 'fixed', left: at.x, top: at.y, width: 1, height: 1 }}
        />
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align="start" sideOffset={2} className={menuContent}>
          <DropdownEntries entries={entries} />
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  )
}
