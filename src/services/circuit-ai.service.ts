import api from './api'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string | CircuitContentBlock[]
  sources?: { title: string; url: string }[]
  timestamp?: number
}

export interface CircuitContentBlock {
  type: 'text' | 'circuit' | 'simulation' | 'waveform' | 'parameter_adjustment'
  data: Record<string, unknown>
}

export interface CircuitIntent {
  action: 'create_circuit' | 'adjust_parameters' | 'modify_structure' | 'run_simulation' | 'answer_directly' | 'query_result'
  confidence: number
  analysis_type?: 'dc' | 'ac' | 'transient'
  circuit_type?: string
  parameters?: Record<string, unknown>
  target_component?: string
  description?: string
}

export interface CircuitOperationRequest {
  operation: 'create' | 'adjust_parameter' | 'modify_structure' | 'run_simulation' | 'query'
  description: string
  language?: string
  current_circuit?: CircuitData
  analysis_type?: string
  parameters?: Record<string, unknown>
}

export interface CircuitData {
  nodes: CircuitNode[]
  components: CircuitComponent[]
}

export interface CircuitNode {
  id: string
  type: 'terminal' | 'probe' | 'junction'
  x: number
  y: number
  label?: string
}

export interface CircuitComponent {
  id: string
  name: string
  type: 'voltage_source' | 'resistor' | 'capacitor' | 'inductor' | 'transistor' | 'op_amp' | 'diode'
  nodes: string[]
  params: {
    value?: number
    unit?: string
    [key: string]: unknown
  }
}

export interface SimulationResult {
  success: boolean
  method: string
  message: string
  result: {
    solution?: Record<string, number>
    transient?: {
      time: number[]
      values: Record<string, number[]>
    }
    ac?: {
      frequency: number[]
      magnitude: Record<string, number[][]>
      phase: Record<string, number[][]>
    }
  }
  error?: string
}

export interface AIResponse {
  success: boolean
  message: string
  data?: {
    circuit?: CircuitData
    simulation?: SimulationResult
    intent?: CircuitIntent
    content_blocks?: CircuitContentBlock[]
  }
  error?: string
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080'
const VOLCANO_API_KEY = import.meta.env.VITE_VOLCANO_API_KEY || ''
const VOLCANO_MODEL_ID = import.meta.env.VITE_VOLCANO_MODEL_ID || ''
const VOLCANO_API_URL = import.meta.env.VITE_VOLCANO_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions'

let apiHealthStatus: 'unknown' | 'healthy' | 'unhealthy' = 'unknown'
let lastHealthCheck: number = 0
const HEALTH_CHECK_INTERVAL = 60000

export function getApiStatus(): typeof apiHealthStatus {
  return apiHealthStatus
}

export async function checkApiHealth(): Promise<boolean> {
  const now = Date.now()
  
  if (now - lastHealthCheck < HEALTH_CHECK_INTERVAL) {
    return apiHealthStatus === 'healthy'
  }
  
  try {
    const healthUrl = `${API_BASE_URL}/health`
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)
    
    const response = await fetch(healthUrl, {
      method: 'GET',
      signal: controller.signal
    })
    
    clearTimeout(timeoutId)
    
    if (response.ok) {
      apiHealthStatus = 'healthy'
      lastHealthCheck = now
      return true
    } else {
      apiHealthStatus = 'unhealthy'
      lastHealthCheck = now
      return false
    }
  } catch {
    apiHealthStatus = 'unhealthy'
    lastHealthCheck = now
    return false
  }
}

