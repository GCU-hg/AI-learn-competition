import api from './api'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: { title: string; url: string }[]
}

const VOLCANO_API_KEY = import.meta.env.VITE_VOLCANO_API_KEY || ''
const VOLCANO_MODEL_ID = import.meta.env.VITE_VOLCANO_MODEL_ID || ''
const VOLCANO_API_URL = import.meta.env.VITE_VOLCANO_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions'
const VOLCANO_USE_PROXY = import.meta.env.VITE_USE_PROXY === 'true' && !import.meta.env.PROD

const getApiUrl = (): string => {
  if (VOLCANO_USE_PROXY) {
    return '/api/volcano/chat/completions'
  }
  return VOLCANO_API_URL
}

const getHealthCheckUrl = (): string => {
  if (VOLCANO_USE_PROXY) {
    return '/api/volcano/health'
  }
  return VOLCANO_API_URL
}

let apiHealthStatus: 'unknown' | 'healthy' | 'unhealthy' = 'unknown'
let lastHealthCheck: number = 0
const HEALTH_CHECK_INTERVAL = 60000
const HEALTH_CHECK_TIMEOUT = 5000

export function getApiStatus(): typeof apiHealthStatus {
  return apiHealthStatus
}

export async function checkApiHealth(): Promise<boolean> {
  const now = Date.now()
  
  if (now - lastHealthCheck < HEALTH_CHECK_INTERVAL && apiHealthStatus === 'healthy') {
    return true
  }
  
  try {
    const healthUrl = getHealthCheckUrl()
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT)
    
    const response = await fetch(healthUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      },
      signal: controller.signal
    })
    
    clearTimeout(timeoutId)
    
    if (response.ok) {
      apiHealthStatus = 'healthy'
      lastHealthCheck = now
      console.log('[AI API] 后端服务健康检查通过')
      return true
    } else {
      apiHealthStatus = 'unhealthy'
      lastHealthCheck = now
      console.warn('[AI API] 后端服务健康检查失败:', response.status)
      return false
    }
  } catch (error) {
    apiHealthStatus = 'unhealthy'
    lastHealthCheck = now
    console.warn('[AI API] 后端服务不可用:', error)
    return false
  }
}

export async function* streamChat(messages: ChatMessage[]): AsyncGenerator<ChatMessage, void, unknown> {
  await new Promise(r => setTimeout(r, 800))
  
  const lastUserMessage = messages.filter(m => m.role === 'user').pop()
  const userContent = lastUserMessage?.content || ''
  
  let response = ''
  if (userContent.includes('电路') || userContent.includes('电阻') || userContent.includes('电压') || 
      userContent.includes('电容') || userContent.includes('电感') || userContent.includes('Simulink')) {
    response = '这是一个关于电路或Simulink的问题。我可以帮你：\n\n1. 分析电路原理\n2. 解释电路元件特性\n3. 指导Simulink建模方法\n4. 回答相关概念问题\n\n请详细描述你的问题，我会尽力解答！'
  } else if (userContent.includes('你好') || userContent.includes('hello') || userContent.includes('hi')) {
    response = '你好！我是Simulink AI助手，专门为电路仿真和建模学习帮助。\n\n我可以帮你：\n• 解答电路相关问题\n• 解释Simulink使用方法\n• 设计电路方案\n• 分析仿真结果\n\n请告诉我你需要什么帮助？'
  } else {
    response = '收到你的问题了！作为一个电路仿真学习助手，我可以帮你：\n\n• 解答电路分析问题\n• 解释电子元件原理\n• 指导Simulink建模\n• 设计电路方案\n\n请详细描述你的问题，我会尽力帮助你！'
  }
  
  const chars = response.split('')
  for (let i = 0; i < chars.length; i++) {
    await new Promise(r => setTimeout(r, i < 30 ? 10 : 20))
    yield { id: `local-${Date.now()}-${Math.random()}`, role: 'assistant', content: chars[i], sources: [{ title: 'Simulink学习助手', url: '#' }] }
  }
}

interface VolcanoInputItem {
  role: 'user' | 'assistant' | 'system'
  content: {
    type: 'input_text'
    text: string
  }[]
}

interface VolcanoRequestBody {
  model: string
  input: VolcanoInputItem[]
  stream?: boolean
}

