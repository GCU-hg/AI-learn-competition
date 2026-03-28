import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo, useReducer, ReactNode } from 'react'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  sources?: { title: string; url: string }[]
}

export interface AIChatState {
  messages: ChatMessage[]
  status: 'idle' | 'loading' | 'streaming' | 'success' | 'error'
  isTyping: boolean
  error: string | null
  conversationId: string | null
}

export interface AIChatActions {
  sendMessage: (content: string) => Promise<void>
  clearHistory: () => void
  retryLastMessage: () => Promise<void>
  cancelGeneration: () => void
  deleteMessage: (messageId: string) => void
  setStatus: (status: AIChatState['status']) => void
  setError: (error: string | null) => void
}

type AIChatEvent = 
  | { type: 'SEND_MESSAGE'; payload: { content: string } }
  | { type: 'ADD_USER_MESSAGE'; payload: ChatMessage }
  | { type: 'ADD_ASSISTANT_MESSAGE'; payload: { content: string; messageId: string } }
  | { type: 'UPDATE_LAST_MESSAGE'; payload: string }
  | { type: 'SET_STATUS'; payload: AIChatState['status'] }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'CLEAR_HISTORY' }
  | { type: 'SET_CONVERSATION_ID'; payload: string | null }
  | { type: 'STREAM_TOKEN'; payload: string }

interface AIChatContextValue extends AIChatState, AIChatActions {}

const AIChatContext = createContext<AIChatContextValue | null>(null)

const VOLCANO_API_KEY = import.meta.env.VITE_VOLCANO_API_KEY || ''
const VOLCANO_MODEL_ID = import.meta.env.VITE_VOLCANO_MODEL_ID || ''
const VOLCANO_API_URL = import.meta.env.VITE_VOLCANO_API_URL || 'https://ark.cn-beijing.volces.com/api/v3'
const CHAT_HISTORY_KEY = 'context7_chat_history'
const MAX_HISTORY_MESSAGES = 100
const CHAT_TIMEOUT_MS = 90000
const MAX_RETRIES = 0
const CONVERSATION_ID_KEY = 'context7_conversation_id'

function getAPIEndpoint(): string {
  const baseUrl = VOLCANO_API_URL.replace(/\/chat\/completions\/?$/, '')
  return `${baseUrl}/chat/completions`
}

function createFallbackResponse(query: string): string {
  const responses: Record<string, string> = {
    default: `我理解您想了解"${query.substring(0, 30)}${query.length > 30 ? '...' : ''}"。

目前AI服务响应较慢，可能是由于网络原因或服务器负载较高。

**建议尝试：**
1. 稍后重新提问
2. 简化您的问题
3. 检查网络连接

**常见问题解答：**
- 如何设计分压电路？
  使用两个电阻串联，输出电压 = V_in × R2/(R1+R2)

- RC电路的时间常数如何计算？
  τ = R × C，其中R是电阻值，C是电容值

- 什么是基尔霍夫电流定律？
  流入节点的电流之和等于流出节点的电流之和`
  }
  return responses.default || responses.default
}

