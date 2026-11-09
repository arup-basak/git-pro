import { ChangesView } from './components/changes/ChangesView'
import { DialogHost } from './components/dialogs/DialogHost'
import { ShortcutsDialog } from './components/dialogs/ShortcutsDialog'
import { GraphView } from './components/graph/CommitGraph'
import { HistoryEditorView } from './components/history/HistoryEditor'
import { CommandLog, StatusBar } from './components/layout/CommandLog'
import { OperationBanner } from './components/layout/OperationBanner'
import { Sidebar } from './components/layout/Sidebar'
import { Toolbar } from './components/layout/Toolbar'
import { Welcome } from './components/layout/Welcome'
import { MergeEditorView } from './components/merge/MergeEditor'
import { PushDialog } from './components/push/PushDialog'
import { StashSaveDialog } from './components/stash/StashSaveDialog'
import { StashesView } from './components/stash/StashesView'
import { BackupsView } from './components/views/BackupsView'
import { ReflogView } from './components/views/ReflogView'
import { useMenuCommands, useMenuState } from './lib/menuBridge'
import { useAppEvents } from './lib/queries'
import { useUi } from './lib/store'

function Main() {
  const view = useUi((s) => s.view)
  switch (view) {
    case 'changes':
      return <ChangesView />
    case 'stashes':
      return <StashesView />
    case 'history':
      return <HistoryEditorView />
    case 'merge':
      return <MergeEditorView />
    case 'reflog':
      return <ReflogView />
    case 'backups':
      return <BackupsView />
    default:
      return <GraphView />
  }
}

function Workspace() {
  return (
    <div className="flex h-full flex-col">
      <Toolbar />
      <OperationBanner />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1">
          <Main />
        </main>
      </div>
      <CommandLog />
      <StatusBar />
      <PushDialog />
      <StashSaveDialog />
    </div>
  )
}

export default function App() {
  useAppEvents()
  useMenuState()
  useMenuCommands()
  const repo = useUi((s) => s.repo)
  return (
    <>
      {repo ? <Workspace key={repo.id} /> : <Welcome />}
      <DialogHost />
      <ShortcutsDialog />
    </>
  )
}