export async function* streamChat(
  messages: ChatMessage[],
  context?: {
    circuit?: CircuitData
    simulationResult?: SimulationResult
    currentStep?: string
  }
): AsyncGenerator<AIResponse & { delta?: string }, void, unknown> {
  console.log('[CircuitAI] 开始流式对话，消息数:', messages.length)
  
  if (!VOLCANO_API_KEY || !VOLCANO_MODEL_ID) {
    yield {
      success: false,
      message: 'AI服务未配置',
      error: '请配置火山引擎API密钥'
    }
    return
  }

  const circuitContext = context?.circuit ? `
当前电路状态:
- 节点数: ${context.circuit.nodes.length}
- 元件数: ${context.circuit.components.length}
- 元件列表: ${context.circuit.components.map(c => `${c.name}(${c.type})`).join(', ')}
` : ''

  const simulationContext = context?.simulationResult ? `
最近仿真结果:
- 分析类型: ${context.simulationResult.method}
- 状态: ${context.simulationResult.success ? '成功' : '失败'}
- 消息: ${context.simulationResult.message}
` : ''

  const systemPrompt = `你是一个专业的电路仿真AI助手。你的任务是：

1. **电路设计**: 根据用户描述生成电路图
2. **参数调整**: 分析仿真结果，调整电路参数
3. **结构调整**: 修改电路结构以满足性能要求
4. **仿真分析**: 运行仿真并解释结果
5. **可视化**: 生成波形图和仿真结果

当前步骤: ${context?.currentStep || '等待用户输入'}

${circuitContext}
${simulationContext}

请始终以JSON格式回复，格式如下:
{
  "success": true,
  "message": "你的回复",
  "data": {
    "intent": {
      "action": "create_circuit | adjust_parameters | modify_structure | run_simulation | answer_directly | query_result",
      "confidence": 0.95,
      "analysis_type": "dc | ac | transient",
      "circuit_type": "共射放大电路",
      "parameters": {"R": 1000, "C": 0.000001}
    },
    "content_blocks": [
      {"type": "text", "data": {"content": "解释文本"}},
      {"type": "circuit", "data": {"circuit_data": {...}}},
      {"type": "simulation", "data": {"analysis_type": "transient", "parameters": {...}}},
      {"type": "waveform", "data": {"waveform_url": "...", "description": "..."}},
      {"type": "parameter_adjustment", "data": {"component": "R1", "old_value": 1000, "new_value": 2000, "reason": "增益调整"}}
    ]
  }
}

如果用户只是提问，不需要执行操作:
{
  "success": true,
  "message": "你的回答",
  "data": {
    "intent": {
      "action": "answer_directly",
      "confidence": 0.95
    },
    "content_blocks": [
      {"type": "text", "data": {"content": "详细回答"}}
    ]
  }
}`

  const formattedMessages = messages.map(m => ({
    role: m.role as 'user' | 'assistant' | 'system',
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
  }))

  const allMessages = [
    { role: 'system', content: systemPrompt },
    ...formattedMessages
  ]

  try {
    const response = await fetch(VOLCANO_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${VOLCANO_API_KEY}`,
        'Accept': 'text/event-stream, application/json'
      },
      body: JSON.stringify({
        model: VOLCANO_MODEL_ID,
        messages: allMessages,
        stream: true,
        temperature: 0.7,
        max_tokens: 4096
      })
    })

    if (!response.ok) {
      yield {
        success: false,
        message: `API错误: ${response.status}`,
        error: response.statusText
      }
      return
    }

    apiHealthStatus = 'healthy'
    lastHealthCheck = Date.now()

    const decoder = new TextDecoder()
    const stream = response.body
    if (!stream) {
      yield { success: false, message: '无法读取响应流', error: 'Stream is null' }
      return
    }

    const reader = stream.getReader()
    let buffer = ''
    let fullContent = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim() || !line.startsWith('data: ')) continue

        const data = line.slice(6).trim()
        if (data === '[DONE]') break

        try {
          const parsed = JSON.parse(data)
          const content = parsed.choices?.[0]?.delta?.content || parsed.choices?.[0]?.message?.content || ''
          
          if (content) {
            fullContent += content
            yield { success: true, message: content, delta: content }
          }
        } catch {
          console.warn('[CircuitAI] JSON解析跳过:', data.substring(0, 100))
        }
      }
    }

    if (fullContent) {
      try {
        const jsonMatch = fullContent.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const parsedResponse = JSON.parse(jsonMatch[0])
          yield {
            success: parsedResponse.success ?? true,
            message: parsedResponse.message || fullContent,
            data: parsedResponse.data
          }
        } else {
          yield { success: true, message: fullContent }
        }
      } catch {
        yield { success: true, message: fullContent }
      }
    }

  } catch (error) {
    console.error('[CircuitAI] API调用失败:', error)
    yield {
      success: false,
      message: 'API调用失败',
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function analyzeCircuitIntent(
  description: string,
  currentCircuit?: CircuitData
): Promise<CircuitIntent> {
  console.log('[CircuitAI] 分析意图:', description.substring(0, 100))

  const circuitContext = currentCircuit ? `
当前电路:
- 元件: ${currentCircuit.components.map(c => c.name).join(', ')}
- 节点: ${currentCircuit.nodes.map(n => n.label || n.id).join(', ')}
` : ''

  const prompt = `分析以下电路描述，返回JSON格式的意图:

描述: "${description}"
${circuitContext}

返回格式:
{
  "action": "create_circuit | adjust_parameters | modify_structure | run_simulation | answer_directly | query_result",
  "confidence": 0.0-1.0,
  "analysis_type": "dc | ac | transient | null",
  "circuit_type": "电路类型描述",
  "parameters": {"参数名": 值},
  "target_component": "目标元件ID",
  "description": "操作描述"
}`

  try {
    const response = await fetch(VOLCANO_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${VOLCANO_API_KEY}`
      },
      body: JSON.stringify({
        model: VOLCANO_MODEL_ID,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 512
      })
    })

    if (!response.ok) {
      throw new Error(`API错误: ${response.status}`)
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || ''
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as CircuitIntent
    }
  } catch (error) {
    console.warn('[CircuitAI] 意图分析失败，使用规则引擎:', error)
  }

  return analyzeIntentLocally(description)
}