function buildRequestBody(messages: ChatMessage[], modelId: string): Record<string, unknown> {
  const formattedMessages = messages
    .filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'system')
    .map(m => {
      const textContent = Array.isArray(m.content) 
        ? m.content.map(c => (c as { type: string; text: string }).text || '').join('')
        : String(m.content)
      
      return {
        role: m.role,
        content: textContent
      }
    })
  
  return {
    model: modelId,
    messages: formattedMessages,
    stream: true
  }
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries: number = 2
): Promise<Response> {
  let lastError: Error | null = null
  
  const timeoutMs = 120000
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      })
      
      clearTimeout(timeoutId)
      return response
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      console.warn(`API请求尝试 ${attempt + 1} 失败:`, lastError.message)
      
      if (lastError.name === 'AbortError') {
        console.warn(`请求超时（${timeoutMs / 1000}秒），重试...`)
      }
      
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)))
      }
    }
  }
  
  throw lastError
}

function extractTextFromJSON(responseData: Record<string, unknown>): string {
  console.log('🔍 解析响应，响应类型:', responseData.object)
  
  const choices = responseData.choices
  if (choices && Array.isArray(choices) && choices.length > 0) {
    const choice = choices[0] as Record<string, unknown>
    const message = choice.message as Record<string, unknown> | undefined
    if (message?.content) {
      console.log('✅ 从 choices[0].message.content 提取内容')
      return String(message.content)
    }
  }
  
  const output = responseData.output
  if (output && Array.isArray(output)) {
    for (const item of output) {
      const itemTyped = item as Record<string, unknown>
      if (itemTyped.type === 'message' && itemTyped.role === 'assistant') {
        const content = itemTyped.content as Array<Record<string, unknown>>
        if (content && Array.isArray(content)) {
          for (const contentItem of content) {
            if (contentItem.type === 'output_text' && contentItem.text) {
              return String(contentItem.text)
            }
          }
        }
      }
      
      if (itemTyped.type === 'reasoning' && itemTyped.summary) {
        const summary = itemTyped.summary as Array<Record<string, unknown>>
        if (summary && Array.isArray(summary)) {
          for (const summaryItem of summary) {
            if (summaryItem.type === 'summary_text' && summaryItem.text) {
              return String(summaryItem.text)
            }
          }
        }
      }
    }
  }
  
  console.warn('⚠️ 未找到有效的回复内容')
  return ''
}

async function fetchDirectAPI(_requestBody: Record<string, unknown>): Promise<string> {
  throw new Error('直接API调用需要在Node.js环境中运行，请在开发环境使用代理模式')
}

