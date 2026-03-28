# Context7 使用指南

## 一、概述

Context7 是一个基于 React Context 的统一状态管理模块，专为 AI 聊天应用设计。它提供了完整的状态管理解决方案，包括消息管理、状态跟踪、持久化存储和错误处理功能。

### 主要特性

- **类型安全**: 完整的 TypeScript 类型定义
- **状态持久化**: 自动保存和恢复聊天历史
- **流式响应**: 支持 SSE 流式响应处理
- **错误处理**: 完善的错误捕获和恢复机制
- **性能优化**: 使用 useReducer 和 useMemo 确保高性能

## 二、快速开始

### 2.1 安装与配置

确保项目已安装必要的依赖：

```bash
npm install react react-dom
```

### 2.2 Provider 集成

在应用的根组件中引入 Provider：

```tsx
import { AIChatProvider } from '@contexts/AIChatContext'

function App() {
  return (
    <AIChatProvider>
      <YourApp />
    </AIChatProvider>
  )
}

export default App
```

### 2.3 在组件中使用

使用 `useAIChat` hook 获取状态和操作方法：

```tsx
import { useAIChat } from '@contexts/AIChatContext'

function ChatComponent() {
  const { 
    messages,      // 聊天消息列表
    status,        // 当前状态
    isTyping,      // 是否正在输入
    sendMessage,   // 发送消息
    clearHistory,  // 清除历史
    retryLastMessage, // 重试最后消息
    cancelGeneration, // 取消生成
    setStatus,     // 设置状态
    setError       // 设置错误
  } = useAIChat()

  return (
    <div>
      {messages.map(msg => (
        <div key={msg.id} className={msg.role}>
          {msg.content}
        </div>
      ))}
    </div>
  )
}
```

## 三、API 参考

### 3.1 AIChatProvider

```tsx
interface AIChatProviderProps {
  children: React.ReactNode
}

<AIChatProvider>
  {children}
</AIChatProvider>
```

### 3.2 useAIChat Hook

```tsx
function useAIChat(): AIChatContextValue
```

#### 返回值

| 属性 | 类型 | 说明 |
|------|------|------|
| `messages` | `ChatMessage[]` | 聊天消息列表 |
| `status` | `'idle' \| 'loading' \| 'streaming' \| 'success' \| 'error'` | 当前状态 |
| `isTyping` | `boolean` | 是否正在生成响应 |
| `error` | `string \| null` | 错误信息 |
| `conversationId` | `string \| null` | 对话会话 ID |
| `sendMessage` | `(content: string) => Promise<void>` | 发送消息 |
| `clearHistory` | `() => void` | 清除聊天历史 |
| `retryLastMessage` | `() => Promise<void>` | 重试最后一条消息 |
| `cancelGeneration` | `() => void` | 取消当前生成 |
| `deleteMessage` | `(messageId: string) => void` | 删除指定消息 |
| `setStatus` | `(status: AIChatState['status']) => void` | 设置状态 |
| `setError` | `(error: string \| null) => void` | 设置错误 |

### 3.3 类型定义

```tsx
interface ChatMessage {
  id: string           // 消息唯一标识
  role: 'user' | 'assistant'  // 发送者角色
  content: string      // 消息内容
  timestamp: number    // 时间戳
  sources?: {          // 参考来源（可选）
    title: string
    url: string
  }[]
}

interface AIChatState {
  messages: ChatMessage[]
  status: 'idle' | 'loading' | 'streaming' | 'success' | 'error'
  isTyping: boolean
  error: string | null
  conversationId: string | null
}
```

### 3.4 useAIChatSelector

用于选择状态中的特定部分：

```tsx
function useAIChatSelector<T>(selector: (state: AIChatState) => T): T

// 示例
const messageCount = useAIChatSelector(state => state.messages.length)
const isLoading = useAIChatSelector(state => state.status === 'loading')
```

## 四、使用示例

### 4.1 基础聊天界面

```tsx
import React, { useState } from 'react'
import { useAIChat } from '@contexts/AIChatContext'

export function ChatPanel() {
  const { messages, sendMessage, isTyping, status } = useAIChat()
  const [input, setInput] = useState('')

  const handleSend = async () => {
    if (input.trim()) {
      await sendMessage(input)
      setInput('')
    }
  }

  return (
    <div className="chat-container">
      <div className="messages">
        {messages.map(msg => (
          <div key={msg.id} className={msg.role}>
            {msg.content}
          </div>
        ))}
        {isTyping && <div className="typing">AI 正在思考...</div>}
      </div>
      <div className="input-area">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
        />
        <button onClick={handleSend} disabled={status === 'loading'}>
          发送
        </button>
      </div>
    </div>
  )
}
```

### 4.2 错误处理

```tsx
import { useAIChat } from '@contexts/AIChatContext'

export function ErrorDisplay() {
  const { error, setError } = useAIChat()

  if (!error) return null

  return (
    <div className="error-banner">
      <span>{error}</span>
      <button onClick={() => setError(null)}>关闭</button>
    </div>
  )
}
```

