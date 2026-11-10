import { useEffect } from 'react'
import { call } from './api'

/**
 * On macOS the native title bar is hidden and the traffic lights sit in our toolbar row.
 * `<html data-titlebar>` tells the CSS how to lay that row out:
 *   inset      – macOS windowed: toolbar is the drag region and leaves room for the traffic lights
 *   fullscreen – macOS fullscreen: traffic lights are gone, so no extra room
 *   native     – other platforms keep their own title bar
 */
type TitlebarMode = 'inset' | 'fullscreen' | 'native'

const mac = window.gitPro.platform === 'darwin'

function setMode(mode: TitlebarMode): void {
  document.documentElement.dataset.titlebar = mode
}

/** Applied before the first render so the toolbar never jumps after the window shows. */
export function initTitlebar(): void {
  setMode(mac ? 'inset' : 'native')
}

/** Follows fullscreen changes (and catches up after a reload while in fullscreen). */
export function useTitlebar(): void {
  useEffect(() => {
    if (!mac) return
    const apply = (fullscreen: boolean): void => setMode(fullscreen ? 'fullscreen' : 'inset')
    let live = false
    const off = window.gitPro.on((ev) => {
      if (ev.type !== 'window') return
      live = true
      apply(ev.fullscreen)
    })
    void call('app.isFullScreen').then((fs) => {
      if (!live) apply(fs)
    })
    return off
  }, [])
}
