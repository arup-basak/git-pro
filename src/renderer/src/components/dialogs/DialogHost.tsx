import type { GitDate } from '@shared/types'
import { useState } from 'react'
import { useHost, type Field, type HostState, type Values } from '../../lib/dialogs'
import { Button, Checkbox, DateField, Modal, Select } from '../ui'

function initialValues(fields: Field[]): Values {
  const v: Values = {}
  for (const f of fields) {
    if (f.type === 'checkbox') v[f.name] = f.default ?? false
    else if (f.type === 'date') v[f.name] = f.default
    else if (f.type === 'select') v[f.name] = f.default ?? f.options[0]?.value ?? ''
    else v[f.name] = f.default ?? ''
  }
  return v
}

function FormDialog({ spec }: { spec: NonNullable<HostState['form']> }) {
  const [values, setValues] = useState<Values>(() => initialValues(spec.fields))
  const close = (v: Values | null): void => {
    spec.resolve(v)
    useHost.setState({ form: null })
  }
  const visible = spec.fields.filter((f) => !f.showIf || f.showIf(values))
  const missing = visible.some(
    (f) =>
      (f.type === 'text' || f.type === 'textarea') && f.required && !String(values[f.name]).trim()
  )
  const set = (name: string, v: string | boolean | GitDate): void =>
    setValues((s) => ({ ...s, [name]: v }))
  const firstText = visible.find((f) => f.type === 'text' || f.type === 'textarea')?.name
  return (
    <Modal
      open
      width={spec.width}
      onOpenChange={(o) => !o && close(null)}
      title={spec.title}
      description={spec.description}
      footer={
        <>
          <Button onClick={() => close(null)}>Cancel</Button>
          <Button
            variant={spec.danger ? 'danger' : 'primary'}
            disabled={missing}
            onClick={() => close(values)}
          >
            {spec.submitLabel ?? 'OK'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (!missing) close(values)
        }}
      >
        {visible.map((f) => {
          const focus = f.name === firstText
          return (
            <div key={f.name} className="flex flex-col gap-1">
              {f.type === 'checkbox' ? (
                <Checkbox
                  checked={!!values[f.name]}
                  onChange={(v) => set(f.name, v)}
                  label={f.label}
                />
              ) : (
                <label className="text-xs font-medium text-muted">{f.label}</label>
              )}
              {f.type === 'text' && (
                <input
                  data-autofocus={focus || undefined}
                  className={f.mono ? 'field mono' : 'field'}
                  placeholder={f.placeholder}
                  value={String(values[f.name])}
                  onChange={(e) => set(f.name, e.target.value)}
                />
              )}
              {f.type === 'textarea' && (
                <textarea
                  data-autofocus={focus || undefined}
                  className="field h-24 resize-y py-1.5"
                  placeholder={f.placeholder}
                  value={String(values[f.name])}
                  onChange={(e) => set(f.name, e.target.value)}
                />
              )}
              {f.type === 'select' && (
                <Select
                  value={String(values[f.name])}
                  onChange={(v) => set(f.name, v)}
                  aria-label={f.label}
                  options={f.options}
                />
              )}
              {f.type === 'date' && (
                <DateField value={values[f.name] as GitDate} onChange={(d) => set(f.name, d)} />
              )}
              {f.hint && <div className="text-[11px] text-faint">{f.hint}</div>}
            </div>
          )
        })}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  )
}

function ConfirmModal({ spec }: { spec: NonNullable<HostState['confirm']> }) {
  const close = (ok: boolean): void => {
    spec.resolve(ok)
    useHost.setState({ confirm: null })
  }
  return (
    <Modal
      open
      width={460}
      onOpenChange={(o) => !o && close(false)}
      title={spec.title}
      footer={
        <>
          <Button onClick={() => close(false)}>Cancel</Button>
          <Button
            data-autofocus
            variant={spec.danger ? 'danger' : 'primary'}
            onClick={() => close(true)}
          >
            {spec.confirmLabel ?? 'Continue'}
          </Button>
        </>
      }
    >
      <div className="text-[13px] leading-relaxed whitespace-pre-wrap text-fg">{spec.message}</div>
    </Modal>
  )
}

export function DialogHost() {
  const form = useHost((s) => s.form)
  const confirm = useHost((s) => s.confirm)
  return (
    <>
      {form && <FormDialog key={form.id} spec={form} />}
      {confirm && <ConfirmModal spec={confirm} />}
    </>
  )
}
