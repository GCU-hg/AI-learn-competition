import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter } from 'react-router-dom'
import React from 'react'
import { AIChatProvider, useAIChat, ChatMessage } from '@contexts/AIChatContext'
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

const mockFetch = vi.fn()
;(global as unknown as { fetch: typeof mockFetch }).fetch = mockFetch

const renderWithRouter = (component: React.ReactNode) => {
  return render(<BrowserRouter>{component}</BrowserRouter>)
}

describe('Context7 集成测试 - Editor 组件', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLocalStorage.getItem.mockReturnValue(null)
    mockLocalStorage.setItem.mockReturnValue(undefined)
    mockFetch.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('完整对话流程', () => {
    it('应该支持完整的用户消息发送流程', async () => {
      const mockResponse = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"你好！"},"finish_reason":null}]}\n\n'))
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"有什么"},"finish_reason":null}]}\n\n'))
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"finish_reason":"stop"}]}\n\n'))
          controller.close()
        }
      })

      mockFetch.mockResolvedValue({
        ok: true,
        body: mockResponse
      })

      let chatState: ReturnType<typeof useAIChat> | null = null
      
      const TestComponent = () => {
        chatState = useAIChat()
        return (
          <div>
            <div data-testid="message-count">{chatState!.messages.length}</div>
            <button onClick={() => chatState!.sendMessage('测试问题')}>发送</button>
          </div>
        )
      }

      renderWithRouter(
        <AIChatProvider>
          <TestComponent />
        </AIChatProvider>
      )

      const initialCount = chatState!.messages.length

      await act(async () => {
        await chatState!.sendMessage('测试问题')
      })

      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(chatState!.messages.length).toBeGreaterThan(initialCount)
    })

    it('应该正确处理多轮对话', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"choices":[{"finish_reason":"stop"}]}\n\n'))
            controller.close()
          }
        })
      })

      let chatState: ReturnType<typeof useAIChat> | null = null
      
      const TestComponent = () => {
        chatState = useAIChat()
        return <button onClick={() => chatState!.sendMessage(`消息 ${Date.now()}`)}>发送</button>
      }

      renderWithRouter(
        <AIChatProvider>
          <TestComponent />
        </AIChatProvider>
      )

      const initialMessages = [...chatState!.messages]

      for (let i = 0; i < 3; i++) {
        await act(async () => {
          await chatState!.sendMessage(`第 ${i + 1} 轮对话`)
        })
        await waitFor(() => {
          expect(chatState!.messages.length).toBeGreaterThan(initialMessages.length)
        }, { timeout: 1000 })
      }

      const userMessages = chatState!.messages.filter(m => m.role === 'user')
      expect(userMessages.length).toBe(3)
    })

    it('应该保持对话上下文连贯性', async () => {
      let capturedMessages: ChatMessage[] = []
      
      mockFetch.mockImplementation(async (url: string, options?: RequestInit) => {
        const body = options?.body as string
        const parsedBody = JSON.parse(body as string)
        capturedMessages = parsedBody.messages
        return {
          ok: true,
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: {"choices":[{"finish_reason":"stop"}]}\n\n'))
              controller.close()
            }
          })
        }
      })

      let chatState: ReturnType<typeof useAIChat> | null = null
      
      const TestComponent = () => {
        chatState = useAIChat()
        return <button onClick={() => chatState!.sendMessage('后续问题')}>发送</button>
      }

      renderWithRouter(
        <AIChatProvider>
          <TestComponent />
        </AIChatProvider>
      )

      await act(async () => {
        await chatState!.sendMessage('第一个问题')
      })

      await act(async () => {
        await chatState!.sendMessage('后续问题')
      })

      expect(capturedMessages.length).toBeGreaterThanOrEqual(3)
      const userMsgs = capturedMessages.filter((m: { role: string }) => m.role === 'user')
      expect(userMsgs.length).toBe(2)
    })
  })

  describe('状态同步测试', () => {
    it('多个组件应该同步看到相同状态', () => {
      let state1: ReturnType<typeof useAIChat> | null = null
      let state2: ReturnType<typeof useAIChat> | null = null

      const Component1 = () => {
        state1 = useAIChat()
        return <div data-testid="status-1">{state1!.status}</div>
      }

      const Component2 = () => {
        state2 = useAIChat()
        return <div data-testid="status-2">{state2!.status}</div>
      }

      renderWithRouter(
        <AIChatProvider>
          <Component1 />
          <Component2 />
        </AIChatProvider>
      )

      expect(screen.getByTestId('status-1').textContent).toBe('idle')
      expect(screen.getByTestId('status-2').textContent).toBe('idle')

      act(() => {
        state1!.setStatus('loading')
      })

      expect(screen.getByTestId('status-1').textContent).toBe('loading')
      expect(screen.getByTestId('status-2').textContent).toBe('loading')
    })

    it('clearHistory 应该同步所有组件', () => {
      let state1: ReturnType<typeof useAIChat> | null = null
      let state2: ReturnType<typeof useAIChat> | null = null

      const Component1 = () => {
        state1 = useAIChat()
        return <button onClick={() => state1!.clearHistory()}>清除</button>
      }

      const Component2 = () => {
        state2 = useAIChat()
        return <div data-testid="message-count">{state2!.messages.length}</div>
      }

      renderWithRouter(
        <AIChatProvider>
          <Component1 />
          <Component2 />
        </AIChatProvider>
      )

      const initialCount = state2!.messages.length

      act(() => {
        state1!.clearHistory()
      })

      expect(state2!.messages.length).toBe(initialCount)
      expect(state2!.messages[0].role).toBe('assistant')
    })
  })

  describe('错误恢复测试', () => {
    it('网络错误后应该能够重试', async () => {
      mockFetch.mockRejectedValueOnce(new Error('网络错误'))

      let chatState: ReturnType<typeof useAIChat> | null = null
      
      const TestComponent = () => {
        chatState = useAIChat()
        return <button onClick={() => chatState!.sendMessage('测试')}>发送</button>
      }

      renderWithRouter(
        <AIChatProvider>
          <TestComponent />
        </AIChatProvider>
      )

      await act(async () => {
        await chatState!.sendMessage('测试')
      })

      expect(chatState!.status).toBe('error')
      expect(chatState!.error).toBe('网络错误')

      mockFetch.mockResolvedValue({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"choices":[{"finish_reason":"stop"}]}\n\n'))
            controller.close()
          }
        })
      })

      await act(async () => {
        await chatState!.retryLastMessage()
      })

      expect(chatState!.status).toBe('success')
    })

    it('取消后应该能够发送新消息', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.close()
          }
        })
      })

      let chatState: ReturnType<typeof useAIChat> | null = null
      
      const TestComponent = () => {
        chatState = useAIChat()
        return (
          <div>
            <button onClick={() => chatState!.sendMessage('消息1')}>发送1</button>
            <button onClick={() => chatState!.cancelGeneration()}>取消</button>
          </div>
        )
      }

      renderWithRouter(
        <AIChatProvider>
          <TestComponent />
        </AIChatProvider>
      )

      await act(async () => {
        await chatState!.sendMessage('消息1')
      })

      act(() => {
        chatState!.cancelGeneration()
      })

      expect(chatState!.status).toBe('idle')

      await act(async () => {
        await chatState!.sendMessage('消息2')
      })

      const lastMessage = chatState!.messages[chatState!.messages.length - 1]
      expect(lastMessage.content).toBe('消息2')
    })
  })

  describe('性能测试', () => {
    it('快速连续状态更新不应该导致性能问题', () => {
      let chatState: ReturnType<typeof useAIChat> | null = null
      let renderCount = 0

      const TestComponent = () => {
        chatState = useAIChat()
        renderCount++
        return <div>{chatState!.status}</div>
      }

      renderWithRouter(
        <AIChatProvider>
          <TestComponent />
        </AIChatProvider>
      )

      const initialRenderCount = renderCount

      act(() => {
        chatState!.setStatus('loading')
        chatState!.setStatus('streaming')
        chatState!.setStatus('success')
        chatState!.setStatus('idle')
        chatState!.setStatus('error')
        chatState!.setStatus('idle')
      })

      expect(renderCount - initialRenderCount).toBeLessThan(10)
    })

    it('大量消息应该正确限制数量', async () => {
      let chatState: ReturnType<typeof useAIChat> | null = null
      
      const TestComponent = () => {
        chatState = useAIChat()
        return <div data-testid="count">{chatState!.messages.length}</div>
      }

      renderWithRouter(
        <AIChatProvider>
          <TestComponent />
        </AIChatProvider>
      )

      mockFetch.mockResolvedValue({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.close()
          }
        })
      })

      for (let i = 0; i < 150; i++) {
        await act(async () => {
          await chatState!.sendMessage(`消息 ${i}`)
        })
      }

      expect(chatState!.messages.length).toBeLessThanOrEqual(101)
    })
  })
})

describe('Context7 与 Editor 集成', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLocalStorage.getItem.mockReturnValue(null)
    mockLocalStorage.setItem.mockReturnValue(undefined)
    mockFetch.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('Editor 应该正确渲染并使用 Context7', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"finish_reason":"stop"}]}\n\n'))
          controller.close()
        }
      })
    })

    renderWithRouter(<Editor />)

    expect(screen.getByText('编辑器')).toBeInTheDocument()
    expect(screen.getByText('智能对话')).toBeInTheDocument()
  })

  it('切换到电路设计标签页应该正常工作', async () => {
    const user = userEvent.setup()
    
    renderWithRouter(<Editor />)

    const circuitTab = screen.getByText('电路设计')
    await user.click(circuitTab)

    expect(screen.getByText('AI电路助手')).toBeInTheDocument()
    expect(screen.getByText('电路编辑器')).toBeInTheDocument()
  })
})