function analyzeIntentLocally(description: string): CircuitIntent {
  const desc = description.toLowerCase()
  
  if (desc.includes('设计') || desc.includes('创建') || desc.includes('生成') || desc.includes('搭建')) {
    return { action: 'create_circuit', confidence: 0.9 }
  }
  
  if (desc.includes('调整') || desc.includes('修改') || desc.includes('改变') || desc.includes('增加') || desc.includes('减小')) {
    return { action: 'adjust_parameters', confidence: 0.85 }
  }
  
  if (desc.includes('仿真') || desc.includes('运行') || desc.includes('分析') || desc.includes('模拟')) {
    const analysisType = desc.includes('瞬态') || desc.includes('时间') ? 'transient' 
      : desc.includes('交流') || desc.includes('频率') ? 'ac' 
      : 'dc'
    return { action: 'run_simulation', confidence: 0.9, analysis_type: analysisType }
  }
  
  if (desc.includes('结果') || desc.includes('波形') || desc.includes('电压') || desc.includes('电流')) {
    return { action: 'query_result', confidence: 0.8 }
  }
  
  if (desc.includes('结构') || desc.includes('拓扑') || desc.includes('连接')) {
    return { action: 'modify_structure', confidence: 0.85 }
  }
  
  return { action: 'answer_directly', confidence: 0.7 }
}

