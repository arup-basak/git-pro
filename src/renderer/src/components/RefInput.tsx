import { useId } from 'react'
import { cx } from '../lib/format'

/**
 * A text field that suggests branch, remote-branch and tag names as you type, and accepts any
 * commit-ish (a SHA, `main~2`…). The caller validates the value (usually via a preview call).
 */
export function RefInput({
  value,
  onChange,
  options,
  placeholder,
  autoFocus,
  className
}: {
  value: string
  onChange: (v: string) => void
  options: string[]
  placeholder?: string
  autoFocus?: boolean
  className?: string
}) {
  const id = useId()
  return (
    <>
      <input
        className={cx('field mono', className)}
        list={id}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        data-autofocus={autoFocus || undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={id}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </>
  )
}