### 4.3 多轮对话

```tsx
import { useAIChat } from '@contexts/AIChatContext'

export function ConversationHistory() {
  const { messages, clearHistory, retryLastMessage } = useAIChat()

  const userMessages = messages.filter(m => m.role === 'user')
  const assistantMessages = messages.filter(m => m.role === 'assistant')

  return (
    <div>
      <div className="stats">
        <span>用户消息: {userMessages.length}</span>
        <span>AI回复: {assistantMessages.length}</span>
      </div>
      <button onClick={clearHistory}>清空对话</button>
      {userMessages.length > 0 && (
        <button onClick={retryLastMessage}>重试最后问题</button>
      )}
    </div>
  )
}
```

### 4.4 状态监控

```tsx
import { useAIChat } from '@contexts/AIChatContext'

export function StatusIndicator() {
  const { status, isTyping } = useAIChat()

  const statusConfig = {
    idle: { color: 'gray', text: '就绪' },
    loading: { color: 'blue', text: '加载中...' },
    streaming: { color: 'blue', text: '生成中...' },
    success: { color: 'green', text: '已完成' },
    error: { color: 'red', text: '出错了' }
  }

  const config = statusConfig[status]

  return (
    <div className="status" style={{ backgroundColor: config.color }}>
      {isTyping ? '思考中...' : config.text}
    </div>
  )
}
```

## 五、状态流程

### 5.1 状态转换图

```
空闲 (idle)
    ↓ [sendMessage]
加载 (loading)
    ↓ [收到响应]
流式 (streaming)
    ↓ [完成/取消]
成功 (success) 或 空闲 (idle)
    ↓ [错误]
错误 (error)
    ↓ [setError(null)]
空闲 (idle)
```

### 5.2 消息流程

1. 用户调用 `sendMessage(content)`
2. 添加用户消息到列表
3. 设置状态为 `streaming`
4. 开始 SSE 流式接收
5. 每收到一个 chunk，更新最后一条消息
6. 完成时设置状态为 `success`
7. 错误时设置状态为 `error`

## 六、持久化

Context7 自动将聊天历史保存到 localStorage：

- **存储键**: `context7_chat_history`
- **最大保存条数**: 100 条消息
- **会话 ID**: `context7_conversation_id`

### 6.1 自定义持久化

```tsx
import { useEffect } from 'react'
import { useAIChat } from '@contexts/AIChatContext'

export function CustomPersistence() {
  const { messages } = useAIChat()

  useEffect(() => {
    // 自定义保存逻辑
    localStorage.setItem('my_chat_history', JSON.stringify(messages))
  }, [messages])

  // ...
}
```

## 七、最佳实践

### 7.1 错误边界

```tsx
import { ErrorBoundary } from 'react-error-boundary'

function ErrorFallback({ error }) {
  return (
    <div>
      <h2>出错了</h2>
      <p>{error.message}</p>
    </div>
  )
}

function App() {
  return (
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      <AIChatProvider>
        <ChatComponent />
      </AIChatProvider>
    </ErrorBoundary>
  )
}
```

### 7.2 性能优化

```tsx
// 使用 useMemo 缓存选择器
const messages = useAIChatSelector(
  React.useCallback(state => state.messages, [])
)

// 使用 useRef 保存不触发重渲染的数据
const abortRef = useRef(null)
```

### 7.3 测试

```tsx
import { render, screen } from '@testing-library/react'
import { AIChatProvider, useAIChat } from '@contexts/AIChatContext'

test('发送消息', async () => {
  const TestComponent = () => {
    const { sendMessage } = useAIChat()
    return <button onClick={() => sendMessage('测试')}>发送</button>
  }

  render(
    <AIChatProvider>
      <TestComponent />
    </AIChatProvider>
  )
})
```

## 八、故障排查

### 8.1 常见问题

**问题: "useAIChat 必须在 AIChatProvider 内部使用"**

```tsx
// 错误 ❌
function MyComponent() {
  const chat = useAIChat() // 抛出错误
  return <div>{chat.status}</div>
}

// 正确 ✅
function MyComponent() {
  const chat = useAIChat()
  return <div>{chat.status}</div>
}

function App() {
  return (
    <AIChatProvider>
      <MyComponent />
    </AIChatProvider>
  )
}
```

**问题: 消息没有保存**

- 检查 localStorage 是否正常工作
- 确认消息数量未超过 100 条限制
- 检查浏览器控制台是否有错误

**问题: 状态不更新**

- 确认使用了正确的状态更新方法
- 检查是否有异步操作未完成
- 查看是否触发了 React 的严格模式警告

### 8.2 调试技巧

启用调试日志：

```tsx
// 在组件中添加
useEffect(() => {
  console.log('[Context7] 状态变化:', currentState)
}, [currentState])
```

## 九、版本历史

### v1.0.0 (2026-01-12)

- 初始版本发布
- 基础状态管理功能
- 流式响应支持
- 持久化存储
- 完整的 TypeScript 类型定义

---

文档版本: 1.0.0  
最后更新: 2026-01-12
