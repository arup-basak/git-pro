/// <reference types="vite/client" />
import type { GitProBridge } from '../../shared/api'

declare global {
  interface Window {
    gitPro: GitProBridge
  }
}