export async function* sendVolcanoMessage(
  messages: ChatMessage[],
  onThinking?: (content: string) => void,
  onCleanup?: () => void
): AsyncGenerator<{ content: string }, void, unknown> {
  if (!VOLCANO_API_KEY || !VOLCANO_MODEL_ID) {
    yield { content: '⚠️ AI服务未配置\n\n请在环境变量中设置：\n- VITE_VOLCANO_API_KEY：火山引擎API密钥\n- VITE_VOLCANO_MODEL_ID：模型ID\n\n当前使用模拟回复。\n\n您可以直接描述电路需求，我会自动生成电路图。' }
    return
  }

  const apiUrl = getApiUrl()
  const requestBody = buildRequestBody(messages, VOLCANO_MODEL_ID) as { messages: Array<{ role: string; content: string }>; stream: boolean }
  const useProxy = import.meta.env.VITE_USE_PROXY === 'true' && !import.meta.env.PROD

  console.log('火山引擎 API 请求配置:', {
    url: apiUrl,
    model: VOLCANO_MODEL_ID,
    messageCount: requestBody.messages?.length || 0,
    stream: requestBody.stream,
    useProxy
  })

  const controller = new AbortController()
  const timeoutMs = 120000
  const timeoutId = setTimeout(() => {
    controller.abort()
    onCleanup?.()
  }, timeoutMs)

  let response: Response | null = null
  let responseCloned: Response | null = null
  let streamReader: ReadableStreamDefaultReader | null = null

  try {
    if (useProxy) {
      response = await fetchWithRetry(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${VOLCANO_API_KEY}`,
          'Accept': 'text/event-stream, application/json'
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      })
    } else {
      console.log('使用直接API调用模式...')
      try {
        const content = await fetchDirectAPI(requestBody as unknown as Record<string, unknown>)
        console.log('✅ 直接API调用成功，回复长度:', content.length)
        clearTimeout(timeoutId)
        for (const char of content) {
          yield { content: char }
        }
        return
      } catch (directError) {
        console.warn('直接API调用失败，尝试代理...', directError)
        response = await fetchWithRetry(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${VOLCANO_API_KEY}`,
            'Accept': 'text/event-stream, application/json'
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        })
      }
    }

    clearTimeout(timeoutId)

    console.log('火山引擎 API 响应状态:', response.status, response.statusText)

    if (!response.ok) {
      apiHealthStatus = 'unhealthy'
      lastHealthCheck = Date.now()
      
      let errorMessage = ''
      
      try {
        const textData = await response.text()
        errorMessage = textData
        console.error('火山引擎 API 错误响应:', errorMessage.substring(0, 500))
      } catch {
        errorMessage = '无法读取错误响应内容'
      }
      
      if (response.status === 401) {
        yield { content: '❌ API认证失败 (401)\n\n请检查API密钥是否正确。\n\n当前配置的密钥前缀: ' + VOLCANO_API_KEY.substring(0, 8) + '...' }
      } else if (response.status === 403) {
        if (errorMessage.includes('AccountOverdue') || errorMessage.includes('欠费')) {
          yield { content: '❌ 账户余额不足 (403)\n\n火山引擎账户可能已欠费或免费额度已用完。\n请登录火山引擎控制台检查账户状态。\n\n错误信息: ' + errorMessage.substring(0, 200) }
        } else {
          yield { content: '❌ API访问被拒绝 (403)\n\n可能原因：\n1. 模型ID无权访问\n2. IP地址被限制\n3. 账户权限不足\n\n错误信息: ' + errorMessage.substring(0, 200) }
        }
      } else if (response.status === 404) {
        yield { content: '❌ API端点不存在 (404)\n\n请检查模型ID是否正确。\n当前模型ID: ' + VOLCANO_MODEL_ID }
      } else if (response.status === 429) {
        yield { content: '❌ API请求过于频繁 (429)\n\n请稍后再试或降低请求频率。' }
      } else if (response.status >= 500) {
        yield { content: '❌ API服务器错误 (' + response.status + ')\n\n火山引擎服务器暂时不可用，请稍后再试。\n\n错误信息: ' + errorMessage.substring(0, 200) }
      } else {
        yield { content: '❌ API调用失败 (' + response.status + ')\n\n' + errorMessage.substring(0, 300) + '\n\n请检查API配置和网络连接。' }
      }
      return
    }

    apiHealthStatus = 'healthy'
    lastHealthCheck = Date.now()

    const contentType = response.headers.get('content-type') || ''

    const isEventStream = contentType.includes('text/event-stream')
    const isJsonResponse = contentType.includes('application/json')

    if (isEventStream) {
      streamReader = response.body?.getReader() || null
      if (!streamReader) {
        yield { content: '❌ 无法读取响应流' }
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''
      let responseContent = ''
      let emptyCount = 0
      const maxEmptyChunks = 50
      let totalChunks = 0
      const maxTotalChunks = 5000
      let isFinished = false
      let streamError: Error | null = null

      try {
        while (!isFinished && totalChunks < maxTotalChunks) {
          const { done, value } = await streamReader.read()
          totalChunks++
          
          if (done) {
            break
          }

          if (!value || value.length === 0) {
            emptyCount++
            if (emptyCount >= maxEmptyChunks) {
              break
            }
            continue
          }

          emptyCount = 0
          buffer += decoder.decode(value, { stream: true })
          
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.trim()) continue
            
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim()
              
              if (!data || data === '[DONE]') {
                if (data === '[DONE]') {
                  isFinished = true
                }
                continue
              }
              
              try {
                const parsed = JSON.parse(data)
                
                let content = ''
                
                if (parsed.choices && Array.isArray(parsed.choices) && parsed.choices.length > 0) {
                  const choice = parsed.choices[0]
                  content = choice.delta?.content || choice.message?.content || ''
                  
                  if (choice.finish_reason === 'stop' || choice.finish_reason === 'length') {
                    isFinished = true
                  }
                } else if (parsed.type === 'response.output_text.delta' && parsed.delta) {
                  content = String(parsed.delta)
                } else if (parsed.type === 'response.content_part.added' && parsed.part?.text) {
                  content = String(parsed.part.text)
                } else if (parsed.type === 'response.output_item.added' && parsed.item?.content) {
                  const contentArr = parsed.item.content as Array<{ text?: string }>
                  content = contentArr.map(c => c.text || '').join('')
                } else if (parsed.response?.status === 'completed' || parsed.type === 'response.completed') {
                  isFinished = true
                }
                
                if (content) {
                  responseContent += content
                  yield { content }
                }
              } catch (parseError) {
                console.error('SSE数据解析失败:', parseError, '原始数据:', data.substring(0, 200))
              }
            }
          }

          if (buffer.length > 100000) {
            buffer = buffer.slice(-20000)
          }
        }
      } catch (error) {
        streamError = error instanceof Error ? error : new Error(String(error))
      }

      try {
        streamReader.releaseLock()
      } catch (lockError) {
        console.warn('释放streamReader锁失败:', lockError)
      }

      if (!responseContent || responseContent.trim().length < 2) {
        if (!streamError || responseContent.length > 0) {
          yield { content: '⚠️ AI未返回有效回复，请重试。' }
        }
      }
    } else if (isJsonResponse || !contentType) {
      console.log('检测到 JSON 响应，开始解析...')
      
      try {
        const textData = await response.text()
        
        if (!textData || textData.trim().length === 0) {
          console.error('⚠️ API返回空响应')
          yield { content: '⚠️ API返回空响应，请稍后重试。' }
          return
        }

        console.log('JSON 响应长度:', textData.length, '字符')

        let responseData: Record<string, unknown> = {}
        try {
          responseData = JSON.parse(textData)
          console.log('JSON 解析成功，响应键:', Object.keys(responseData))
        } catch (parseError) {
          console.error('❌ JSON解析失败:', parseError)
          console.error('原始响应前300字符:', textData.substring(0, 300))
          
          if (textData.includes('reasoning') || textData.includes('output_text')) {
            console.log('⚠️ 响应包含有效数据但解析失败，尝试手动提取...')
            yield { content: '⚠️ 响应格式异常，但检测到有效回复。请刷新页面重试。' }
          } else {
            yield { content: '⚠️ API响应格式异常，无法解析。\n\n原始响应: ' + textData.substring(0, 100) + '...\n\n请检查API配置或稍后重试。' }
          }
          return
        }

        const content = extractTextFromJSON(responseData)
        console.log('提取的回复内容:', content)

        if (content) {
          console.log('✅ 成功提取回复，开始流式输出...')
          for (const char of content) {
            yield { content: char }
          }
          console.log('✅ 回复输出完成')
        } else {
          console.warn('⚠️ 未找到有效的回复内容')
          const outputInfo = JSON.stringify(responseData.output, null, 2)
          console.warn('output结构:', outputInfo.substring(0, 500))
          const outputLength = Array.isArray(responseData.output) ? responseData.output.length : 0
          yield { content: '⚠️ API返回了数据但未找到有效的回复内容。\n\n调试信息: ' + (outputLength > 0 ? `output包含${outputLength}个元素` : 'output结构异常') }
        }
      } catch (jsonError) {
        console.error('响应处理错误:', jsonError)
        yield { content: '⚠️ API响应处理失败，请检查网络连接或API配置。\n\n错误详情: ' + (jsonError instanceof Error ? jsonError.message : String(jsonError)) }
      }
    } else {
      console.warn('未知的响应格式:', contentType)
      yield { content: '⚠️ API返回了未知格式的响应。\n\nContent-Type: ' + contentType + '\n\n请刷新页面重试。' }
    }

  } catch (error) {
    clearTimeout(timeoutId)
    
    try {
      if (streamReader) {
        streamReader.releaseLock()
      }
    } catch (lockError) {
      console.warn('释放streamReader锁失败:', lockError)
    }
    
    console.error('火山引擎 API 网络错误:', error)
    apiHealthStatus = 'unhealthy'
    lastHealthCheck = Date.now()
    
    if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
      yield { content: '❌ 网络连接失败\n\n可能原因：\n1. 网络连接不稳定\n2. 代理服务器未正确配置\n3. 防火墙阻止请求\n4. API服务器暂时不可用\n\n请检查：\n- 网络连接状态\n- Vite开发服务器是否运行\n- 代理配置是否正确\n\n本地AI服务仍可使用，请直接描述电路需求。' }
    } else if (error instanceof Error) {
      if (error.name === 'AbortError') {
        yield { content: '❌ API请求超时\n\n火山引擎服务器响应时间过长，请稍后再试。' }
      } else if (error.message.includes('body stream already read')) {
        yield { content: '⚠️ 响应处理异常\n\nAPI响应已被读取，请刷新页面后重试。\n如果问题持续存在，请检查网络连接。' }
      } else {
        yield { content: '❌ 网络错误：' + error.message + '\n\n请检查网络连接或API配置。' }
      }
    } else {
      yield { content: '❌ 未知网络错误\n\n请检查控制台获取详细错误信息。' }
    }
  }
}

export function useVolcanoChat() {
  const sendMessage = async (
    messages: ChatMessage[],
    onChunk: (chunk: { content: string }) => void,
    onError: (error: string) => void
  ) => {
    let fullContent = ''
    try {
      for await (const chunk of sendVolcanoMessage(messages)) {
        fullContent += chunk.content
        onChunk(chunk)
      }
      return fullContent
    } catch (error) {
      console.error('发送消息错误:', error)
      onError('AI服务暂时不可用')
      return null
    }
  }

  return { sendMessage }
}
