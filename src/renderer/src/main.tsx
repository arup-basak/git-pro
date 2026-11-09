import './styles.css'

import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import App from './App'
import { queryClient } from './lib/actions'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster
        theme="dark"
        position="bottom-left"
        offset={{ bottom: 32, left: 8 }}
        style={{ ['--width' as string]: '300px' }}
        toastOptions={{
          style: {
            background: '#161a21',
            border: '1px solid #323a46',
            color: '#d8dde5',
            fontSize: 13
          }
        }}
      />
    </QueryClientProvider>
  </StrictMode>
)