export async function createCircuit(description: string, language: string = 'zh-CN'): Promise<AIResponse> {
  console.log('[CircuitAI] 创建电路:', description.substring(0, 100))

  try {
    const response = await fetch(`${API_BASE_URL}/julia/circuit/describe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description, language })
    })

    if (!response.ok) {
      throw new Error(`后端错误: ${response.status}`)
    }

    const data = await response.json()
    
    if (data.success && data.circuit_data) {
      return {
        success: true,
        message: '电路创建成功',
        data: {
          circuit: data.circuit_data,
          content_blocks: [
            {
              type: 'circuit',
              data: { circuit_data: data.circuit_data }
            }
          ]
        }
      }
    } else {
      throw new Error(data.error || '电路解析失败')
    }
  } catch (error) {
    console.error('[CircuitAI] 创建电路失败:', error)
    return {
      success: false,
      message: '电路创建失败',
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function adjustCircuitParameters(
  circuit: CircuitData,
  componentId: string,
  newParams: Record<string, unknown>
): Promise<AIResponse> {
  console.log('[CircuitAI] 调整参数:', componentId, newParams)

  const updatedComponents = circuit.components.map(comp => {
    if (comp.id === componentId) {
      return { ...comp, params: { ...comp.params, ...newParams } }
    }
    return comp
  })

  return {
    success: true,
    message: `已调整 ${componentId} 的参数`,
    data: {
      circuit: { ...circuit, components: updatedComponents },
      content_blocks: [
        {
          type: 'parameter_adjustment',
          data: {
            component: componentId,
            old_value: circuit.components.find(c => c.id === componentId)?.params,
            new_value: newParams
          }
        }
      ]
    }
  }
}

export async function modifyCircuitStructure(
  circuit: CircuitData,
  modifications: {
    add?: { component: Omit<CircuitComponent, 'id'> }
    remove?: { componentId: string }
    reconnect?: { oldNodes: string[]; newNodes: string[] }
  }
): Promise<AIResponse> {
  console.log('[CircuitAI] 修改结构:', modifications)

  let newCircuit = { ...circuit, components: [...circuit.components] }

  if (modifications.add) {
    const newId = `comp_${Date.now()}`
    newCircuit.components.push({ ...modifications.add.component, id: newId })
  }

  if (modifications.remove) {
    newCircuit.components = newCircuit.components.filter(
      c => c.id !== modifications.remove?.componentId
    )
  }

  return {
    success: true,
    message: '电路结构调整成功',
    data: {
      circuit: newCircuit,
      content_blocks: [
        {
          type: 'circuit',
          data: { circuit_data: newCircuit }
        }
      ]
    }
  }
}

export async function runCircuitSimulation(
  circuit: CircuitData,
  analysisType: 'dc' | 'ac' | 'transient',
  parameters?: Record<string, unknown>
): Promise<AIResponse & { progress?: number }> {
  console.log('[CircuitAI] 运行仿真:', analysisType, parameters)

  const simParams = parameters || (analysisType === 'transient' ? {
    start_time: 0,
    end_time: 0.001,
    steps: 100
  } : analysisType === 'ac' ? {
    frequency_range: [1, 1000000]
  } : {})

  try {
    const response = await fetch(`${API_BASE_URL}/julia/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        circuit,
        analysis_type: analysisType,
        parameters: simParams
      })
    })

    if (!response.ok) {
      throw new Error(`仿真服务器错误: ${response.status}`)
    }

    const data = await response.json()
    
    if (data.success) {
      return {
        success: true,
        message: '仿真完成',
        progress: 100,
        data: {
          simulation: {
            success: true,
            method: analysisType,
            message: data.message || '仿真成功',
            result: {
              solution: data.result?.solution || data.solution,
              transient: parseTransientData(data.result || data.transient || data.waveforms)
            }
          }
        }
      }
    } else {
      throw new Error(data.error || '仿真失败')
    }
  } catch (error) {
    console.error('[CircuitAI] 仿真失败:', error)
    return {
      success: false,
      message: '仿真失败',
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

function parseTransientData(data: unknown): { time: number[]; values: Record<string, number[]> } | undefined {
  if (!data || typeof data !== 'object') return undefined
  
  const dataObj = data as Record<string, unknown>
  
  if (dataObj.time && dataObj.values) {
    return {
      time: dataObj.time as number[],
      values: dataObj.values as Record<string, number[]>
    }
  }
  
  return undefined
}

export function useCircuitAI() {
  const sendCircuitMessage = async (
    messages: ChatMessage[],
    context?: {
      circuit?: CircuitData
      simulationResult?: SimulationResult
      currentStep?: string
    },
    onChunk?: (chunk: { content: string }) => void,
    onComplete?: (response: AIResponse) => void,
    onError?: (error: string) => void
  ) => {
    let fullContent = ''
    let aiResponse: AIResponse | null = null

    try {
      for await (const chunk of streamChat(messages, context)) {
        if (chunk.delta) {
          fullContent += chunk.delta
          onChunk?.({ content: chunk.delta })
        }
        if (chunk.success !== undefined && chunk.data) {
          aiResponse = {
            success: chunk.success,
            message: chunk.message,
            data: chunk.data,
            error: chunk.error
          }
        }
      }

      if (aiResponse) {
        onComplete?.(aiResponse)
      } else if (fullContent) {
        try {
          const jsonMatch = fullContent.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0])
            aiResponse = {
              success: parsed.success ?? true,
              message: parsed.message || fullContent,
              data: parsed.data
            }
            onComplete?.(aiResponse)
          } else {
            onComplete?.({ success: true, message: fullContent })
          }
        } catch {
          onComplete?.({ success: true, message: fullContent })
        }
      }
    } catch (error) {
      console.error('[CircuitAI] 发送消息错误:', error)
      onError?.('AI服务暂时不可用')
    }
  }

  return {
    sendCircuitMessage,
    analyzeCircuitIntent,
    createCircuit,
    adjustCircuitParameters,
    modifyCircuitStructure,
    runCircuitSimulation
  }
}
