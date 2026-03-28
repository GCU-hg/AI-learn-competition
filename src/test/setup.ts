import '@testing-library/jest-dom'
import { vi, Mock } from 'vitest'

declare const global: {
  localStorage: {
    getItem: Mock
    setItem: Mock
    removeItem: Mock
    clear: Mock
  }
  scrollTo: Mock
}

vi.mock('katex', () => ({
  default: {
    render: vi.fn(() => ({ html: '<span>katex-rendered</span>' }))
  }
}))

Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn()
  },
  writable: true
})

Object.defineProperty(global, 'localStorage', {
  value: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn()
  },
  writable: true
})

window.scrollTo = vi.fn()
global.scrollTo = vi.fn()
