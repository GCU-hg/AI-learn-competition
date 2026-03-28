import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { withStore, store, setAuth } from '@store/index'
import './styles/index.css'
import 'antd/dist/reset.css'
import 'katex/dist/katex.min.css'
import 'katex/dist/fonts/KaTeX_Main-Regular.woff2'
import 'katex/dist/fonts/KaTeX_Math-Italic.woff2'
import 'katex/dist/fonts/KaTeX_Size1-Regular.woff2'
import 'katex/dist/fonts/KaTeX_Size2-Regular.woff2'
import 'katex/dist/fonts/KaTeX_Size3-Regular.woff2'
import 'katex/dist/fonts/KaTeX_Size4-Regular.woff2'

const queryClient = new QueryClient()

try {
  const token = localStorage.getItem('token')
  const userStr = localStorage.getItem('user')
  if (token && userStr) {
    const user = JSON.parse(userStr)
    store.dispatch(setAuth({ token, user }))
  } else if (!token) {
    store.dispatch(setAuth({
      token: 'mock-admin-token',
      user: { id: 'admin-1', username: 'Admin', email: 'admin@example.com', role: 'admin' }
    }))
  }
} catch {}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <QueryClientProvider client={queryClient}>
        {withStore(<App />)}
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>
)
