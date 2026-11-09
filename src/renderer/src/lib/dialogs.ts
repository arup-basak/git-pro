import type { GitDate } from '@shared/types'
import type { ReactNode } from 'react'
import { create } from 'zustand'

export type Values = Record<string, string | boolean | GitDate>

export type Field = {
  name: string
  label: string
  hint?: string
  showIf?: (v: Values) => boolean
} & (
  | { type: 'text'; default?: string; placeholder?: string; required?: boolean; mono?: boolean }
  | { type: 'textarea'; default?: string; placeholder?: string; required?: boolean }
  | { type: 'checkbox'; default?: boolean }
  | { type: 'select'; default?: string; options: Array<{ value: string; label: string }> }
  | { type: 'date'; default: GitDate }
)

export interface FormSpec {
  title: string
  description?: ReactNode
  fields: Field[]
  submitLabel?: string
  danger?: boolean
  width?: number
}

export interface ConfirmSpec {
  title: string
  message: ReactNode
  confirmLabel?: string
  danger?: boolean
}

export interface HostState {
  form: (FormSpec & { id: number; resolve: (v: Values | null) => void }) | null
  confirm: (ConfirmSpec & { resolve: (ok: boolean) => void }) | null
}

export const useHost = create<HostState>(() => ({ form: null, confirm: null }))

export function openForm<T extends Values = Values>(spec: FormSpec): Promise<T | null> {
  return new Promise((resolve) =>
    useHost.setState({
      form: {
        ...spec,
        id: Date.now() + Math.random(),
        resolve: resolve as (v: Values | null) => void
      }
    })
  )
}

export function confirmDialog(spec: ConfirmSpec): Promise<boolean> {
  return new Promise((resolve) => useHost.setState({ confirm: { ...spec, resolve } }))
}
