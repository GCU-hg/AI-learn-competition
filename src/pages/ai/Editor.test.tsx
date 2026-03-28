import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter } from 'react-router-dom'
import React from 'react'
import Editor from '@pages/ai/Editor'

declare const global: {
  localStorage: {
    getItem: Mock
    setItem: Mock
    removeItem: Mock
    clear: Mock
  }
  scrollTo: Mock
}

const renderWithRouter = (component: React.ReactNode) => {
  return render(<BrowserRouter>{component}</BrowserRouter>)
}

const mockLocalStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn()
}

Object.defineProperty(global, 'localStorage', {
  value: mockLocalStorage,
  writable: true
})

const mockScrollTo = vi.fn()
Object.defineProperty(global, 'scrollTo', {
  value: mockScrollTo,
  writable: true
})

describe('Editor 组件', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLocalStorage.getItem.mockReturnValue(null)
    mockLocalStorage.setItem.mockReturnValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('应该正确渲染编辑器标题', () => {
    renderWithRouter(<Editor />)
    expect(screen.getByText('编辑器')).toBeInTheDocument()
  })

  it('应该显示智能对话和电路设计两个标签页', () => {
    renderWithRouter(<Editor />)
    expect(screen.getByText('智能对话')).toBeInTheDocument()
    expect(screen.getByText('电路设计')).toBeInTheDocument()
  })

  it('应该默认显示聊天面板', () => {
    renderWithRouter(<Editor />)
    expect(screen.getByText('你好！我是Simulink AI助手')).toBeInTheDocument()
  })

  it('应该能够在输入框输入内容', async () => {
    const user = userEvent.setup()
    renderWithRouter(<Editor />)
    
    const input = screen.getByPlaceholderText('输入你的问题…')
    await user.type(input, '测试问题')
    expect(input).toHaveValue('测试问题')
  })

  it('应该能够切换到电路设计标签页', async () => {
    const user = userEvent.setup()
    renderWithRouter(<Editor />)
    
    const circuitTab = screen.getByText('电路设计')
    await user.click(circuitTab)
    
    expect(screen.getByText('AI电路助手')).toBeInTheDocument()
    expect(screen.getByText('电路编辑器')).toBeInTheDocument()
  })

  it('应该显示电路画布', async () => {
    const user = userEvent.setup()
    renderWithRouter(<Editor />)
    
    const circuitTab = screen.getByText('电路设计')
    await user.click(circuitTab)
    
    const canvas = screen.getByRole('img', { name: /电路编辑器/i })
    expect(canvas).toBeInTheDocument()
  })
})

describe('Editor 电路功能', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLocalStorage.getItem.mockReturnValue(null)
  })

  it('应该能够添加电阻元件', async () => {
    const user = userEvent.setup()
    renderWithRouter(<Editor />)
    
    const circuitTab = screen.getByText('电路设计')
    await user.click(circuitTab)
    
    const resistorButton = screen.getByRole('button', { name: /电阻/i })
    await user.click(resistorButton)
    
    expect(screen.getByText(/已添加 R/)).toBeInTheDocument()
  })

  it('应该能够添加电压源元件', async () => {
    const user = userEvent.setup()
    renderWithRouter(<Editor />)
    
    const circuitTab = screen.getByText('电路设计')
    await user.click(circuitTab)
    
    const voltageButton = screen.getByRole('button', { name: /电压源/i })
    await user.click(voltageButton)
    
    expect(screen.getByText(/已添加 V/)).toBeInTheDocument()
  })

  it('应该能够加载分压电路示例', async () => {
    const user = userEvent.setup()
    renderWithRouter(<Editor />)
    
    const circuitTab = screen.getByText('电路设计')
    await user.click(circuitTab)
    
    const resistorButton = screen.getByRole('button', { name: /电阻/i })
    await user.click(resistorButton)
    
    const voltageButton = screen.getByRole('button', { name: /电压源/i })
    await user.click(voltageButton)
    
    const capacitorButton = screen.getByRole('button', { name: /电容/i })
    await user.click(capacitorButton)
    
    expect(screen.getByText(/已添加/)).toBeTruthy()
  })
})

describe('Editor 消息功能', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLocalStorage.getItem.mockReturnValue(null)
  })

  it('应该显示初始欢迎消息', () => {
    renderWithRouter(<Editor />)
    expect(screen.getByText('你好！我是Simulink AI助手')).toBeInTheDocument()
  })

  it('应该正确渲染用户发送的消息', async () => {
    const user = userEvent.setup()
    renderWithRouter(<Editor />)
    
    const input = screen.getByPlaceholderText('输入你的问题…')
    await user.type(input, '测试问题')
    
    const sendButton = screen.getByRole('button', { name: /发送/i })
    await user.click(sendButton)
    
    expect(screen.getByText('我')).toBeInTheDocument()
    expect(screen.getByText('测试问题')).toBeInTheDocument()
  })

  it('应该支持按 Enter 键发送消息', async () => {
    const user = userEvent.setup()
    renderWithRouter(<Editor />)
    
    const input = screen.getByPlaceholderText('输入你的问题…')
    await user.type(input, '测试问题{Enter}')
    
    expect(screen.getByText('我')).toBeInTheDocument()
  })
})

describe('Editor API 状态显示', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLocalStorage.getItem.mockReturnValue(null)
  })

  it('应该显示 API 未配置提示', () => {
    renderWithRouter(<Editor />)
    expect(screen.getByText('未配置API密钥，使用本地回复模式')).toBeInTheDocument()
  })
})

describe('Editor localStorage 集成', () => {
  it('应该在组件挂载时从 localStorage 恢复电路状态', () => {
    const savedCircuit = {
      nodes: [{ id: 'test', x: 100, y: 100, type: 'junction' }],
      components: []
    }
    mockLocalStorage.getItem.mockReturnValue(JSON.stringify(savedCircuit))
    
    renderWithRouter(<Editor />)
    
    expect(mockLocalStorage.getItem).toHaveBeenCalledWith('circuit_session')
  })

  it('应该在电路状态变化时保存到 localStorage', async () => {
    const user = userEvent.setup()
    renderWithRouter(<Editor />)
    
    const circuitTab = screen.getByText('电路设计')
    await user.click(circuitTab)
    
    const resistorButton = screen.getByRole('button', { name: /电阻/i })
    await user.click(resistorButton)
    
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith('circuit_session', expect.any(String))
  })
})
