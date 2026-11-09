import * as Popover from '@radix-ui/react-popover'
import { Palette } from 'lucide-react'
import { SYNTAX_THEMES, useViewSettings } from '../../lib/settings'
import { useUi } from '../../lib/store'
import { CodeView } from '../code/Code'
import { Button, Checkbox, Select } from '../ui'

const SAMPLE = `// Retime a commit and push it to a separate branch
export async function retime(sha: string, when: Date): Promise<void> {
  const plan = { tip: 'main', rows: [{ sha, authorDate: when }] }
  await git.apply(plan, { output: 'main-retimed' }) // 3 commits
}`

export function ViewSettingsButton() {
  const s = useViewSettings()
  const open = useUi((u) => u.settingsOpen)
  const setOpen = useUi((u) => u.setSettingsOpen)
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button variant="ghost" icon={<Palette size={13} />} title="Code display settings">
          View
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-[420px] rounded-lg border border-line-strong bg-panel p-3 shadow-2xl outline-none"
        >
          <div className="mb-2 text-[11px] font-semibold tracking-wide text-faint uppercase">
            Code display
          </div>
          <div className="flex flex-col gap-2">
            <Checkbox
              checked={s.syntax}
              onChange={(v) => s.set({ syntax: v })}
              label="Syntax highlighting"
            />
            <div className="flex items-center justify-between gap-3 pl-5">
              <span className="text-xs text-muted">Theme</span>
              <Select
                value={s.theme}
                disabled={!s.syntax}
                onChange={(e) => s.set({ theme: e.target.value })}
                className="w-52"
              >
                {SYNTAX_THEMES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </div>
            <Checkbox
              checked={s.wordDiff}
              onChange={(v) => s.set({ wordDiff: v })}
              label="Highlight changed words in diffs"
            />
            <Checkbox
              checked={s.wrap}
              onChange={(v) => s.set({ wrap: v })}
              label="Wrap long lines in diffs"
            />
          </div>
          <div className="mt-3 overflow-x-auto rounded-md border border-line bg-bg">
            <CodeView text={SAMPLE} lang="typescript" lineNumbers />
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
