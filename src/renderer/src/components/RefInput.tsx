import { useMemo } from 'react'
import { Combobox } from './ui'

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
  const items = useMemo(() => options.map((o) => ({ value: o })), [options])
  return (
    <Combobox
      mono
      className={className}
      value={value}
      onChange={onChange}
      options={items}
      placeholder={placeholder}
      autoFocus={autoFocus}
    />
  )
}