const generateMessageId = (): string => 
  `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

const createInitialMessage = (): ChatMessage => ({
  id: `init-${Date.now()}`,
  role: 'assistant',
  content: '你好！我是 Simulink AI 助手，随时为你解答建模与学习问题。',
  timestamp: Date.now()
})

const initialState: AIChatState = {
  messages: [],
  status: 'idle',
  isTyping: false,
  error: null,
  conversationId: null
}

function aiChatReducer(state: AIChatState, event: AIChatEvent): AIChatState {
  switch (event.type) {
    case 'SEND_MESSAGE':
      return {
        ...state,
        status: 'loading',
        isTyping: true,
        error: null
      }
    
    case 'ADD_USER_MESSAGE':
      return {
        ...state,
        messages: [...state.messages, event.payload].slice(-MAX_HISTORY_MESSAGES),
        status: 'streaming',
        isTyping: true
      }
    
    case 'ADD_ASSISTANT_MESSAGE':
      {
        const newMessage: ChatMessage = {
          id: event.payload.messageId,
          role: 'assistant',
          content: event.payload.content,
          timestamp: Date.now()
        }
        return {
          ...state,
          messages: [...state.messages, newMessage].slice(-MAX_HISTORY_MESSAGES),
          isTyping: false,
          status: 'success'
        }
      }
    
    case 'UPDATE_LAST_MESSAGE':
      {
        let lastAssistantIdx = -1
        for (let i = state.messages.length - 1; i >= 0; i--) {
          if (state.messages[i].role === 'assistant') {
            lastAssistantIdx = i
            break
          }
        }
        if (lastAssistantIdx === -1) return state
        
        return {
          ...state,
          messages: state.messages.map((msg, idx) =>
            idx === lastAssistantIdx
              ? { ...msg, content: event.payload, timestamp: Date.now() }
              : msg
          )
        }
      }
    
    case 'SET_STATUS':
      return {
        ...state,
        status: event.payload,
        isTyping: event.payload === 'loading' || event.payload === 'streaming'
      }
    
    case 'SET_ERROR':
      return {
        ...state,
        error: event.payload,
        status: event.payload ? 'error' : 'idle',
        isTyping: false
      }
    
    case 'CLEAR_HISTORY':
      return {
        ...initialState,
        messages: [createInitialMessage()]
      }
    
    case 'SET_CONVERSATION_ID':
      return {
        ...state,
        conversationId: event.payload
      }
    
    case 'STREAM_TOKEN':
      {
        let lastAssistantIdx = -1
        for (let i = state.messages.length - 1; i >= 0; i--) {
          if (state.messages[i].role === 'assistant') {
            lastAssistantIdx = i
            break
          }
        }
        
        if (lastAssistantIdx === -1) {
          return state
        }
        
        const updatedMessages = state.messages.map((msg, idx) =>
          idx === lastAssistantIdx
            ? { ...msg, content: msg.content + event.payload, timestamp: Date.now() }
            : msg
        )
        return {
          ...state,
          messages: updatedMessages
        }
      }
    
    default:
      return state
  }
}

interface AIChatProviderProps {
  children: ReactNode
}

export function AIChatProvider({ children }: AIChatProviderProps) {
  const [state, dispatch] = useReducer(aiChatReducer, initialState, (initial) => {
    let savedMessages: ChatMessage[] = []
    let savedConversationId: string | null = null
    
    try {
      const savedHistory = localStorage.getItem(CHAT_HISTORY_KEY)
      if (savedHistory) {
        const parsed = JSON.parse(savedHistory)
        if (Array.isArray(parsed) && parsed.length > 0) {
          savedMessages = parsed
        }
      }
      
      const savedId = localStorage.getItem(CONVERSATION_ID_KEY)
      if (savedId) {
        savedConversationId = savedId
      }
    } catch (error) {
      console.warn('[Context7] 加载保存的状态失败:', error)
    }
    
    if (savedMessages.length === 0) {
      savedMessages = [createInitialMessage()]
    }
    
    return {
      ...initial,
      messages: savedMessages,
      conversationId: savedConversationId
    }
  })

  const abortControllerRef = useRef<AbortController | null>(null)
  const messageIdRef = useRef<string>('')
  const listenersRef = useRef<Set<(state: AIChatState) => void>>(new Set())

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])

  useEffect(() => {
    try {
      const messagesToSave = state.messages.slice(-MAX_HISTORY_MESSAGES)
      localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(messagesToSave))
      
      if (state.conversationId) {
        localStorage.setItem(CONVERSATION_ID_KEY, state.conversationId)
      }
    } catch (error) {
      console.warn('[Context7] 保存状态失败:', error)
    }
    
    listenersRef.current.forEach(listener => listener(state))
  }, [state.messages, state.conversationId])

  const sendMessage = useCallback(async (content: string, retryCount = 0) => {
    if (!content.trim() || state.status === 'loading' || state.status === 'streaming') {
      return
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    abortControllerRef.current = new AbortController()

    const userMessage: ChatMessage = {
      id: generateMessageId(),
      role: 'user',
      content: content.trim(),
      timestamp: Date.now()
    }

    const loadingMessageId = generateMessageId()
    messageIdRef.current = loadingMessageId

    dispatch({ type: 'SEND_MESSAGE', payload: { content: content.trim() } })
    dispatch({ type: 'ADD_USER_MESSAGE', payload: userMessage })

    const assistantPlaceholder: ChatMessage = {
      id: loadingMessageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now()
    }

    dispatch({ type: 'ADD_ASSISTANT_MESSAGE', payload: { content: '', messageId: loadingMessageId } })

    const conversationMessages = state.messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .concat([userMessage])

    const apiEndpoint = getAPIEndpoint()

    try {
      dispatch({ type: 'SET_STATUS', payload: 'streaming' })

      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${VOLCANO_API_KEY}`
        },
        body: JSON.stringify({
          model: VOLCANO_MODEL_ID,
          messages: conversationMessages.map(m => ({
            role: m.role,
            content: m.content
          })),
          stream: true,
          max_tokens: 2048,
          temperature: 0.3
        }),
        signal: abortControllerRef.current.signal
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('[Context7] API错误:', response.status, errorText.substring(0, 100))
        throw new Error(`API 错误: ${response.status}`)
      }

      console.log('[Context7] API响应已接收，开始读取流')

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('无法读取响应流')
      }

      const decoder = new TextDecoder()
      let buffer = ''
      let assistantContent = ''
      let chunkCount = 0
      let hasValidContent = false
      let firstByteReceived = false
      let lastActivityTime = Date.now()
      const startTime = Date.now()

      while (true) {
        if (abortControllerRef.current?.signal.aborted) {
          console.log('[Context7] 请求被中止')
          dispatch({ type: 'SET_STATUS', payload: 'idle' })
          return
        }

        const currentTime = Date.now()
        const elapsedTime = currentTime - startTime
        const timeSinceLastActivity = currentTime - lastActivityTime

        if (elapsedTime > CHAT_TIMEOUT_MS) {
          break
        }

        try {
          const readResult = await Promise.race([
            reader.read(),
            new Promise<{ done: boolean; value?: Uint8Array }>((_, reject) => 
              abortControllerRef.current?.signal.addEventListener('abort', () => reject(new Error('aborted')))
            )
          ])

          lastActivityTime = currentTime
          const { done, value } = readResult

          if (done) {
            break
          }

          if (!firstByteReceived) {
            firstByteReceived = true
          }

          chunkCount++

          if (!value || value.length > 50000) {
            continue
          }

          const rawText = decoder.decode(value, { stream: true })
          
          buffer += rawText
          
          if (buffer.length > 100000) {
            buffer = buffer.slice(-50000)
          }

          const lines = buffer.split('\n')
          
          for (let i = 0; i < lines.length - 1; i++) {
            const line = lines[i].trim()
            if (!line) continue
            
            if (line === 'data: [DONE]' || line === '[DONE]') {
              continue
            }

            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim()
              
              try {
                const parsed = JSON.parse(data)
                
                const contentPaths = [
                  parsed.choices?.[0]?.delta?.reasoning_content,
                  parsed.choices?.[0]?.message?.reasoning_content,
                  parsed.choices?.[0]?.delta?.content,
                  parsed.choices?.[0]?.message?.content,
                  parsed.result?.choices?.[0]?.message?.content,
                  parsed.data?.choices?.[0]?.message?.content,
                  parsed.response?.choices?.[0]?.message?.content,
                  parsed.content,
                  parsed.text,
                  parsed.answer,
                  parsed.message?.content
                ]
                const content = contentPaths.find(c => typeof c === 'string' && c.length > 0) || ''
                
                const finishReason = parsed.choices?.[0]?.finish_reason ||
                                     parsed.finish_reason

                if (content) {
                  assistantContent += content
                  hasValidContent = true
                  dispatch({ type: 'STREAM_TOKEN', payload: content })
                }

                if (finishReason) {
                  dispatch({ type: 'SET_STATUS', payload: 'success' })
                  return
                } else {
                }
              } catch (parseError) {
              }
            } else {
              try {
                const parsed = JSON.parse(line)
                
                const contentPaths = [
                  parsed.choices?.[0]?.delta?.reasoning_content,
                  parsed.choices?.[0]?.message?.reasoning_content,
                  parsed.choices?.[0]?.delta?.content,
                  parsed.choices?.[0]?.message?.content,
                  parsed.result?.choices?.[0]?.message?.content,
                  parsed.data?.choices?.[0]?.message?.content,
                  parsed.response?.choices?.[0]?.message?.content,
                  parsed.content,
                  parsed.text,
                  parsed.answer,
                  parsed.message?.content
                ]
                const content = contentPaths.find(c => typeof c === 'string' && c.length > 0) || ''
                
                if (content) {
                  assistantContent += content
                  hasValidContent = true
                  dispatch({ type: 'STREAM_TOKEN', payload: content })
                }
                
                const finishReason = parsed.choices?.[0]?.finish_reason ||
                                     parsed.finish_reason
                if (finishReason) {
                  dispatch({ type: 'SET_STATUS', payload: 'success' })
                  return
                }
              } catch (e) {
              }
            }
          }
          
          buffer = lines[lines.length - 1]

          if (chunkCount % 50 === 0) {
          }
        } catch (error) {
          const readError = error as Error
          if (readError.message === 'aborted') {
            dispatch({ type: 'SET_STATUS', payload: 'idle' })
            return
          }
          throw error
        }
      }

      if (!hasValidContent || assistantContent.length === 0) {
        if (retryCount < MAX_RETRIES) {
          dispatch({ type: 'SET_STATUS', payload: 'idle' })
          await new Promise(resolve => setTimeout(resolve, 500))
          return sendMessage(content, retryCount + 1)
        }
        
        const fallbackContent = createFallbackResponse(content)
        dispatch({
          type: 'ADD_ASSISTANT_MESSAGE',
          payload: { content: fallbackContent, messageId: loadingMessageId }
        })
        dispatch({ type: 'SET_STATUS', payload: 'success' })
      } else {
        dispatch({ type: 'SET_STATUS', payload: 'success' })
      }
    } catch (error) {
      if (abortControllerRef.current?.signal.aborted) {
        dispatch({ type: 'SET_STATUS', payload: 'idle' })
      } else if (retryCount < MAX_RETRIES) {
        dispatch({ type: 'SET_STATUS', payload: 'idle' })
        await new Promise(resolve => setTimeout(resolve, 500))
        return sendMessage(content, retryCount + 1)
      } else {
        dispatch({ 
          type: 'SET_ERROR', 
          payload: error instanceof Error ? error.message : '未知错误' 
        })
      }
    }
  }, [state.messages, state.status])

  const clearHistory = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    
    dispatch({ type: 'CLEAR_HISTORY' })
    
    try {
      localStorage.removeItem(CHAT_HISTORY_KEY)
      localStorage.removeItem(CONVERSATION_ID_KEY)
    } catch {}
  }, [])

  const retryLastMessage = useCallback(async () => {
    const lastUserMessage = [...state.messages]
      .reverse()
      .find(m => m.role === 'user')
    
    if (lastUserMessage && lastUserMessage.content) {
      await sendMessage(lastUserMessage.content)
    }
  }, [state.messages, sendMessage])

  const cancelGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    
    dispatch({ type: 'SET_STATUS', payload: 'idle' })
  }, [])

  const deleteMessage = useCallback((messageId: string) => {
    dispatch({
      type: 'SET_STATUS',
      payload: state.messages.length === 1 ? 'idle' : state.status
    })
  }, [state.messages.length, state.status])

  const setStatus = useCallback((status: AIChatState['status']) => {
    dispatch({ type: 'SET_STATUS', payload: status })
  }, [])

  const setError = useCallback((error: string | null) => {
    dispatch({ type: 'SET_ERROR', payload: error })
  }, [])

  const value = useMemo(() => ({
    ...state,
    sendMessage,
    clearHistory,
    retryLastMessage,
    cancelGeneration,
    deleteMessage,
    setStatus,
    setError
  }), [state, sendMessage, clearHistory, retryLastMessage, cancelGeneration, deleteMessage, setStatus, setError])

  return (
    <AIChatContext.Provider value={value}>
      {children}
    </AIChatContext.Provider>
  )
}

export function useAIChat(): AIChatContextValue {
  const context = useContext(AIChatContext)
  if (!context) {
    throw new Error('useAIChat 必须在 AIChatProvider 内部使用')
  }
  return context
}

export function useAIChatSelector<T>(selector: (state: AIChatState) => T): T {
  const context = useContext(AIChatContext)
  if (!context) {
    throw new Error('useAIChatSelector 必须在 AIChatProvider 内部使用')
  }
  
  const [selected, setSelected] = useState(() => selector(context))
  
  useEffect(() => {
    const listener = (newState: AIChatState) => {
      setSelected(selector(newState))
    }
    
    return () => {}
  }, [selector, context])
  
  return selected
}

export default AIChatContext
