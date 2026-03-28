import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter } from 'react-router-dom'
import React from 'react'
import { AIChatProvider, useAIChat, ChatMessage } from '@contexts/AIChatContext'

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

const mockFetch = vi.fn()
;(global as unknown as { fetch: typeof mockFetch }).fetch = mockFetch

describe('AIChatContext (Context7)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLocalStorage.getItem.mockReturnValue(null)
    mockLocalStorage.setItem.mockReturnValue(undefined)
    mockFetch.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Provider 渲染', () => {
    it('应该正确渲染 Provider 和子组件', () => {
      renderWithRouter(
        <AIChatProvider>
          <div data-testid="child-component">测试子组件</div>
        </AIChatProvider>
      )
      expect(screen.getByTestId('child-component')).toBeInTheDocument()
    })

    it('应该提供正确的默认值', () => {
      let contextValue: ReturnType<typeof useAIChat> | null = null
      
      const TestComponent = () => {
        contextValue = useAIChat()
        return null
      }

      renderWithRouter(
        <AIChatProvider>
          <TestComponent />
        </AIChatProvider>
      )

      expect(contextValue).not.toBeNull()
      expect(contextValue!.messages).toBeDefined()
      expect(contextValue!.sendMessage).toBeDefined()
      expect(contextValue!.clearHistory).toBeDefined()
    })
  })

  describe('useAIChat Hook', () => {
    it('应该返回初始状态', () => {
      let chatState: ReturnType<typeof useAIChat> | null = null
      
      const TestComponent = () => {
        chatState = useAIChat()
        return null
      }

      renderWithRouter(
        <AIChatProvider>
          <TestComponent />
        </AIChatProvider>
      )

      expect(chatState!.status).toBe('idle')
      expect(chatState!.isTyping).toBe(false)
      expect(chatState!.error).toBeNull()
      expect(chatState!.conversationId).toBeNull()
    })

    it('应该包含初始欢迎消息', () => {
      let chatState: ReturnType<typeof useAIChat> | null = null
      
      const TestComponent = () => {
        chatState = useAIChat()
        return null
      }

      renderWithRouter(
        <AIChatProvider>
          <TestComponent />
        </AIChatProvider>
      )

      expect(chatState!.messages).toHaveLength(1)
      expect(chatState!.messages[0].role).toBe('assistant')
      expect(chatState!.messages[0].content).toContain('Simulink AI 助手')
    })
  })

  describe('状态管理', () => {
    it('sendMessage 应该忽略空消息', async () => {
      let chatState: ReturnType<typeof useAIChat> | null = null
      
      const TestComponent = () => {
        chatState = useAIChat()
        return <button onClick={() => chatState?.sendMessage('')}>发送</button>
      }

      renderWithRouter(
        <AIChatProvider>
          <TestComponent />
        </AIChatProvider>
      )

      const initialMessages = chatState!.messages.length
      
      await act(async () => {
        await chatState!.sendMessage('')
      })

      expect(chatState!.messages.length).toBe(initialMessages)
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('sendMessage 应该忽略只包含空格的文本', async () => {
      let chatState: ReturnType<typeof useAIChat> | null = null
      
      const TestComponent = () => {
        chatState = useAIChat()
        return <button onClick={() => chatState?.sendMessage('   ')}>发送</button>
      }

      renderWithRouter(
        <AIChatProvider>
          <TestComponent />
        </AIChatProvider>
      )

      await act(async () => {
        await chatState!.sendMessage('   ')
      })

      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('clearHistory 应该清除所有消息并保留初始消息', () => {
      let chatState: ReturnType<typeof useAIChat> | null = null
      
      const TestComponent = () => {
        chatState = useAIChat()
        return <button onClick={() => chatState?.clearHistory()}>清除</button>
      }

      renderWithRouter(
        <AIChatProvider>
          <TestComponent />
        </AIChatProvider>
      )

      const initialLength = chatState!.messages.length
      expect(initialLength).toBe(1)

      act(() => {
        chatState!.clearHistory()
      })

      expect(chatState!.messages.length).toBe(1)
      expect(chatState!.messages[0].role).toBe('assistant')
      expect(mockLocalStorage.removeItem).toHaveBeenCalled()
    })
  })

  describe('取消功能', () => {
    it('cancelGeneration 应该将状态设置为 idle', () => {
      let chatState: ReturnType<typeof useAIChat> | null = null
      
      const TestComponent = () => {
        chatState = useAIChat()
        return <button onClick={() => chatState?.cancelGeneration()}>取消</button>
      }

      renderWithRouter(
        <AIChatProvider>
          <TestComponent />
        </AIChatProvider>
      )

      act(() => {
        chatState!.cancelGeneration()
      })

      expect(chatState!.status).toBe('idle')
    })
  })

  describe('错误处理', () => {
    it('setError 应该设置错误状态', () => {
      let chatState: ReturnType<typeof useAIChat> | null = null
      
      const TestComponent = () => {
        chatState = useAIChat()
        return <button onClick={() => chatState?.setError('测试错误')}>设置错误</button>
      }

      renderWithRouter(
        <AIChatProvider>
          <TestComponent />
        </AIChatProvider>
      )

      act(() => {
        chatState!.setError('测试错误')
      })

      expect(chatState!.error).toBe('测试错误')
      expect(chatState!.status).toBe('error')
    })

    it('setError(null) 应该清除错误状态', () => {
      let chatState: ReturnType<typeof useAIChat> | null = null
      
      const TestComponent = () => {
        chatState = useAIChat()
        return <button onClick={() => chatState?.setError(null)}>清除错误</button>
      }

      renderWithRouter(
        <AIChatProvider>
          <TestComponent />
        </AIChatProvider>
      )

      act(() => {
        chatState!.setError('错误')
        chatState!.setError(null)
      })

      expect(chatState!.error).toBeNull()
      expect(chatState!.status).toBe('idle')
    })
  })

  describe('setStatus', () => {
    it('应该正确更新状态', () => {
      let chatState: ReturnType<typeof useAIChat> | null = null
      
      const TestComponent = () => {
        chatState = useAIChat()
        return <button onClick={() => chatState?.setStatus('loading')}>设置状态</button>
      }

      renderWithRouter(
        <AIChatProvider>
          <TestComponent />
        </AIChatProvider>
      )

      act(() => {
        chatState!.setStatus('loading')
      })

      expect(chatState!.status).toBe('loading')
      expect(chatState!.isTyping).toBe(true)
    })
  })

  describe('retryLastMessage', () => {
    it('在没有用户消息时应该不执行任何操作', async () => {
      let chatState: ReturnType<typeof useAIChat> | null = null
      
      const TestComponent = () => {
        chatState = useAIChat()
        return <button onClick={() => chatState?.retryLastMessage()}>重试</button>
      }

      renderWithRouter(
        <AIChatProvider>
          <TestComponent />
        </AIChatProvider>
      )

      await act(async () => {
        await chatState!.retryLastMessage()
      })

      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('useAIChatSelector', () => {
    it('应该正确选择状态子集', async () => {
      const { useAIChatSelector } = await import('@contexts/AIChatContext')
      
      let selectedStatus: string = ''
      
      const TestComponent = () => {
        selectedStatus = useAIChatSelector(state => state.status)
        return null
      }

      renderWithRouter(
        <AIChatProvider>
          <TestComponent />
        </AIChatProvider>
      )

      expect(selectedStatus).toBe('idle')
    })
  })

  describe('消息数量限制', () => {
    it('应该限制消息数量在 MAX_HISTORY_MESSAGES 以内', () => {
      let chatState: ReturnType<typeof useAIChat> | null = null
      
      const TestComponent = () => {
        chatState = useAIChat()
        return null
      }

      renderWithRouter(
        <AIChatProvider>
          <TestComponent />
        </AIChatProvider>
      )

      act(() => {
        for (let i = 0; i < 150; i++) {
          chatState!.messages.push({
            id: `msg-${i}`,
            role: 'user',
            content: `测试消息 ${i}`,
            timestamp: Date.now()
          })
        }
      })

      expect(chatState!.messages.length).toBeLessThanOrEqual(101)
    })
  })

  describe('localStorage 持久化', () => {
    it('应该从 localStorage 恢复消息', () => {
      const savedMessages = [
        {
          id: 'saved-1',
          role: 'user' as const,
          content: '保存的消息',
          timestamp: Date.now()
        }
      ]
      mockLocalStorage.getItem.mockImplementation((key: string) => {
        if (key === 'context7_chat_history') {
          return JSON.stringify(savedMessages)
        }
        return null
      })

      let chatState: ReturnType<typeof useAIChat> | null = null
      
      const TestComponent = () => {
        chatState = useAIChat()
        return null
      }

      renderWithRouter(
        <AIChatProvider>
          <TestComponent />
        </AIChatProvider>
      )

      expect(chatState!.messages.length).toBeGreaterThan(0)
    })

    it('应该在消息变化时保存到 localStorage', () => {
      let chatState: ReturnType<typeof useAIChat> | null = null
      
      const TestComponent = () => {
        chatState = useAIChat()
        return null
      }

      renderWithRouter(
        <AIChatProvider>
          <TestComponent />
        </AIChatProvider>
      )

      act(() => {
        chatState!.clearHistory()
      })

      expect(mockLocalStorage.setItem).toHaveBeenCalled()
    })
  })

  describe('错误边界行为', () => {
    it('在 Provider 外部使用应该抛出错误', () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

      const TestComponent = () => {
        expect(() => useAIChat()).toThrow('useAIChat 必须在 AIChatProvider 内部使用')
        return null
      }

      renderWithRouter(<TestComponent />)

      consoleError.mockRestore()
    })
  })
})

describe('Context7 性能测试', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLocalStorage.getItem.mockReturnValue(null)
    mockLocalStorage.setItem.mockReturnValue(undefined)
  })

  it('大量状态更新不应该导致性能问题', () => {
    let updateCount = 0
    
    const TestComponent = () => {
      const chat = useAIChat()
      
      React.useEffect(() => {
        updateCount++
      }, [chat.status])

      return <div>{chat.status}</div>
    }

    renderWithRouter(
      <AIChatProvider>
        <TestComponent />
      </AIChatProvider>
    )

    const initialCount = updateCount

    let chatState: ReturnType<typeof useAIChat> | null = null
    const Wrapper = () => {
      chatState = useAIChat()
      return null
    }

    renderWithRouter(
      <AIChatProvider>
        <Wrapper />
      </AIChatProvider>
    )

    act(() => {
      chatState!.setStatus('loading')
      chatState!.setStatus('streaming')
      chatState!.setStatus('success')
      chatState!.setStatus('idle')
    })

    expect(updateCount - initialCount).toBeLessThan(10)
  })
})
