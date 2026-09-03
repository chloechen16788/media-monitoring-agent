import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installAuthFetch } from './config/api'

// 全局注入鉴权头，覆盖所有 fetch（含 SSE），无需改每个调用点。
installAuthFetch()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
