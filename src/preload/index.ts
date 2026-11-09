import { contextBridge, ipcRenderer } from 'electron'
import { EVENT_CHANNEL, INVOKE_CHANNEL, type InvokeEnvelope } from '../shared/api'
import type { AppEvent } from '../shared/types'

class BridgeError extends Error {
  constructor(
    message: string,
    readonly detail?: string
  ) {
    super(message)
  }
}

const bridge = {
  async invoke(method: string, ...args: unknown[]): Promise<unknown> {
    const res = (await ipcRenderer.invoke(INVOKE_CHANNEL, method, args)) as InvokeEnvelope<unknown>
    if (res.ok) return res.value
    // Errors lose custom fields across the context bridge, so encode the detail in the message.
    const err = new BridgeError(
      res.error.detail ? `${res.error.message}\n\n${res.error.detail}` : res.error.message
    )
    throw err
  },
  on(listener: (event: AppEvent) => void): () => void {
    const handler = (_e: unknown, event: AppEvent): void => listener(event)
    ipcRenderer.on(EVENT_CHANNEL, handler)
    return () => ipcRenderer.removeListener(EVENT_CHANNEL, handler)
  }
}

contextBridge.exposeInMainWorld('gitPro', bridge)
