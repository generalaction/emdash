import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ThemeProvider } from './hooks/useTheme'
import './index.css'

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
)

// Avoid double-mount in dev which can duplicate PTY sessions
root.render(
  <ThemeProvider defaultTheme="system" storageKey="emdash-ui-theme">
    <App />
  </ThemeProvider>
)
