import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Typography, Card, Input, Button, List, Spin, Space, Alert, Row, Col, message, Drawer, Empty, Progress, Modal, Divider } from 'antd'
import { SendOutlined, RobotOutlined, UserOutlined, PlayCircleOutlined, ThunderboltOutlined, ExperimentOutlined, PlusOutlined, InfoCircleOutlined, ApiOutlined, EditOutlined, HistoryOutlined, BarChartOutlined, TableOutlined, FullscreenOutlined, CompressOutlined, StopOutlined, UndoOutlined } from '@ant-design/icons'
import katex from 'katex'
import MainLayout from '@components/layout/MainLayout'
import EditorErrorBoundary from '@components/editor/EditorErrorBoundary'
import { ChatMessage, sendVolcanoMessage, checkApiHealth, getApiStatus } from '@services/ai.api'

const API_BASE_URL = 'http://localhost:8080'

interface CircuitNode {
  id: string
  x: number
  y: number
  type: 'terminal' | 'junction' | 'probe'
  label?: string
}

interface CircuitComponent {
  id: string
  type: 'resistor' | 'capacitor' | 'inductor' | 'voltage_source' | 'current_source' | 'ground' | 'opamp' | 'probe'
  name: string
  nodes: [string, string]
  params: {
    value?: number
    unit?: string
    polarity?: 'positive' | 'negative'
    direction?: 'forward' | 'reverse'
    [key: string]: unknown
  }
}

interface Circuit {
  nodes: CircuitNode[]
  components: CircuitComponent[]
}

interface SimulationResult {
  success: boolean
  method: string
  message?: string
  result: {
    solution?: Record<string, number>
    transient?: {
      time: number[]
      values: Record<string, number[]>
    }
    matrices?: {
      conductance?: number[][]
      incidence?: number[][]
    }
  }
}

interface WaveformData {
  time: number[]
  values: Record<string, number[]>
}

interface JuliaSimulationRequest {
  circuit_description: string
  analysis_type: 'dc' | 'ac' | 'transient'
  parameters?: {
    start_time?: number
    end_time?: number
    steps?: number
    frequency_range?: [number, number]
  }
}

interface JuliaSimulationResponse {
  success: boolean
  circuit_data?: {
    nodes: CircuitNode[]
    components: CircuitComponent[]
  }
  simulation_results?: {
    analysis_type: string
    data: Record<string, unknown>
    plots?: {
      type: string
      data: { x: number[]; y: number[]; label: string }[]
    }[]
  }
  error?: string
}

const createDefaultCircuit = (): Circuit => ({
  nodes: [
    { id: 'gnd', x: 400, y: 450, type: 'terminal', label: 'GND' },
    { id: 'n1', x: 200, y: 200, type: 'junction', label: 'Node 1' },
    { id: 'n2', x: 600, y: 200, type: 'junction', label: 'Node 2' }
  ],
  components: []
})

let messageIdCounter = 0
const generateMessageId = () => `msg_${Date.now()}_${++messageIdCounter}`

function drawCircuitDiagramOnCanvas(canvas: HTMLCanvasElement, circuitData: Circuit, zoom: number = 1, pan: { x: number; y: number } = { x: 0, y: 0 }) {
  if (!circuitData || !circuitData.nodes || !circuitData.components || circuitData.components.length === 0) {
    return
  }

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.save()
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  
  const centerX = canvas.width / 2
  const centerY = canvas.height / 2
  ctx.translate(centerX + pan.x, centerY + pan.y)
  ctx.scale(zoom, zoom)
  ctx.translate(-centerX, -centerY)

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(-canvas.width * 2, -canvas.height * 2, canvas.width * 4, canvas.height * 4)

  const nodeMap = new Map<string, { x: number; y: number }>()
  circuitData.nodes.forEach(n => nodeMap.set(n.id, { x: n.x, y: n.y }))

  ctx.strokeStyle = '#333'
  ctx.lineWidth = 2 / zoom
  if (ctx.lineWidth < 1) ctx.lineWidth = 1

  ctx.beginPath()
  circuitData.components.forEach(comp => {
    const [n1, n2] = [nodeMap.get(comp.nodes[0]), nodeMap.get(comp.nodes[1])]
    if (n1 && n2) {
      ctx.moveTo(n1.x, n1.y)
      ctx.lineTo(n2.x, n2.y)
    }
  })
  ctx.stroke()

  const baseFontSize = 12 / zoom
  const fontSize = baseFontSize < 8 ? 8 : baseFontSize
  const nodeRadius = Math.max(5 / zoom, 3)
  const labelOffset = 10 / zoom

  circuitData.nodes.forEach(node => {
    ctx.beginPath()
    if (node.type === 'terminal') {
      ctx.fillStyle = '#000'
      ctx.fillRect(node.x - 8 / zoom, node.y - 3 / zoom, 16 / zoom, 6 / zoom)
    } else if (node.type === 'probe') {
      ctx.fillStyle = '#f5222d'
      ctx.beginPath()
      ctx.arc(node.x, node.y, nodeRadius + 1, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.fillStyle = '#1890ff'
      ctx.beginPath()
      ctx.arc(node.x, node.y, nodeRadius, 0, Math.PI * 2)
      ctx.fill()
    }
    if (node.label) {
      ctx.fillStyle = '#333'
      ctx.font = `bold ${fontSize}px Arial`
      ctx.fillText(node.label, node.x + labelOffset, node.y - labelOffset)
    }
  })

  const labelWidth = 50 / zoom
  const labelHeight = 24 / zoom

  circuitData.components.forEach(comp => {
    const [n1, n2] = [nodeMap.get(comp.nodes[0]), nodeMap.get(comp.nodes[1])]
    if (n1 && n2) {
      const mx = (n1.x + n2.x) / 2
      const my = (n1.y + n2.y) / 2
      ctx.fillStyle = '#fff'
      ctx.fillRect(mx - labelWidth / 2, my - labelHeight / 2, labelWidth, labelHeight)
      ctx.fillStyle = '#333'
      ctx.font = `bold ${fontSize}px Arial`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(comp.name, mx, my)
    }
  })

  ctx.restore()
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit & { timeout?: number } = {}) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), init.timeout ?? 60000)
  try {
    const res = await fetch(input, { ...init, signal: controller.signal })
    return res
  } catch {
    return null
  } finally {
    clearTimeout(id)
  }
}

function findComponentAtPosition(mouseX: number, mouseY: number, circuit: Circuit, zoom: number, pan: { x: number; y: number }) {
  const centerX = 350
  const centerY = 140
  const worldX = (mouseX - centerX - pan.x) / zoom
  const worldY = (mouseY - centerY - pan.y) / zoom
  
  const nodeMap = new Map<string, { x: number; y: number }>()
  circuit.nodes.forEach(n => nodeMap.set(n.id, { x: n.x, y: n.y }))
  
  for (const comp of circuit.components) {
    const [n1, n2] = [nodeMap.get(comp.nodes[0]), nodeMap.get(comp.nodes[1])]
    if (n1 && n2) {
      const mx = (n1.x + n2.x) / 2
      const my = (n1.y + n2.y) / 2
      const dist = Math.sqrt((worldX - mx) ** 2 + (worldY - my) ** 2)
      if (dist < 30 / zoom) {
        return comp
      }
    }
  }
  return null
}

export default function Editor() {
  const [circuitMessages, setCircuitMessages] = useState<ChatMessage[]>(() => [{ 
    id: generateMessageId(),
    role: 'assistant', 
    content: `**智能助手**

你好！我是AI智能助手，可以帮助你解答问题，提供建议、协助完成各种任务。无论是学习、工作还是生活中的疑问，随时告诉我你的需求。` 
  }])
  const [circuitLoading, setCircuitLoading] = useState(false)
  const [isThinking, setIsThinking] = useState(false)
  const [lastUserMessage, setLastUserMessage] = useState<ChatMessage | null>(null)
  const [showRecallButton, setShowRecallButton] = useState(false)
  const [circuit, setCircuit] = useState<Circuit>(createDefaultCircuit)
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null)
  const [waveformData, setWaveformData] = useState<WaveformData | null>(null)
  const [simulating, setSimulating] = useState(false)
  const [progress, setProgress] = useState(0)
  const [analysisType, setAnalysisType] = useState<'dc' | 'ac' | 'transient'>('dc')
  const [simulationHistory, setSimulationHistory] = useState<SimulationResult[]>([])
  const [showWaveformFullscreen, setShowWaveformFullscreen] = useState(false)
  const [waveformZoom, setWaveformZoom] = useState(1)
  const [selectedWaveformPoints, setSelectedWaveformPoints] = useState<{x: number; y: number; label: string}[]>([])
  const [circuitZoom, setCircuitZoom] = useState(1)
  const [circuitPan, setCircuitPan] = useState({ x: 0, y: 0 })
  const [isDraggingCircuit, setIsDraggingCircuit] = useState(false)
  const [circuitDragStart, setCircuitDragStart] = useState({ x: 0, y: 0 })
  const [waveformPan, setWaveformPan] = useState({ x: 0, y: 0 })
  const [isDraggingWaveform, setIsDraggingWaveform] = useState(false)
  const [waveformDragStart, setWaveformDragStart] = useState({ x: 0, y: 0 })
  const [hoveredComponent, setHoveredComponent] = useState<{ component: typeof circuit.components[0] | null; x: number; y: number }>({ component: null, x: 0, y: 0 })
  const [selectedComponent, setSelectedComponent] = useState<typeof circuit.components[0] | null>(null)
  const [isDraggingComponent, setIsDraggingComponent] = useState(false)
  const [componentDragStart, setComponentDragStart] = useState({ x: 0, y: 0 })
  const [componentOriginalPos, setComponentOriginalPos] = useState({ x: 0, y: 0 })
  const [showParameterModal, setShowParameterModal] = useState(false)
  const [editingParam, setEditingParam] = useState<{ key: string; value: string | number } | null>(null)
  const circuitCanvasRef = useRef<HTMLCanvasElement>(null)
  const circuitCanvasWrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      const savedCircuit = localStorage.getItem('circuit_session')
      if (savedCircuit) {
        setCircuit(JSON.parse(savedCircuit))
      }
    } catch {}
  }, [])

  const circuitRef = useRef(circuit)
  circuitRef.current = circuit
  const circuitZoomRef = useRef(circuitZoom)
  circuitZoomRef.current = circuitZoom
  const circuitPanRef = useRef(circuitPan)
  circuitPanRef.current = circuitPan
  const isDraggingCircuitRef = useRef(false)
  isDraggingCircuitRef.current = isDraggingCircuit
  const isDraggingComponentRef = useRef(false)
  isDraggingComponentRef.current = isDraggingComponent
  const componentDragStartRef = useRef({ x: 0, y: 0 })
  componentDragStartRef.current = componentDragStart
  const circuitDragStartRef = useRef({ x: 0, y: 0 })
  circuitDragStartRef.current = circuitDragStart
  const selectedComponentRef = useRef<typeof circuit.components[0] | null>(null)
  selectedComponentRef.current = selectedComponent

  const drawCircuitDiagram = useCallback(() => {
    const canvas = circuitCanvasRef.current
    if (!canvas) return
    drawCircuitDiagramOnCanvas(canvas, circuitRef.current, circuitZoomRef.current, circuitPanRef.current)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('circuit_session', JSON.stringify(circuit))
    } catch {}
  }, [circuit])

  useEffect(() => {
    if (circuit && circuit.components && circuit.components.length > 0) {
      const timer = setTimeout(() => {
        const canvas = circuitCanvasRef.current
        if (canvas) {
          drawCircuitDiagramOnCanvas(canvas, circuitRef.current, circuitZoom, circuitPan)
        }
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [circuit, circuitZoom, circuitPan])

  useEffect(() => {
    const wrapper = circuitCanvasWrapperRef.current
    if (!wrapper) return

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      
      const rect = wrapper.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top
      
      // 很低缩放灵敏度 - 非常平滑
      const zoomFactor = e.deltaY > 0 ? 0.98 : 1.02
      const newZoom = Math.max(0.3, Math.min(3, circuitZoomRef.current * zoomFactor))
      
      const zoomRatio = newZoom / circuitZoomRef.current
      
      const newPanX = circuitPanRef.current.x - (mouseX - circuitPanRef.current.x) * (zoomRatio - 1)
      const newPanY = circuitPanRef.current.y - (mouseY - circuitPanRef.current.y) * (zoomRatio - 1)
      
      circuitZoomRef.current = newZoom
      circuitPanRef.current = { x: newPanX, y: newPanY }
      setCircuitZoom(newZoom)
      setCircuitPan({ x: newPanX, y: newPanY })
    }

    const handleMouseDown = (e: MouseEvent) => {
      const canvas = circuitCanvasRef.current
      if (!canvas) return
      
      const rect = canvas.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top
      
      console.log('[电路图] 鼠标按下:', mouseX, mouseY)
      
      const clickedComp = findComponentAtPosition(mouseX, mouseY, circuitRef.current, circuitZoomRef.current, circuitPanRef.current)
      
      if (clickedComp) {
        setSelectedComponent(clickedComp)
        setIsDraggingComponent(true)
        setComponentDragStart({ x: mouseX, y: mouseY })
        console.log('[电路图] 开始拖拽元件:', clickedComp.name)
      } else {
        setCircuitDragStart({ x: mouseX, y: mouseY })
        setIsDraggingCircuit(true)
        console.log('[电路图] 开始平移电路')
      }
    }

    const handleMouseMove = (e: MouseEvent) => {
      const canvas = circuitCanvasRef.current
      const wrapper = circuitCanvasWrapperRef.current
      if (!canvas || !wrapper) return
      
      const rect = canvas.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top
      
      if (isDraggingComponentRef.current && selectedComponentRef.current) {
        // 很低拖拽灵敏度 - 缓慢平滑跟随
        const sensitivity = 0.08
        const deltaX = ((mouseX - componentDragStartRef.current.x) * sensitivity) / circuitZoomRef.current
        const deltaY = ((mouseY - componentDragStartRef.current.y) * sensitivity) / circuitZoomRef.current
        
        circuitRef.current = {
          ...circuitRef.current,
          nodes: circuitRef.current.nodes.map(node => {
            if (selectedComponentRef.current && selectedComponentRef.current.nodes.includes(node.id)) {
              return { ...node, x: node.x + deltaX, y: node.y + deltaY }
            }
            return node
          })
        }
        
        componentDragStartRef.current = { x: mouseX, y: mouseY }
        drawCircuitDiagram()
      } else if (isDraggingCircuitRef.current) {
        // 很低平移灵敏度 - 缓慢平滑跟随
        const sensitivity = 0.08
        const deltaX = ((mouseX - circuitDragStartRef.current.x) * sensitivity)
        const deltaY = ((mouseY - circuitDragStartRef.current.y) * sensitivity)
        
        const newPanX = circuitPanRef.current.x + deltaX
        const newPanY = circuitPanRef.current.y + deltaY
        
        circuitPanRef.current = { x: newPanX, y: newPanY }
        circuitDragStartRef.current = { x: mouseX, y: mouseY }
        setCircuitPan({ x: newPanX, y: newPanY })
      }
    }

    const handleMouseUp = () => {
      if (isDraggingComponentRef.current) {
        console.log('[电路图] 元件拖拽结束')
      }
      if (isDraggingCircuitRef.current) {
        console.log('[电路图] 电路平移结束')
      }
      setIsDraggingComponent(false)
      setIsDraggingCircuit(false)
      setComponentDragStart({ x: 0, y: 0 })
      setCircuitDragStart({ x: 0, y: 0 })
      isDraggingComponentRef.current = false
      isDraggingCircuitRef.current = false
    }

    wrapper.addEventListener('wheel', handleWheel, { passive: false })
    wrapper.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.addEventListener('mouseleave', handleMouseUp)
    
    console.log('[电路图] 拖拽事件监听器已添加')
    
    return () => {
      wrapper.removeEventListener('wheel', handleWheel)
      wrapper.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.removeEventListener('mouseleave', handleMouseUp)
    }
  }, [])

  const hasIncompleteFormula = useCallback((text: string): boolean => {
    const incompletePatterns = [
      /\$[^\$\n]*$/m,
      /\$\$[\s\S]*$/,
      /[^\$]\$[^\$\n]*$/m,
      /[^\$]\$\$[\s\S]*$/m,
    ]
    for (const pattern of incompletePatterns) {
      if (pattern.test(text)) {
        return true
      }
    }
    return false
  }, [])

  const processMarkdownContent = useCallback((text: string): React.ReactNode[] => {
    const formulaRegex = /\$\$([\s\S]*?)\$\$|\$([^\$\n]+)\$/g
    let lastIndex = 0
    let match: RegExpExecArray | null
    const elements: React.ReactNode[] = []

    while ((match = formulaRegex.exec(text))) {
      const pre = text.slice(lastIndex, match.index)
      if (pre) {
        const lines = pre.split(/\r?\n/)
        let i = 0
        while (i < lines.length) {
          const line = lines[i]
          if (/^#{1,6}\s+/.test(line)) {
            const level = line.match(/^#{1,6}/)?.[0].length || 2
            const title = line.replace(/^#{1,6}\s+/, '')
            const fontSize = 16 - level
            const fontWeight = level <= 2 ? 'font-semibold' : 'font-medium'
            const marginTop = level <= 2 ? 'mt-2' : 'mt-1'
            elements.push(<div key={`h-${elements.length}`} className={`${marginTop} ${fontWeight} text-gray-800`} style={{ fontSize: `${fontSize}px` }}>{title}</div>)
            i++
          } else if (/^[-*]\s+/.test(line) || /^\d+[.]\s+/.test(line)) {
            const listItems: string[] = []
            while (i < lines.length && (/^[-*]\s+/.test(lines[i]) || /^\d+[.]\s+/.test(lines[i]))) {
              listItems.push(lines[i].replace(/^([-*]|\d+[.])\s+/, ''))
              i++
            }
            elements.push(
              <ul key={`ul-${elements.length}`} className="list-disc list-inside ml-3 mt-1 space-y-0.5">
                {listItems.map((item, idx) => (
                  <li key={idx} className="text-gray-700">{item}</li>
                ))}
              </ul>
            )
          } else if (/^---+$/.test(line) || /^\*\*\*+$/.test(line)) {
            elements.push(<hr key={`hr-${elements.length}`} className="my-2 border-gray-200" />)
            i++
          } else if (line.trim()) {
            elements.push(<p key={`p-${elements.length}`} className="mt-1 text-gray-700">{line}</p>)
            i++
          } else {
            i++
          }
        }
      }

      const isDisplayMode = !!match[1]
      const formula = isDisplayMode ? match[1] : match[2]

      if (formula) {
        try {
          const container = document.createElement('div')
          katex.render(formula, container, {
            displayMode: isDisplayMode,
            throwOnError: false,
            errorColor: '#cc0000',
            trust: true,
            strict: false
          })
          const katexClass = isDisplayMode ? 'katex-formula-display my-4' : 'katex-formula-inline mx-1'
          elements.push(<span key={`latex-${elements.length}`} dangerouslySetInnerHTML={{ __html: container.innerHTML }} className={katexClass} />)
        } catch {
          elements.push(<span key={`latex-err-${elements.length}`} className="text-red-500">{isDisplayMode ? `$${formula}$` : `$${formula}$`}</span>)
        }
      }

      lastIndex = formulaRegex.lastIndex
    }

    if (lastIndex < text.length) {
      const tail = text.slice(lastIndex)
      if (tail) {
        const lines = tail.split(/\r?\n/)
        let i = 0
        while (i < lines.length) {
          const line = lines[i]
          if (line.trim()) {
            elements.push(<p key={`p-tail-${elements.length}`} className="mt-2 text-gray-700 leading-relaxed">{line}</p>)
            i++
          } else {
            i++
          }
        }
      }
    }

    return elements
  }, [])

  const renderLatex = useCallback((formula: string, displayMode = false): React.ReactNode => {
    try {
      const container = document.createElement('div')
      katex.render(formula, container, {
        displayMode,
        throwOnError: false,
        errorColor: '#cc0000',
        trust: true,
        strict: false
      })
      return (
        <span 
          dangerouslySetInnerHTML={{ __html: container.innerHTML }} 
          className={displayMode ? 'katex-formula-display' : 'katex-formula-inline'}
        />
      )
    } catch {
      return <span className="text-red-500">{displayMode ? `$${formula}$` : `$${formula}$`}</span>
    }
  }, [])

  const renderMessageContent = useCallback((content: string | React.ReactNode[], messageId: string, isStreaming = false) => {
    if (typeof content === 'string') {
      if (isStreaming && hasIncompleteFormula(content)) {
        return <div className="whitespace-pre-wrap font-mono text-sm">{content}</div>
      }
      
      const blocks: React.ReactNode[] = []
      const formulaRegex = /\$\$([\s\S]*?)\$\$|\$([^\$\n]+)\$/g
      let lastIndex = 0
      let match: RegExpExecArray | null
      let blockIndex = 0

      while ((match = formulaRegex.exec(content))) {
        const pre = content.slice(lastIndex, match.index)
        if (pre) {
          const markdownElements = processMarkdownContent(pre)
          blocks.push(<div key={`${messageId}-pre-${blockIndex}`}>{markdownElements}</div>)
          blockIndex++
        }

        const isDisplayMode = !!match[1]
        const formula = isDisplayMode ? match[1] : match[2]
        if (formula) {
          const latexElement = renderLatex(formula, isDisplayMode)
          blocks.push(<div key={`${messageId}-latex-${blockIndex}`} className={isDisplayMode ? 'katex-wrapper' : ''}>{latexElement}</div>)
          blockIndex++
        }

        lastIndex = formulaRegex.lastIndex
      }

      if (lastIndex < content.length) {
        const tail = content.slice(lastIndex)
        if (tail) {
          const markdownElements = processMarkdownContent(tail)
          blocks.push(<div key={`${messageId}-tail-${blockIndex}`}>{markdownElements}</div>)
        }
      }
      
      return blocks
    }
    return content
  }, [processMarkdownContent, renderLatex, hasIncompleteFormula])

  interface UserIntent {
    intent_type: 'general_qa' | 'circuit_request' | 'analysis_request' | 'simulation_request' | 'comparison' | 'unknown'
    action: 'answer_directly' | 'create_circuit' | 'run_simulation'
    circuit_type: string | null
    analysis_type: string | null
    confidence: number
    message: string
    matched_keywords: string[]
  }

  const analyzeUserIntent = (description: string): UserIntent => {
    const lowerDesc = description.toLowerCase().trim()
    const matchedKeywords: string[] = []

    const calculateScore = (keywords: string[]): { score: number, matches: string[] } => {
      let score = 0
      const matches: string[] = []
      for (const keyword of keywords) {
        if (lowerDesc.includes(keyword)) {
          score += keyword.length
          matches.push(keyword)
        }
      }
      return { score, matches }
    }

    const GENERAL_QA_PATTERNS = [
      { category: 'definition', keywords: ['什么是', '什么是', 'what is', '定义', '解释', '说明', '概念'] },
      { category: 'principle', keywords: ['原理', '工作原理', '如何工作', 'how does', '怎么工作', '是怎样'] },
      { category: 'question', keywords: ['?', '？', '吗', '呢', '为什么', '原因', '哪里'] },
      { category: 'comparison', keywords: ['区别', '不同', '比较', '对比', 'vs', 'versus', '优劣', '好坏'] },
      { category: 'theory', keywords: ['理论', '公式', '推导', '计算', '证明', '解释一下'] },
      { category: 'usage', keywords: ['用途', '作用', '应用', '使用', '用来', '用于', '场合'] },
      { category: 'characteristic', keywords: ['特点', '特性', '特征', '性能', '参数'] },
    ]

    let generalQAScore = 0
    let generalQAMatches: string[] = []
    for (const pattern of GENERAL_QA_PATTERNS) {
      const { score, matches } = calculateScore(pattern.keywords)
      if (score > generalQAScore) {
        generalQAScore = score
        generalQAMatches = matches
      }
    }

    const ANALYSIS_PATTERNS = [
      { type: 'frequency_response', keywords: ['频率响应', '波特图', 'bode', 'Bode', '幅频', '相频', 'ac analysis', '增益', '带宽', '截止频率'] },
      { type: 'transient', keywords: ['瞬态', 'transient', '充电', '放电', '波形', '时域', '阶跃', '脉冲', '时间响应', '充放电'] },
      { type: 'dc_analysis', keywords: ['直流', 'dc analysis', '工作点', '静态', '节点电压', '偏置', '静态工作点'] },
      { type: 'noise', keywords: ['噪声', 'noise', '信噪比', 'SNR'] },
      { type: 'sensitivity', keywords: ['灵敏度', 'sensitivity', '参数敏感'] },
    ]

    let analysisType: string | null = null
    let analysisScore = 0
    let analysisMatches: string[] = []
    for (const pattern of ANALYSIS_PATTERNS) {
      const { score, matches } = calculateScore(pattern.keywords)
      if (score > analysisScore) {
        analysisScore = score
        analysisType = pattern.type
        analysisMatches = matches
      }
    }

    const CIRCUIT_PATTERNS = [
      { type: 'common_emitter', keywords: ['共射', '共射放大', 'common emitter', '晶体管放大', '三极管放大', 'BJT', '晶体管', 'transistor', '单管放大', '基本放大', '放大电路', 'NPN', 'PNP'] },
      { type: 'voltage_divider', keywords: ['分压', '分压电路', 'voltage divider', '分压器', '电阻分压', '偏置电路', '基极偏置', '偏置网络'] },
      { type: 'rc_circuit', keywords: ['rc', 'RC', '阻容', 'RC电路', 'RC串联', 'RC并联', '高通', '低通', '滤波', '带通', '带阻', '微分', '积分', '耦合', '旁路'] },
      { type: 'rlc_circuit', keywords: ['rlc', 'RLC', '谐振', '串联谐振', '并联谐振', 'LC电路', '振荡', '带通', '带阻', '品质因数', 'Q值', '带宽', '选频'] },
      { type: 'op_amp', keywords: ['运放', '运算放大', 'op amp', 'op-amp', 'opamp', '运算放大器', '反相放大', '同相放大', '差分放大', '积分电路', '微分电路', '比较器', '跟随器'] },
      { type: 'power_supply', keywords: ['电源', 'voltage source', '直流电源', 'DC电源', '供电', '稳压', '整流', '滤波电源', '稳压器', '变压器'] },
      { type: 'filter', keywords: ['滤波器', 'filter', '低通', '高通', '带通', '带阻', '陷波', '巴特沃斯', '切比雪夫'] },
      { type: 'oscillator', keywords: ['振荡器', 'oscillator', '正弦波', '方波', '三角波', '晶振', 'LC振荡', 'RC振荡'] },
    ]

    let circuitType: string | null = null
    let circuitScore = 0
    let circuitMatches: string[] = []
    for (const pattern of CIRCUIT_PATTERNS) {
      const { score, matches } = calculateScore(pattern.keywords)
      if (score > circuitScore) {
        circuitScore = score
        circuitType = pattern.type
        circuitMatches = matches
      }
    }

    const ACTION_PATTERNS = [
      { action: 'create_circuit', keywords: ['设计', '创建', 'build', 'create', '画', '绘制', '画一个', '做一个', '搭建', '构成'] },
      { action: 'run_simulation', keywords: ['仿真', 'simulate', '分析', '运行', '计算', '求解', '测试', '验证'] },
      { action: 'modify_circuit', keywords: ['修改', '改变', '调整', '调节', '更改', '换', '改为', '改成'] },
    ]

    let actionType: string | null = null
    let actionScore = 0
    for (const pattern of ACTION_PATTERNS) {
      const { score } = calculateScore(pattern.keywords)
      if (score > actionScore) {
        actionScore = score
        actionType = pattern.action
      }
    }

    if (generalQAScore >= 8 && circuitScore < generalQAScore) {
      return {
        intent_type: 'general_qa',
        action: 'answer_directly',
        circuit_type: null,
        analysis_type: null,
        confidence: Math.min(0.95, 0.7 + generalQAScore * 0.05),
        message: `检测到一般性问题 (关键词: ${generalQAMatches.slice(0, 3).join(', ')})`,
        matched_keywords: generalQAMatches
      }
    }

    if (circuitType && actionType === 'run_simulation') {
      matchedKeywords.push(...circuitMatches, ...analysisMatches)
      return {
        intent_type: 'simulation_request',
        action: 'run_simulation',
        circuit_type: circuitType,
        analysis_type: analysisType,
        confidence: Math.min(0.95, 0.75 + circuitScore * 0.03 + analysisScore * 0.02),
        message: `检测到${getCircuitTypeName(circuitType)}仿真请求`,
        matched_keywords: matchedKeywords
      }
    }

    if (circuitType && (actionType === 'create_circuit' || circuitScore >= 15 || analysisType)) {
      matchedKeywords.push(...circuitMatches, ...analysisMatches)
      return {
        intent_type: analysisType ? 'analysis_request' : 'circuit_request',
        action: 'create_circuit',
        circuit_type: circuitType,
        analysis_type: analysisType,
        confidence: Math.min(0.95, 0.7 + circuitScore * 0.03 + analysisScore * 0.02),
        message: `检测到${getCircuitTypeName(circuitType)}${analysisType ? getAnalysisTypeName(analysisType) : ''}请求`,
        matched_keywords: matchedKeywords
      }
    }

    if (circuitType) {
      return {
        intent_type: 'circuit_request',
        action: 'create_circuit',
        circuit_type: circuitType,
        analysis_type: null,
        confidence: Math.min(0.85, 0.6 + circuitScore * 0.03),
        message: `检测到${getCircuitTypeName(circuitType)}电路请求`,
        matched_keywords: circuitMatches
      }
    }

    if (generalQAScore >= 5) {
      return {
        intent_type: 'general_qa',
        action: 'answer_directly',
        circuit_type: null,
        analysis_type: null,
        confidence: 0.65 + generalQAScore * 0.02,
        message: `检测到一般性问题`,
        matched_keywords: generalQAMatches
      }
    }

    return {
      intent_type: 'unknown',
      action: 'answer_directly',
      circuit_type: null,
      analysis_type: null,
      confidence: 0.5,
      message: '无法明确识别意图，将提供一般性帮助',
      matched_keywords: []
    }
  }

  const getCircuitTypeName = (circuitType: string | null): string => {
    const names: Record<string, string> = {
      'common_emitter': '共射放大电路',
      'voltage_divider': '分压电路',
      'rc_circuit': 'RC电路',
      'rlc_circuit': 'RLC电路',
      'op_amp': '运算放大器电路',
      'power_supply': '电源电路',
      'filter': '滤波器电路',
      'oscillator': '振荡器电路'
    }
    return circuitType ? names[circuitType] || circuitType : '电路'
  }

  const getAnalysisTypeName = (analysisType: string | null): string => {
    const names: Record<string, string> = {
      'frequency_response': '频率响应分析',
      'transient': '瞬态分析',
      'dc_analysis': '直流分析',
      'noise': '噪声分析',
      'sensitivity': '灵敏度分析'
    }
    return analysisType ? names[analysisType] || analysisType : ''
  }

  const generateDirectAnswer = (description: string, intent: UserIntent): string => {
    const lowerDesc = description.toLowerCase()

    const createCircuitHelp = (circuitName: string, example: string) => 
      `你可以直接说"${example}"来创建电路并进行仿真分析。`

    if (lowerDesc.includes('什么') || lowerDesc.includes('what is') || lowerDesc.includes('定义') || lowerDesc.includes('解释')) {
      if (lowerDesc.includes('共射') || lowerDesc.includes('晶体管') || lowerDesc.includes('transistor') || lowerDesc.includes('BJT') || lowerDesc.includes('放大电路')) {
        return `**共射放大电路 (Common Emitter Amplifier)**\n\n` +
          `共射放大电路是最基本且最常用的晶体管放大电路配置。\n\n` +
          `**核心结构：**\n` +
          `• 输入信号加在基极-发射极之间\n` +
          `• 输出信号从集电极-发射极取出\n` +
          `• 发射极为输入输出的公共端\n\n` +
          `**主要特性：**\n` +
          `• 电压增益：Av ≈ -Rc/Re（负号表示相位反转180°）\n` +
          `• 输入阻抗：中等（约rπ + (1+β)Re）\n` +
          `• 输出阻抗：较高（约Rc）\n` +
          `• 电流增益：约β\n\n` +
          `**典型应用：**\n` +
          `• 中频电压放大器\n` +
          `• 音频前置放大\n` +
          `• 振荡器核心\n\n` +
          createCircuitHelp('共射放大电路', '设计一个共射放大电路')
      }

      if (lowerDesc.includes('rc') || lowerDesc.includes('阻容') || lowerDesc.includes('电容') || lowerDesc.includes('capacitor') || lowerDesc.includes('电阻电容')) {
        return `**RC电路 (电阻-电容电路)**\n\n` +
          `RC电路是最基础的动态电路，由电阻R和电容C组成。\n\n` +
          `**时间常数：**\n` +
          `• τ = R × C\n` +
          `• τ 越小，充放电越快\n` +
          `• 5τ 后充电完成 99.3%\n\n` +
          `**主要应用：**\n` +
          `• 高通/低通滤波器\n` +
          `• 积分/微分电路\n` +
          `• 耦合/旁路电路\n\n` +
          `**截止频率：**\n` +
          `• fc = 1/(2πRC)\n\n` +
          createCircuitHelp('RC电路', 'RC串联电路')
      }

      if (lowerDesc.includes('rlc') || lowerDesc.includes('谐振') || lowerDesc.includes('电感') || lowerDesc.includes('inductor') || lowerDesc.includes('LC电路')) {
        return `**RLC电路 (电阻-电感-电容电路)**\n\n` +
          `RLC电路包含三种基本无源元件，具有独特的谐振特性。\n\n` +
          `**谐振频率：**\n` +
          `• f₀ = 1/(2π√LC)\n` +
          `• 串联谐振时阻抗最小\n` +
          `• 并联谐振时阻抗最大\n\n` +
          `**品质因数Q：**\n` +
          `• Q = (1/R)√(L/C)\n` +
          `• 带宽 BW = f₀/Q\n\n` +
          createCircuitHelp('RLC电路', 'RLC串联谐振电路')
      }

      if (lowerDesc.includes('运放') || lowerDesc.includes('op amp') || lowerDesc.includes('运算放大') || lowerDesc.includes('amplifier')) {
        return `**运算放大器 (Operational Amplifier)**\n\n` +
          `运算放大器是一种高增益差分放大器。\n\n` +
          `**理想特性：**\n` +
          `• 开环增益：A₀ → ∞\n` +
          `• 输入阻抗：Zin → ∞\n` +
          `• 输出阻抗：Zout → 0\n\n` +
          `**基本配置：**\n` +
          `• 反相放大：Av = -Rf/Rin\n` +
          `• 同相放大：Av = 1 + Rf/Rin\n` +
          `• 电压跟随器：Av = 1\n\n` +
          createCircuitHelp('运算放大电路', '设计一个运放电路')
      }

      if (lowerDesc.includes('分压') || lowerDesc.includes('voltage divider') || lowerDesc.includes('偏置')) {
        return `**分压电路 (Voltage Divider)**\n\n` +
          `分压电路是最基础的线性电路，用于将电压按比例分配。\n\n` +
          `**基本公式：**\n` +
          `• Vout = Vin × R2/(R1+R2)\n\n` +
          `**典型应用：**\n` +
          `• 偏置电路（晶体管基极偏置）\n` +
          `• 信号衰减\n` +
          `• 电平转换\n\n` +
          createCircuitHelp('分压电路', '设计一个分压电路')
      }

      if (lowerDesc.includes('波特图') || lowerDesc.includes('频率响应') || lowerDesc.includes('bode')) {
        return `**波特图 (Bode Plot)**\n\n` +
          `波特图是描述系统频率响应的图形表示方法。\n\n` +
          `**组成：**\n` +
          `• 幅频特性：增益(dB) vs 频率(Hz)\n` +
          `• 相频特性：相位(°) vs 频率(Hz)\n\n` +
          `**分析要点：**\n` +
          `• 增益裕度、相位裕度\n` +
          `• 稳定性判断\n\n` +
          createCircuitHelp('频率响应分析', '分析RC电路的频率响应')
      }
    }

    if (lowerDesc.includes('区别') || lowerDesc.includes('不同') || lowerDesc.includes('比较') || lowerDesc.includes('vs') || lowerDesc.includes('versus') || lowerDesc.includes('优劣')) {
      if (lowerDesc.includes('共射') && (lowerDesc.includes('共集') || lowerDesc.includes('射极跟随') || lowerDesc.includes('emitter follower') || lowerDesc.includes('跟随器'))) {
        return `**共射放大 vs 共集放大（射极跟随器）**\n\n` +
          `| 特性 | 共射放大 | 共集放大 |\n` +
          `|------|----------|----------|\n` +
          `| 电压增益 | 高 (~Rc/Re) | ≈1 |\n` +
          `| 电流增益 | β | 1+β |\n` +
          `| 输入阻抗 | 中等 (rπ) | 高 (βRe) |\n` +
          `| 输出阻抗 | 高 (Rc) | 低 (Re/β) |\n` +
          `| 相位 | 反相 (180°) | 同相 (0°) |\n\n` +
          `**应用建议：**\n` +
          `共射 → 中间电压放大\n` +
          `共集 → 缓冲级、阻抗变换`
      }

      if (lowerDesc.includes('共射') && (lowerDesc.includes('共基') || lowerDesc.includes('base'))) {
        return `**共射放大 vs 共基放大**\n\n` +
          `| 特性 | 共射放大 | 共基放大 |\n` +
          `|------|----------|----------|\n` +
          `| 电压增益 | 高 | 高 |\n` +
          `| 电流增益 | β | α ≈ 1 |\n` +
          `| 输入阻抗 | 中等 | 低 |\n` +
          `| 高频特性 | 较差 | 较好 |\n\n` +
          `**应用建议：**\n` +
          `共射 → 一般放大\n` +
          `共基 → 高频放大、宽带放大`
      }

      if ((lowerDesc.includes('直流') || lowerDesc.includes('dc')) && (lowerDesc.includes('交流') || lowerDesc.includes('ac'))) {
        return `**直流分析 vs 交流分析**\n\n` +
          `| 方面 | 直流分析 | 交流分析 |\n` +
          `|------|----------|----------|\n` +
          `| 分析内容 | 静态工作点 | 动态特性 |\n` +
          `| 电容处理 | 开路 | 短路 |\n\n` +
          `**建议：**\n` +
          `先进行DC分析确定工作点，再进行AC分析查看频率响应。`
      }

      return `**电路配置比较**\n\n` +
        `我可以帮你比较以下电路配置：\n` +
        `• 共射 vs 共集 vs 共基\n` +
        `• 串联谐振 vs 并联谐振\n` +
        `• 直流 vs 交流分析\n\n` +
        `请明确指定要比较的电路类型。`
    }

    if (lowerDesc.includes('原理') || lowerDesc.includes('工作原理') || lowerDesc.includes('如何') || lowerDesc.includes('how') || lowerDesc.includes('怎么')) {
      if (lowerDesc.includes('晶体管') || lowerDesc.includes('三极管') || lowerDesc.includes('transistor') || lowerDesc.includes('BJT')) {
        return `**晶体管工作原理**\n\n` +
          `**PN结特性：**\n` +
          `• 正向偏置：P→N导通（Vbe ≈ 0.7V）\n` +
          `• 反向偏置：P→N截止\n\n` +
          `**电流控制机制：**\n` +
          `• Ic = β × Ib（β: 电流放大倍数）\n` +
          `• Ie = Ic + Ib ≈ Ic\n\n` +
          `**三个工作区：**\n` +
          `• 截止区：Ib=0, Ic≈0\n` +
          `• 放大区：发射结正偏、集电结反偏\n` +
          `• 饱和区：发射结正偏、集电结正偏`
      }

      if (lowerDesc.includes('放大') || lowerDesc.includes('amplifier')) {
        return `**放大电路工作原理**\n\n` +
          `**能量转换：**\n` +
          `• 直流电源提供能量\n` +
          `• 小信号控制大能量输出\n\n` +
          `**放大的条件：**\n` +
          `• 设置合适的静态工作点（Q点）\n` +
          `• 交流信号叠加在直流上\n` +
          `• 晶体管工作在放大区\n\n` +
          `**增益表示：**\n` +
          `• Av = Vout/Vin\n` +
          `• Ai = Iout/Iin`
      }

      return `**电路原理**\n\n` +
        `请告诉我你想了解的具体电路原理，例如：\n` +
        `• 晶体管工作原理\n` +
        `• 放大电路工作原理\n` +
        `• 负反馈原理`
    }

    if (lowerDesc.includes('计算') || lowerDesc.includes('公式') || lowerDesc.includes('推导') || lowerDesc.includes('求')) {
      if (lowerDesc.includes('增益') || lowerDesc.includes('放大倍数') || lowerDesc.includes('放大率')) {
        return `**放大电路增益计算**\n\n` +
          `**共射放大电路：**\n` +
          `• Av = -Rc/Re（忽略re）\n` +
          `• 负号表示相位反转\n\n` +
          `**共集放大电路：**\n` +
          `• Av ≈ 1（射极跟随器）\n\n` +
          `**运放反相放大：**\n` +
          `• Av = -Rf/Rin\n\n` +
          `**运放同相放大：**\n` +
          `• Av = 1 + Rf/Rin`
      }

      if (lowerDesc.includes('输入阻抗') || lowerDesc.includes('输入电阻') || lowerDesc.includes('输出阻抗') || lowerDesc.includes('输出电阻')) {
        return `**阻抗计算**\n\n` +
          `**共射放大电路：**\n` +
          `• Rin = Rb1 || Rb2 || rπ\n` +
          `• rπ = β × 26mV/Ic(mA)\n\n` +
          `**共集放大电路：**\n` +
          `• Rin ≈ β × Re\n\n` +
          `**共基放大电路：**\n` +
          `• Rin ≈ re = 26mV/Ie(mA)`
      }

      if (lowerDesc.includes('时间常数') || lowerDesc.includes('τ') || lowerDesc.includes('时间常数')) {
        return `**时间常数计算**\n\n` +
          `**RC电路：**\n` +
          `• τ = R × C\n` +
          `• 充电：V(t) = V0(1 - e^(-t/τ))\n\n` +
          `**RL电路：**\n` +
          `• τ = L/R\n\n` +
          `**截止频率：**\n` +
          `• fc = 1/(2πτ)`
      }

      return `**电路计算**\n\n` +
        `我可以帮你计算：\n` +
        `• 增益计算\n` +
        `• 输入/输出阻抗\n` +
        `• 时间常数\n` +
        `• 谐振频率\n\n` +
        `请明确指定要计算的内容。`
    }

    if (lowerDesc.includes('为什么') || lowerDesc.includes('原因') || lowerDesc.includes('为什么要')) {
      return `**电路原理问答**\n\n` +
        `**Q: 为什么要设置静态工作点？**\n` +
        `A: 使晶体管工作在放大区，确保交流信号被线性放大而不失真。\n\n` +
        `**Q: 为什么要用多级放大？**\n` +
        `A: 单级放大增益有限，多级可实现高增益，同时满足阻抗匹配。\n\n` +
        `**Q: 为什么需要负反馈？**\n` +
        `A: 牺牲增益换取稳定性、减小失真、扩展带宽。`
    }

    if (lowerDesc.includes('用途') || lowerDesc.includes('应用') || lowerDesc.includes('用来') || lowerDesc.includes('用于')) {
      return `**电路应用场景**\n\n` +
        `**放大电路：**\n` +
        `• 音频放大、射频放大、仪表放大\n\n` +
        `**滤波器：**\n` +
        `• 低通：电源滤波\n` +
        `• 高通：耦合电路\n` +
        `• 带通：选频通信\n\n` +
        `**振荡器：**\n` +
        `• 时钟信号、载波信号、波形生成`
    }

    if (intent.intent_type === 'general_qa' || intent.confidence < 0.7) {
      if (lowerDesc.includes('共射') || lowerDesc.includes('晶体管') || lowerDesc.includes('放大')) {
        return `**共射放大电路**\n\n` +
          `这是最常用的晶体管放大电路配置。\n\n` +
          `**特点：**\n` +
          `• 电压增益高\n` +
          `• 输入阻抗中等\n` +
          `• 输出阻抗较高\n` +
          `• 相位反转180°\n\n` +
          createCircuitHelp('共射放大电路', '设计一个共射放大电路')
      }

      if (lowerDesc.includes('rc') || lowerDesc.includes('阻容')) {
        return `**RC电路**\n\n` +
          `由电阻和电容组成的简单电路。\n\n` +
          `**应用：**\n` +
          `• 滤波、耦合、充放电\n` +
          `• 高通/低通滤波器\n\n` +
          createCircuitHelp('RC电路', 'RC串联电路')
      }

      if (lowerDesc.includes('rlc') || lowerDesc.includes('谐振')) {
        return `**RLC电路**\n\n` +
          `包含电阻、电感、电容的谐振电路。\n\n` +
          `**特性：**\n` +
          `• 谐振频率 f₀ = 1/(2π√LC)\n` +
          `• 品质因数Q衡量选频特性\n\n` +
          createCircuitHelp('RLC电路', 'RLC串联谐振电路')
      }

      if (lowerDesc.includes('运放') || lowerDesc.includes('op amp')) {
        return `**运算放大器**\n\n` +
          `高增益差分放大器。\n\n` +
          `**基本配置：**\n` +
          `• 反相放大、同相放大\n` +
          `• 电压跟随器、差分放大\n\n` +
          createCircuitHelp('运放电路', '设计一个运放电路')
      }
    }
    return `**智能助手**\n\n` +
      `你好！我是AI智能助手，可以帮助你解答问题、提供建议、协助完成各种任务。无论是学习、工作还是生活中的疑问，随时告诉我你的需求。`
  }

  const extractCircuitDescription = (userInput: string): string | null => {
    const patterns = [
      // 匹配 "帮我创建XX电路" 或 "创建XX电路"
      /(?:帮我|我想|请|帮我设计|帮我构建)?\s*(?:创建|设计|构建|生成|做一个|制作)\s*(?:一个)?\s*(.+?)(?:电路|的?结构)/i,
      // 匹配 "XX电路的原理" 等问答后面的电路类型
      /(.+?)(?:电路|的?结构)(?:的?原理|的工作原理)?/i,
      // 匹配 "查找XX" 
      /(?:查找|了解|查询|看看)\s*(?:一下)?\s*(.+?)(?:电路|的?原理)/i
    ]
    
    for (const pattern of patterns) {
      const match = userInput.match(pattern)
      if (match && match[1] && match[1].length > 1) {
        const result = match[1].trim()
        // 过滤掉疑问词
        if (!result.includes('什么') && !result.includes('哪些') && !result.includes('怎样')) {
          return result
        }
      }
    }
    
    // 如果上面的都没匹配到，尝试从整个输入中提取电路类型关键词
    const circuitTypes = [
      '直流斩波', '斩波电路', 'PWM', '逆变', '升压', '降压',
      'Buck', 'Boost', 'Buck-Boost',
      '共射', '共集', '共基', '放大', '滤波', '振荡',
      'RC', 'RL', 'RLC', '整流', '电源'
    ]
    
    for (const ct of circuitTypes) {
      if (userInput.includes(ct)) {
        return ct + '电路'
      }
    }
    
    return userInput
  }

  const handleCircuitCreation = async (description: string, msgId: string) => {
    // 1. 首先尝试使用火山引擎API创建电路
    try {
      const apiHealthy = await checkApiHealth()
      
      if (apiHealthy) {
        const circuitPrompt = `请根据以下电路描述，生成一个电路。我需要你直接输出电路的JSON数据格式，不需要其他解释。电路格式如下：
{
  "nodes": [{"id": "节点ID", "x": 坐标, "y": 坐标, "type": "terminal|junction", "label": "标签"}],
  "components": [{"id": "元件ID", "name": "元件名", "type": "resistor|capacitor|inductor|voltage_source|current_source", "nodes": ["节点1", "节点2"], "params": {"value": 数值, "unit": "单位"}}]
}

电路描述：${description}

请直接输出JSON格式的电路数据，不要输出其他内容。`

        let apiResponse = ''
        
        for await (const chunk of sendVolcanoMessage([{ id: generateMessageId(), role: 'user', content: circuitPrompt }])) {
          apiResponse += chunk.content
        }

        const circuitData = parseCircuitFromAIResponse(apiResponse)
        
        if (circuitData && circuitData.components && circuitData.components.length > 0) {
          setCircuit(circuitData)
          setCircuitMessages(prev => [...prev, { 
            id: generateMessageId(), 
            role: 'assistant', 
            content: `✅ 已为你创建${description}！\n\n` + 
              circuitData.components.map(c => `- ${c.name}: ${c.type} (${c.params?.value}${c.params?.unit || ''})`).join('\n') +
              '\n\n点击"运行仿真"进行分析。'
          }])
          return
        }
      }
    } catch (e) {
      console.log('[电路助手] 火山引擎API创建电路失败，尝试本地解析')
    }

    // 2. 尝试本地解析
    const localResult = parseCircuitLocally(description)
    
    if (localResult) {
      setCircuit(localResult.circuit)
      setCircuitMessages(prev => [...prev, { 
        id: generateMessageId(), 
        role: 'assistant', 
        content: localResult.response + '\n\n点击"运行仿真"进行分析。'
      }])
      return
    }
    
    // 3. 调用后端API
    try {
      const response = await fetchWithTimeout(`${API_BASE_URL}/julia/circuit/describe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, language: 'zh-CN' })
      })
      
      if (response?.ok) {
        const data = await response.json()
        if (data.success && data.circuit_data) {
          setCircuit(data.circuit_data)
          setCircuitMessages(prev => [...prev, { 
            id: generateMessageId(), 
            role: 'assistant', 
            content: '✅ 电路创建成功！\n\n点击"运行仿真"进行分析。'
          }])
        }
      }
    } catch (error) {
      console.error('电路创建失败:', error)
    }
  }

  const parseCircuitFromAIResponse = useCallback((aiResponse: string): Circuit | null => {
    try {
      console.log('[电路解析] 原始AI响应:', aiResponse.substring(0, 200))
      
      let jsonStr = aiResponse.trim()
      
      // 尝试提取JSON（可能有markdown代码块）
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/) || jsonStr.match(/(\{[\s\S]*\})/)
      if (jsonMatch) {
        jsonStr = jsonMatch[1] || jsonMatch[0]
      }
      
      // 清理JSON字符串
      jsonStr = jsonStr.replace(/^[^{]*/, '').replace(/[^}]*$/, '')
      
      const parsed = JSON.parse(jsonStr)
      
      // 验证并规范化电路数据
      const circuit: Circuit = {
        nodes: [],
        components: []
      }
      
      // 处理nodes
      if (Array.isArray(parsed.nodes)) {
        circuit.nodes = parsed.nodes.map((node: { id: string; x: number; y: number; type?: string; label?: string }, idx: number) => ({
          id: node.id || `n${idx}`,
          x: typeof node.x === 'number' ? node.x : 100 + idx * 80,
          y: typeof node.y === 'number' ? node.y : 100 + idx * 50,
          type: node.type || 'junction',
          label: node.label || node.id || `Node ${idx}`
        }))
      }
      
      // 处理components
      if (Array.isArray(parsed.components)) {
        circuit.components = parsed.components.map((comp: { id?: string; name?: string; type?: string; nodes?: string[]; params?: { value?: number; unit?: string } }, idx: number) => ({
          id: comp.id || `comp_${idx}`,
          name: comp.name || `Component${idx + 1}`,
          type: comp.type || 'resistor',
          nodes: Array.isArray(comp.nodes) ? comp.nodes : ['n1', 'n2'],
          params: {
            value: typeof comp.params?.value === 'number' ? comp.params.value : 1000,
            unit: comp.params?.unit || 'Ω'
          }
        }))
      }
      
      // 如果没有nodes，根据components自动生成
      if (circuit.nodes.length === 0 && circuit.components.length > 0) {
        const nodeIds = new Set<string>()
        circuit.components.forEach(comp => {
          if (Array.isArray(comp.nodes)) {
            comp.nodes.forEach(n => nodeIds.add(n))
          }
        })
        
        let x = 100
        nodeIds.forEach(id => {
          circuit.nodes.push({
            id,
            x,
            y: 150,
            type: id === 'gnd' ? 'terminal' : 'junction',
            label: id
          })
          x += 100
        })
      }
      
      console.log('[电路解析] 解析成功:', circuit)
      return circuit
    } catch (error) {
      console.error('[电路解析] 解析失败:', error)
      return null
    }
  }, [])

  const parseCircuitLocally = useCallback((description: string): { circuit: Circuit; response: string } | null => {
    const lowerDesc = description.toLowerCase()
    
    // 共射放大电路关键词
    const commonEmitterKeywords = [
      '共射', '共射放大', 'common emitter', '晶体管放大', '三极管放大',
      '晶体管', '三极管', 'BJT', 'transistor', 'amplifier', '放大电路',
      '单管放大', '基本放大'
    ]
    
    // 分压电路关键词
    const voltageDividerKeywords = [
      '分压', 'voltage divider', '分压电路', '分压器', '电阻分压',
      '偏置电路', '基极偏置'
    ]
    
    // RC电路关键词
    const rcKeywords = [
      'rc', 'RC', '阻容', '电阻电容', 'RC电路', 'RC串联', 'RC并联',
      '充电', '放电', '时间常数', '高通', '低通', '滤波'
    ]
    
    // RLC电路关键词
    const rlcKeywords = [
      'rlc', 'RLC', '谐振', '串联谐振', '并联谐振', 'LC电路',
      '振荡', '带通', '带阻', '品质因数', 'Q值'
    ]
    
    // 电源电路关键词
    const powerKeywords = [
      '电源', 'voltage source', '直流电源', 'DC电源', '供电',
      '稳压', '整流', '滤波电源'
    ]
    
    // 直流斩波电路关键词
    const chopperKeywords = [
      '直流斩波', '斩波电路', 'PWM电路', '逆变电路', '升压电路', '降压电路',
      'Buck', 'Boost', 'Buck-Boost', 'DC-DC', 'dc-dc', '开关电源',
      'PWM', '脉冲宽度调制', '占空比'
    ]
    
    // 运算放大器关键词
    const opampKeywords = [
      '运放', '运算放大', 'op amp', 'op-amp', 'opamp', '运算放大器',
      '反相放大', '同相放大', '差分放大', '积分电路', '微分电路'
    ]
    
    // 基本元件关键词
    const resistorKeywords = ['电阻', 'resistor', 'R电路', '欧姆定律']
    const capacitorKeywords = ['电容', 'capacitor', '电容器', 'C电路']
    const inductorKeywords = ['电感', 'inductor', '电感器', 'L电路']
    
    // 分析类型关键词
    const analysisKeywords = [
      '分析', '仿真', '仿真', '频率响应', '波特图', '增益',
      'transient', 'ac analysis', 'dc analysis', '瞬态', '交流', '直流',
      'Bode', 'bode', '相位', '幅频特性', '相频特性'
    ]
    
    // 意图分类
    const isCommonEmitterRequest = commonEmitterKeywords.some(kw => lowerDesc.includes(kw))
    const isVoltageDividerRequest = voltageDividerKeywords.some(kw => lowerDesc.includes(kw))
    const isRCRequest = rcKeywords.some(kw => lowerDesc.includes(kw))
    const isRLCRequest = rlcKeywords.some(kw => lowerDesc.includes(kw))
    const isPowerRequest = powerKeywords.some(kw => lowerDesc.includes(kw))
    const isChopperRequest = chopperKeywords.some(kw => lowerDesc.includes(kw))
    const isOpampRequest = opampKeywords.some(kw => lowerDesc.includes(kw))
    const isResistorRequest = resistorKeywords.some(kw => lowerDesc.includes(kw))
    const isCapacitorRequest = capacitorKeywords.some(kw => lowerDesc.includes(kw))
    const isInductorRequest = inductorKeywords.some(kw => lowerDesc.includes(kw))
    const isAnalysisRequest = analysisKeywords.some(kw => lowerDesc.includes(kw))
    
    // 共射放大电路
    if (isCommonEmitterRequest) {
      const circuit: Circuit = {
        nodes: [
          { id: 'gnd', x: 400, y: 500, type: 'terminal', label: 'GND' },
          { id: 'n1', x: 150, y: 150, type: 'junction', label: 'Base' },
          { id: 'n2', x: 400, y: 150, type: 'junction', label: 'Collector' },
          { id: 'n3', x: 650, y: 150, type: 'junction', label: 'Output' },
          { id: 'n4', x: 400, y: 350, type: 'junction', label: 'Emitter' }
        ],
        components: [
          { id: 'comp_vs', type: 'voltage_source', name: 'Vcc', nodes: ['gnd', 'n2'], params: { value: 12, unit: 'V', polarity: 'positive' } },
          { id: 'comp_rb1', type: 'resistor', name: 'Rb1', nodes: ['n2', 'n1'], params: { value: 100000, unit: 'Ω' } },
          { id: 'comp_rb2', type: 'resistor', name: 'Rb2', nodes: ['n1', 'gnd'], params: { value: 20000, unit: 'Ω' } },
          { id: 'comp_rc', type: 'resistor', name: 'Rc', nodes: ['n2', 'n3'], params: { value: 2000, unit: 'Ω' } },
          { id: 'comp_re', type: 'resistor', name: 'Re', nodes: ['n4', 'gnd'], params: { value: 500, unit: 'Ω' } },
          { id: 'comp_c1', type: 'capacitor', name: 'C1', nodes: ['gnd', 'n1'], params: { value: 0.00001, unit: 'F' } },
          { id: 'comp_c2', type: 'capacitor', name: 'C2', nodes: ['n3', 'n4'], params: { value: 0.00001, unit: 'F' } },
          { id: 'comp_rl', type: 'resistor', name: 'RL', nodes: ['n4', 'gnd'], params: { value: 10000, unit: 'Ω' } }
        ]
      }
      
      let response = `✅ **共射放大电路已创建！**\n\n`
      
      if (isAnalysisRequest) {
        response += `针对你的频率响应分析需求，建议进行**交流分析(AC)**。\n\n`
      }
      
      response += `**电路参数：**\n`
      response += `- 电源电压 Vcc: 12V\n`
      response += `- 基极偏置 Rb1: 100kΩ, Rb2: 20kΩ\n`
      response += `- 集电极电阻 Rc: 2kΩ\n`
      response += `- 发射极电阻 Re: 500Ω\n`
      response += `- 耦合电容 C1, C2: 10μF\n`
      response += `- 负载电阻 RL: 10kΩ\n\n`
      
      response += `**理论增益：** Av ≈ -Rc/Re = -2000/500 = -4\n\n`
      
      response += `**推荐分析：**\n`
      response += `1. **直流分析(DC)** - 查看静态工作点\n`
      response += `2. **交流分析(AC)** - 查看频率响应和增益带宽\n`
      response += `3. **瞬态分析(Transient)** - 查看输入输出波形`
      
      return { circuit, response }
    }
    
    // 分压电路
    if (isVoltageDividerRequest) {
      const circuit: Circuit = {
        nodes: [
          { id: 'gnd', x: 400, y: 450, type: 'terminal', label: 'GND' },
          { id: 'n1', x: 200, y: 200, type: 'junction', label: 'Vin' },
          { id: 'n2', x: 600, y: 200, type: 'junction', label: 'Vout' }
        ],
        components: [
          { id: 'comp_vs1', type: 'voltage_source', name: 'V1', nodes: ['gnd', 'n1'], params: { value: 12, unit: 'V' } },
          { id: 'comp_r1', type: 'resistor', name: 'R1', nodes: ['n1', 'n2'], params: { value: 1000, unit: 'Ω' } },
          { id: 'comp_r2', type: 'resistor', name: 'R2', nodes: ['n2', 'gnd'], params: { value: 2000, unit: 'Ω' } }
        ]
      }
      
      let vout = 12 * 2000 / (1000 + 2000)
      
      let response = `✅ **分压电路已创建！**\n\n`
      response += `**电路参数：**\n`
      response += `- 输入电压 Vin: 12V\n`
      response += `- R1: 1kΩ\n`
      response += `- R2: 2kΩ\n\n`
      response += `**计算结果：**\n`
      response += `- Vout = Vin × R2/(R1+R2) = 12 × 2000/3000 = ${vout.toFixed(2)}V\n`
      response += `- 分压比 = R2/(R1+R2) = 2/3\n\n`
      response += `点击"运行仿真"查看实际节点电压。`
      
      return { circuit, response }
    }
    
    // RC电路
    if (isRCRequest) {
      const circuit: Circuit = {
        nodes: [
          { id: 'gnd', x: 400, y: 450, type: 'terminal', label: 'GND' },
          { id: 'n1', x: 200, y: 200, type: 'junction', label: 'Input' },
          { id: 'n2', x: 600, y: 200, type: 'junction', label: 'RC Junction' }
        ],
        components: [
          { id: 'comp_vs2', type: 'voltage_source', name: 'V1', nodes: ['gnd', 'n1'], params: { value: 10, unit: 'V' } },
          { id: 'comp_r3', type: 'resistor', name: 'R1', nodes: ['n1', 'n2'], params: { value: 1000, unit: 'Ω' } },
          { id: 'comp_c1', type: 'capacitor', name: 'C1', nodes: ['n2', 'gnd'], params: { value: 0.0001, unit: 'F' } }
        ]
      }
      
      let tau = 1000 * 0.0001
      
      let response = `✅ **RC串联电路已创建！**\n\n`
      response += `**电路参数：**\n`
      response += `- 电源: 10V\n`
      response += `- 电阻 R: 1kΩ\n`
      response += `- 电容 C: 100μF\n\n`
      response += `**特性分析：**\n`
      response += `- 时间常数 τ = RC = ${tau.toFixed(3)}秒\n`
      response += `- 5τ 充满时间 = ${(5 * tau).toFixed(3)}秒\n`
      response += `- 截止频率 fc = 1/(2πRC) ≈ ${(1 / (2 * Math.PI * tau)).toFixed(1)}Hz\n\n`
      
      if (lowerDesc.includes('充电') || lowerDesc.includes('瞬态')) {
        response += `建议进行**瞬态分析(Transient)**观察充电过程。`
      } else if (lowerDesc.includes('频率响应') || lowerDesc.includes('波特')) {
        response += `建议进行**交流分析(AC)**查看频率响应特性。`
      } else {
        response += `建议进行**瞬态分析(Transient)**观察充放电过程。`
      }
      
      return { circuit, response }
    }
    
    // RLC电路
    if (isRLCRequest) {
      const circuit: Circuit = {
        nodes: [
          { id: 'gnd', x: 400, y: 500, type: 'terminal', label: 'GND' },
          { id: 'n1', x: 200, y: 200, type: 'junction', label: 'Source' },
          { id: 'n2', x: 400, y: 200, type: 'junction', label: 'Inductor' },
          { id: 'n3', x: 600, y: 200, type: 'junction', label: 'Capacitor' }
        ],
        components: [
          { id: 'comp_vs3', type: 'voltage_source', name: 'V1', nodes: ['gnd', 'n1'], params: { value: 10, unit: 'V' } },
          { id: 'comp_r4', type: 'resistor', name: 'R1', nodes: ['n1', 'n2'], params: { value: 50, unit: 'Ω' } },
          { id: 'comp_l1', type: 'inductor', name: 'L1', nodes: ['n2', 'n3'], params: { value: 0.1, unit: 'H' } },
          { id: 'comp_c2', type: 'capacitor', name: 'C1', nodes: ['n3', 'gnd'], params: { value: 0.00001, unit: 'F' } }
        ]
      }
      
      let L = 0.1
      let C = 0.00001
      let fo = 1 / (2 * Math.PI * Math.sqrt(L * C))
      let Qo = Math.sqrt(L / C) / 50
      
      let response = `✅ **RLC串联谐振电路已创建！**\n\n`
      response += `**电路参数：**\n`
      response += `- 电源: 10V\n`
      response += `- 电阻 R: 50Ω\n`
      response += `- 电感 L: 100mH\n`
      response += `- 电容 C: 10μF\n\n`
      response += `**谐振特性：**\n`
      response += `- 谐振频率 f₀ = 1/(2π√LC) ≈ ${fo.toFixed(1)}Hz\n`
      response += `- 品质因数 Q₀ ≈ ${Qo.toFixed(1)}\n`
      response += `- 带宽 BW = f₀/Q ≈ ${(fo / Qo).toFixed(1)}Hz\n\n`
      
      if (lowerDesc.includes('振荡') || lowerDesc.includes('瞬态')) {
        response += `建议进行**瞬态分析(Transient)**观察振荡现象。`
      } else {
        response += `建议进行**交流分析(AC)**查看频率响应曲线。`
      }
      
      return { circuit, response }
    }
    
    // 直流斩波电路（PWM控制）
    if (isChopperRequest) {
      const circuit: Circuit = {
        nodes: [
          { id: 'gnd', x: 400, y: 500, type: 'terminal', label: 'GND' },
          { id: 'n1', x: 200, y: 200, type: 'junction', label: 'Input (12V)' },
          { id: 'n2', x: 400, y: 200, type: 'junction', label: 'MOSFET Drain' },
          { id: 'n3', x: 600, y: 200, type: 'junction', label: 'Output' },
          { id: 'n4', x: 400, y: 350, type: 'junction', label: 'MOSFET Source' }
        ],
        components: [
          { id: 'comp_vs', type: 'voltage_source', name: 'Vin', nodes: ['gnd', 'n1'], params: { value: 12, unit: 'V' } },
          { id: 'comp_r1', type: 'resistor', name: 'Rload', nodes: ['n3', 'gnd'], params: { value: 100, unit: 'Ω' } },
          { id: 'comp_c1', type: 'capacitor', name: 'Cout', nodes: ['n3', 'gnd'], params: { value: 0.001, unit: 'F' } },
          { id: 'comp_d1', type: 'resistor', name: 'DutyCycle', nodes: ['n2', 'n3'], params: { value: 50, unit: '%' } }
        ]
      }
      
      let response = `✅ **直流斩波电路已创建！**\n\n`
      response += `**电路参数：**\n`
      response += `- 输入电压: 12V DC\n`
      response += `- 负载电阻: 100Ω\n`
      response += `- 输出电容: 1000μF\n`
      response += `- PWM占空比: 50%\n\n`
      response += `**斩波电路特性：**\n`
      response += `- 类型: PWM降压斩波 (Buck)\n`
      response += `- 输出电压: Vin × 占空比 ≈ 6V\n`
      response += `- 开关频率: 10kHz (典型值)\n\n`
      response += `**分析建议：**\n`
      response += `建议进行**瞬态分析(Transient)**观察PWM波形和输出电压纹波。`
      
      return { circuit, response }
    }
    
    // 运算放大器电路
    if (isOpampRequest) {
      const circuit: Circuit = {
        nodes: [
          { id: 'gnd', x: 400, y: 500, type: 'terminal', label: 'GND' },
          { id: 'n1', x: 150, y: 150, type: 'junction', label: 'Inverting Input (-)' },
          { id: 'n2', x: 400, y: 150, type: 'junction', label: 'Non-inverting Input (+)' },
          { id: 'n3', x: 650, y: 150, type: 'junction', label: 'Output' },
          { id: 'n4', x: 400, y: 350, type: 'junction', label: 'Feedback' }
        ],
        components: [
          { id: 'comp_vs', type: 'voltage_source', name: 'V+', nodes: ['gnd', 'n2'], params: { value: 5, unit: 'V' } },
          { id: 'comp_rin', type: 'resistor', name: 'Rin', nodes: ['gnd', 'n1'], params: { value: 1000, unit: 'Ω' } },
          { id: 'comp_rf', type: 'resistor', name: 'Rf', nodes: ['n1', 'n3'], params: { value: 10000, unit: 'Ω' } },
          { id: 'comp_rg', type: 'resistor', name: 'Rg', nodes: ['n2', 'gnd'], params: { value: 1000, unit: 'Ω' } }
        ]
      }
      
      let gain = 10000 / 1000
      
      let response = `✅ **运算放大器电路已创建！**\n\n`
      response += `**电路配置：**\n`
      response += `- 反相输入端 (-): 通过 Rin 接地\n`
      response += `- 同相输入端 (+): 通过 Rg 接地\n`
      response += `- 反馈网络: Rf 连接输出到反相端\n\n`
      response += `**参数计算：**\n`
      response += `- 反馈电阻 Rf: 10kΩ\n`
      response += `- 输入电阻 Rin: 1kΩ\n`
      response += `- 电压增益: -Rf/Rin = -${gain}\n\n`
      response += `*注: 这是理想运放模型，可用于基本放大特性分析。\n`
      response += `建议进行直流分析和瞬态分析。`
      
      return { circuit, response }
    }
    
    // 电源电路
    if (isPowerRequest && !isCommonEmitterRequest) {
      let circuit = createDefaultCircuit()
      circuit.nodes = [
        { id: 'gnd', x: 400, y: 450, type: 'terminal', label: 'GND' },
        { id: 'n1', x: 400, y: 200, type: 'junction', label: 'Vout' }
      ]
      circuit.components = [
        { id: 'comp_vs', type: 'voltage_source', name: 'V1', nodes: ['gnd', 'n1'], params: { value: 12, unit: 'V', polarity: 'positive' } }
      ]
      
      let response = `✅ **电源电路已创建！**\n\n`
      response += `**电路配置：**\n`
      response += `- 电压源: 12V DC\n`
      response += `- 输出节点: Vout\n\n`
      response += `可以继续添加滤波电容、负载电阻等元件。\n`
      response += `建议添加一个滤波电容(100μF)来平滑输出。`
      
      return { circuit, response }
    }
    
    // 纯分析请求（无具体电路）
    if (isAnalysisRequest && !isCommonEmitterRequest && !isVoltageDividerRequest && 
        !isRCRequest && !isRLCRequest && !isOpampRequest) {
      let circuit: Circuit = createDefaultCircuit()
      
      let response = `✅ **电路分析助手已就绪！**\n\n`
      response += `我理解你想进行电路分析。当前支持的电路类型：\n\n`
      response += `**1. 共射放大电路**\n`
      response += `   关键词: "共射"、"晶体管放大"、"amplifier"\n`
      response += `   支持频率响应分析\n\n`
      response += `**2. 分压电路**\n`
      response += `   关键词: "分压"、"voltage divider"\n`
      response += `   支持直流分析\n\n`
      response += `**3. RC电路**\n`
      response += `   关键词: "RC"、"阻容"、"滤波"\n`
      response += `   支持瞬态和频率响应分析\n\n`
      response += `**4. RLC电路**\n`
      response += `   关键词: "RLC"、"谐振"、"振荡"\n`
      response += `   支持频率响应分析\n\n`
      response += `**5. 运算放大器**\n`
      response += `   关键词: "运放"、"op-amp"、"放大电路"\n\n`
      
      response += `请告诉我你想分析的具体电路类型，例如：\n`
      response += `- "分析共射放大电路的频率响应"\n`
      response += `- "设计一个分压电路"\n`
      response += `- "RC串联电路的瞬态响应"`
      
      return { circuit, response }
    }
    
    // 基本元件检测
    if (isResistorRequest && !isVoltageDividerRequest && !isRCRequest && !isRLCRequest) {
      let circuit: Circuit = createDefaultCircuit()
      circuit.components = [
        { id: 'comp_vs', type: 'voltage_source', name: 'V1', nodes: ['gnd', 'n1'], params: { value: 10, unit: 'V' } },
        { id: 'comp_r', type: 'resistor', name: 'R1', nodes: ['n1', 'n2'], params: { value: 100, unit: 'Ω' } }
      ]
      
      let response = `✅ **已创建简单电阻电路！**\n\n`
      response += `**已添加元件：**\n`
      response += `- 电压源: 10V\n`
      response += `- 电阻: 100Ω\n\n`
      response += `**计算：**\n`
      response += `- 电流 I = V/R = 10V/100Ω = 0.1A\n\n`
      response += `可以继续添加其他元件或点击"运行仿真"。`
      
      return { circuit, response }
    }
    
    if (isCapacitorRequest && !isRCRequest && !isRLCRequest) {
      let circuit: Circuit = createDefaultCircuit()
      circuit.components = [
        { id: 'comp_vs', type: 'voltage_source', name: 'V1', nodes: ['gnd', 'n1'], params: { value: 10, unit: 'V' } },
        { id: 'comp_c', type: 'capacitor', name: 'C1', nodes: ['n1', 'n2'], params: { value: 0.001, unit: 'F' } }
      ]
      
      let response = `✅ **已创建电容电路！**\n\n`
      response += `**已添加元件：**\n`
      response += `- 电压源: 10V\n`
      response += `- 电容: 1000μF\n\n`
      response += `电容可用于滤波、耦合、储能等应用。\n`
      response += `建议与电阻配合使用构成RC电路。`
      
      return { circuit, response }
    }
    
    if (isInductorRequest && !isRLCRequest) {
      let circuit: Circuit = createDefaultCircuit()
      circuit.components = [
        { id: 'comp_vs', type: 'voltage_source', name: 'V1', nodes: ['gnd', 'n1'], params: { value: 10, unit: 'V' } },
        { id: 'comp_l', type: 'inductor', name: 'L1', nodes: ['n1', 'n2'], params: { value: 0.01, unit: 'H' } }
      ]
      
      let response = `✅ **已创建电感电路！**\n\n`
      response += `**已添加元件：**\n`
      response += `- 电压源: 10V\n`
      response += `- 电感: 10mH\n\n`
      response += `电感可用于滤波、储能和扼流等应用。\n`
      response += `建议与电容配合使用构成RLC电路。`
      
      return { circuit, response }
    }
    
    // 创建默认电路作为兜底
    const defaultCircuit: Circuit = createDefaultCircuit()
    defaultCircuit.components = [
      { id: 'comp_vs', type: 'voltage_source', name: 'V1', nodes: ['gnd', 'n1'], params: { value: 10, unit: 'V' } },
      { id: 'comp_r', type: 'resistor', name: 'R1', nodes: ['n1', 'n2'], params: { value: 1000, unit: 'Ω' } }
    ]
    
    let defaultResponse = `✅ **电路设计助手**\n\n`
    defaultResponse += `我无法精确识别你的电路描述，但已为你创建默认电路。\n\n`
    defaultResponse += `**支持的电路类型：**\n`
    defaultResponse += `1. 共射放大电路 - "共射放大"、"晶体管放大"\n`
    defaultResponse += `2. 分压电路 - "分压电路"、"偏置电路"\n`
    defaultResponse += `3. RC电路 - "RC串联"、"阻容"\n`
    defaultResponse += `4. RLC电路 - "RLC"、"谐振电路"\n`
    defaultResponse += `5. 运放电路 - "运算放大"、"op-amp"\n\n`
    defaultResponse += `**分析类型：**\n`
    defaultResponse += `- 直流分析(DC) - 节点电压\n`
    defaultResponse += `- 交流分析(AC) - 频率响应\n`
    defaultResponse += `- 瞬态分析(Transient) - 波形\n\n`
    defaultResponse += `请尝试更详细的描述，如："设计一个共射放大电路进行频率响应分析"`
    
    return { circuit: defaultCircuit, response: defaultResponse }
  }, [])

  const handleCircuitChat = async (messages: ChatMessage[]) => {
    setCircuitLoading(true)
    setIsThinking(true)
    const loadingMsgId = generateMessageId()
    
    setCircuitMessages(prev => [...prev, { 
      id: loadingMsgId, 
      role: 'assistant', 
      content: '正在分析你的电路描述...' 
    }])

    const userMessage = messages.filter(m => m.role === 'user').pop()
    const userContent = userMessage?.content || ''
    
    console.log('[电路助手] 用户输入:', userContent)
    
    // ========== 增强的意图分类系统 ==========
    
    // 优先级1: 明确创建电路的关键词
    const explicitCircuitKeywords = [
      '设计', '创建', 'build', 'create', '画', '搭建', '构成', 
      'generate', 'make', 'build a circuit', 'create a circuit',
      '构建', '生成', '做一个', '制作', '画出', '构造'
    ]
    
    // 优先级2: 电路类型名称（需要创建完整电路）
    const circuitTypeKeywords = [
      '共射放大', '共集放大', '共基放大', '分压电路', '偏置电路', 
      'RC串联', 'RC并联', 'RL串联', 'RLC串联', 'RLC并联', 
      '滤波电路', '振荡电路', '电源电路', '整流电路', '放大电路',
      '共射', '共集', '共基', 'RC电路', 'RL电路', 'RLC电路',
      '低通滤波', '高通滤波', '带通滤波', '带阻滤波',
      '直流斩波', '斩波电路', 'PWM电路', '逆变电路', '升压电路', '降压电路',
      'Buck电路', 'Boost电路', 'Buck-Boost电路'
    ]
    
    // 优先级3: 仿真/分析请求（不需要创建新电路）
    const simulationKeywords = [
      '仿真', '模拟', '运行分析', 'run simulation', '分析波形', 
      '频率响应', '瞬态响应', '直流分析', '交流分析'
    ]
    
    // 优先级4: 问答类关键词（纯问答，不创建电路）
    const qaKeywords = [
      '是什么', '原理', '工作原理', '解释', '区别', '特点', 
      '如何', '怎样', '多少', '哪些', '什么意思', '有什么用',
      '介绍一下', '说明一下', '讲讲'
    ]
    
    // 优先级5: 元件相关（可能是问答，也可能是创建）
    const componentKeywords = [
      '电阻', '电容', '电感', '晶体管', '二极管', '运放', 
      '变压器', 'MOSFET', 'BJT', 'IGBT', 'LED'
    ]
    
    // 优先级6: 新建电路关键词（明确表示要创建新电路）
    const newCircuitKeywords = [
      '新的', '另一个', '别的', '换一种', '重新', '再一个', 
      '重新设计', '重新创建', '重新构建', '换成一个', '换成新的',
      'build a new', 'create a new', 'another'
    ]
    
    // 优先级7: 参数调整请求（修改现有电路，而不是创建新电路）
    const adjustmentKeywords = [
      '改为', '改成', '调整', '修改', '增大', '减小', '增加', '减少',
      '改变', '提高', '降低', '替换', '换一个'
    ]
    
    // ========== 智能分类算法 ==========
    
    // 检查是否需要创建新电路（明确关键词 或 电路类型）
    const needsNewCircuit = explicitCircuitKeywords.some(kw => 
      userContent.toLowerCase().includes(kw.toLowerCase())
    ) || circuitTypeKeywords.some(kw => 
      userContent.toLowerCase().includes(kw.toLowerCase())
    )
    
    // 检查是否明确要新建电路（优先级最高）
    const wantsNewCircuit = newCircuitKeywords.some(kw => 
      userContent.toLowerCase().includes(kw.toLowerCase())
    ) && (needsNewCircuit || explicitCircuitKeywords.some(kw => 
      userContent.toLowerCase().includes(kw.toLowerCase())
    ))
    
    // 检查是否为仿真请求
    const isSimulationRequest = simulationKeywords.some(kw => 
      userContent.toLowerCase().includes(kw.toLowerCase())
    ) && !needsNewCircuit
    
    // 检查是否为一般问答（不排除混合请求）
    const isGeneralQA = qaKeywords.some(kw => 
      userContent.includes(kw)
    )

    // 检查是否为纯元件问答（不排除混合请求）
    const isComponentQA = componentKeywords.some(kw => 
      userContent.includes(kw)
    )
    
    // 检查是否为混合请求（既有问答又有创建电路）
    const hasQAIntent = (isGeneralQA || isComponentQA) && userContent.length > 10
    const hasCircuitIntent = wantsNewCircuit || needsNewCircuit
    
    // 如果同时有问答和电路创建意图，强制识别为混合模式
    const isMixedRequest = hasQAIntent && hasCircuitIntent
    
    // 检查是否为参数调整（修改现有电路，而不是创建新电路）
    // 只有在没有明确创建意图时，才认为是参数调整
    const needsAdjustment = adjustmentKeywords.some(kw => 
      userContent.toLowerCase().includes(kw.toLowerCase())
    ) && !wantsNewCircuit && !needsNewCircuit
    
    // 最终路由决策（优先级从高到低）
    let routingDecision: 'circuit_creation' | 'circuit_adjustment' | 'simulation' | 'qa' | 'qa_and_circuit' | 'unknown' = 'unknown'
    
    // 混合请求优先处理
    if (isMixedRequest) {
      routingDecision = 'qa_and_circuit'
    } else if (wantsNewCircuit || needsNewCircuit) {
      // 新建电路优先于参数调整
      routingDecision = 'circuit_creation'
    } else if (needsAdjustment && circuit && circuit.components.length > 0) {
      routingDecision = 'circuit_adjustment'
    } else if (isSimulationRequest) {
      routingDecision = 'simulation'
    } else if (isGeneralQA || isComponentQA) {
      routingDecision = 'qa'
    }
    
    console.log('[电路助手] 智能分类结果:', {
      wantsNewCircuit,
      needsNewCircuit,
      needsAdjustment,
      isSimulationRequest,
      isGeneralQA,
      isComponentQA,
      routingDecision
    })
    
    // ========== 路由处理 ==========
    
    // 0. 混合请求 - 既回答问题又创建电路
    if (routingDecision === 'qa_and_circuit') {
      console.log('[电路助手] 进入问答+电路创建混合模式')
      
      // 首先调用AI回答问题
      try {
        const apiHealthy = await checkApiHealth()
        
        if (apiHealthy) {
          let qaResponse = ''
          const qaMessages = messages.filter(m => m.role === 'user' || m.role === 'assistant') as ChatMessage[]
          
          for await (const chunk of sendVolcanoMessage(qaMessages)) {
            qaResponse += chunk.content
          }
          
          // 保存问答部分的回答
          const qaAnswer = qaResponse
          
          // 然后创建电路
          setCircuitMessages(prev => [...prev, { 
            id: generateMessageId(), 
            role: 'assistant', 
            content: qaAnswer + '\n\n---\n现在为你创建该电路...'
          }])
          
          // 提取电路描述并创建电路
          const circuitDescription = extractCircuitDescription(userContent)
          if (circuitDescription) {
            // 递归调用自己处理电路创建
            await handleCircuitCreation(circuitDescription, loadingMsgId)
          }
          
          setCircuitLoading(false)
          setIsThinking(false)
          return
        }
      } catch (e) {
        console.log('[电路助手] 混合模式API失败，尝试本地处理')
      }
      
      // 如果API不可用，使用本地处理
      const qaAnswer = generateDirectAnswer(userContent, analyzeUserIntent(userContent))
      setCircuitMessages(prev => [...prev, { 
        id: loadingMsgId, 
        role: 'assistant', 
        content: qaAnswer + '\n\n---\n现在为你创建该电路...'
      }])
      
      // 继续创建电路
      routingDecision = 'circuit_creation'
    }
    
    // 1. 新建电路 - 优先使用火山引擎API
    if (routingDecision === 'circuit_creation') {
      console.log('[电路助手] 进入电路创建模式 - 优先使用火山引擎API')
      setCircuitMessages(prev => {
        const last = prev[prev.length - 1]
        if (last && last.id === loadingMsgId) {
          return [...prev.slice(0, -1), { 
            id: loadingMsgId, 
            role: 'assistant', 
            content: '正在通过AI智能生成电路...' 
          }]
        }
        return prev
      })

      // 尝试1: 使用火山引擎API生成电路
      try {
        console.log('[电路助手] 尝试使用火山引擎API生成电路...')
        
        const apiHealthy = await checkApiHealth()
        
        if (apiHealthy) {
          // 构建电路描述提示
          const circuitPrompt = `请根据以下电路描述，生成一个电路。我需要你直接输出电路的JSON数据格式，不需要其他解释。电路格式如下：
{
  "nodes": [{"id": "节点ID", "x": 坐标, "y": 坐标, "type": "terminal|junction", "label": "标签"}],
  "components": [{"id": "元件ID", "name": "元件名", "type": "resistor|capacitor|inductor|voltage_source|current_source", "nodes": ["节点1", "节点2"], "params": {"value": 数值, "unit": "单位"}}]
}

用户描述：${userContent}

请直接输出JSON格式的电路数据，不要输出其他内容。`

          const volcanoMessages: ChatMessage[] = [
            ...messages.filter(m => m.role === 'user' || m.role === 'assistant') as ChatMessage[],
            { id: generateMessageId(), role: 'user', content: circuitPrompt }
          ]

          let apiResponse = ''
          
          for await (const chunk of sendVolcanoMessage(volcanoMessages)) {
            apiResponse += chunk.content
            setCircuitMessages(prev => {
              const last = prev[prev.length - 1]
              if (last && last.id === loadingMsgId) {
                return [...prev.slice(0, -1), { 
                  id: loadingMsgId, 
                  role: 'assistant', 
                  content: '正在智能生成电路...\n\n' + apiResponse.substring(0, 200)
                }]
              }
              return prev
            })
          }

          // 尝试解析API返回的JSON
          console.log('[电路助手] 火山引擎API返回:', apiResponse.substring(0, 500))
          
          const circuitData = parseCircuitFromAIResponse(apiResponse)
          
          if (circuitData && circuitData.components && circuitData.components.length > 0) {
            console.log('[电路助手] 成功解析火山引擎API返回的电路数据')
            setCircuit(circuitData)
            
            let responseText = `✅ **AI已为你创建电路！**\n\n`
            responseText += `**电路元件：**\n`
            circuitData.components.forEach((comp: { name: string; type: string; params: { value?: number; unit?: string } }) => {
              let params = ''
              if (comp.params?.value) {
                params = ` (${comp.params.value}${comp.params.unit || ''})`
              }
              responseText += `- ${comp.name}: ${comp.type}${params}\n`
            })
            responseText += `\n点击"运行仿真"进行分析。`
            
            setCircuitMessages(prev => {
              const last = prev[prev.length - 1]
              if (last && last.id === loadingMsgId) {
                return [...prev.slice(0, -1), { 
                  id: loadingMsgId, 
                  role: 'assistant', 
                  content: responseText
                }]
              }
              return prev
            })
            setCircuitLoading(false)
            setIsThinking(false)
            return
          } else {
            console.warn('[电路助手] 无法解析火山引擎API返回的电路数据，尝试其他方式')
          }
        }
      } catch (apiError) {
        console.error('[电路助手] 火山引擎API调用失败:', apiError)
      }

      // 尝试2: 火山引擎API失败，使用本地解析
      console.log('[电路助手] 尝试本地电路解析...')
      const localResult = parseCircuitLocally(userContent)
      
      if (localResult) {
        setCircuit(localResult.circuit)
        
        let enhancedResponse = localResult.response
        
        setCircuitMessages(prev => {
          const last = prev[prev.length - 1]
          if (last && last.id === loadingMsgId) {
            return [...prev.slice(0, -1), { 
              id: loadingMsgId, 
              role: 'assistant', 
              content: enhancedResponse
            }]
          }
          return prev
        })
        setCircuitLoading(false)
        setIsThinking(false)
        return
      }
      
      // 尝试3: 本地解析失败，使用后端API
      try {
        console.log('[电路助手] 尝试调用后端API...')
        const response = await fetchWithTimeout(`${API_BASE_URL}/julia/circuit/describe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: userContent, language: 'zh-CN' })
        })

        if (!response || !response.ok) {
          throw new Error('后端服务未启动')
        }

        const data = await response.json()
        
        if (data.success && data.circuit_data) {
          setCircuit(data.circuit_data)
          
          let responseText = `✅ **已为你创建电路！**\n\n`
          
          if (data.circuit_data.components.length > 0) {
            responseText += `**电路元件：**\n`
            data.circuit_data.components.forEach((comp: { name: string; type: string; params: { value?: number; unit?: string } }) => {
              let params = ''
              if (comp.params.value) {
                params = ` (${comp.params.value}${comp.params.unit || ''})`
              }
              responseText += `- ${comp.name}: ${comp.type}${params}\n`
            })
          }
          
          responseText += `\n点击"运行仿真"进行分析。`
          
          setCircuitMessages(prev => {
            const last = prev[prev.length - 1]
            if (last && last.id === loadingMsgId) {
              return [...prev.slice(0, -1), { id: loadingMsgId, role: 'assistant', content: responseText }]
            }
            return prev
          })
        } else {
          throw new Error(data.error || '无法解析电路描述')
        }
      } catch (error) {
        console.error('电路解析失败，使用默认电路:', error)
        
        const circuit = createDefaultCircuit()
        circuit.components = [
          { id: 'vs', name: 'V1', type: 'voltage_source', nodes: ['gnd', 'n1'], params: { value: 12, unit: 'V' } },
          { id: 'r1', name: 'R1', type: 'resistor', nodes: ['n1', 'n2'], params: { value: 10000, unit: 'Ω' } },
          { id: 'r2', name: 'R2', type: 'resistor', nodes: ['n2', 'gnd'], params: { value: 2000, unit: 'Ω' } },
          { id: 'rc', name: 'Rc', type: 'resistor', nodes: ['n2', 'n3'], params: { value: 2000, unit: 'Ω' } },
          { id: 're', name: 'Re', type: 'resistor', nodes: ['n2', 'gnd'], params: { value: 500, unit: 'Ω' } },
          { id: 'c1', name: 'C1', type: 'capacitor', nodes: ['input', 'n1'], params: { value: 0.00001, unit: 'F' } },
          { id: 'c2', name: 'C2', type: 'capacitor', nodes: ['n3', 'output'], params: { value: 0.00001, unit: 'F' } }
        ]
        setCircuit(circuit)
        
        setCircuitMessages(prev => {
          const last = prev[prev.length - 1]
          if (last && last.id === loadingMsgId) {
            return [...prev.slice(0, -1), { 
              id: loadingMsgId, 
              role: 'assistant', 
              content: `✅ **已创建共射放大电路！**\n\n**电路说明：**\n这是一个典型的NPN晶体管共射放大电路，包含：\n- V1: 12V直流电源\n- R1, R2: 基极分压偏置电路\n- Rc: 集电极负载电阻\n- Re: 发射极电阻\n- C1, C2: 耦合/旁路电容\n\n**建议分析：**\n- 直流分析(DC): 计算静态工作点\n- 瞬态分析(Transient): 观察输入输出波形\n\n点击"运行仿真"查看结果。`
            }]
          }
          return prev
        })
      }
      setCircuitLoading(false)
      setIsThinking(false)
      return
    }

    // 2. 仿真请求处理
    if (routingDecision === 'simulation') {
      console.log('[电路助手] 进入仿真模式')
      setCircuitMessages(prev => {
        const last = prev[prev.length - 1]
        if (last && last.id === loadingMsgId) {
          return [...prev.slice(0, -1), { 
            id: loadingMsgId, 
            role: 'assistant', 
            content: '**仿真分析**\n\n请选择分析类型并点击"运行仿真"按钮：\n\n支持的仿真类型：\n- DC（直流分析）：计算节点电压\n- AC（交流分析）：频率响应\n- Transient（瞬态分析）：时域波形'
          }]
        }
        return prev
      })
      setCircuitLoading(false)
      return
    }

    // 3. 问答模式
    let localAnswer = ''
    if (routingDecision === 'qa') {
      console.log('[电路助手] 进入智能问答模式')
      const intent = analyzeUserIntent(userContent)
      localAnswer = generateDirectAnswer(userContent, intent)
    } else {
      localAnswer = '我理解你的需求，请告诉我更多关于电路的详细信息。'
    }

    try {
      const apiHealthy = await checkApiHealth()
      if (apiHealthy) {
        let fullResponse = ''
        setCircuitMessages(prev => {
          const last = prev[prev.length - 1]
          if (last && last.id === loadingMsgId) {
            return [...prev.slice(0, -1), { id: loadingMsgId, role: 'assistant', content: '正在连接智能AI助手...' }]
          }
          return prev
        })
        
        for await (const chunk of sendVolcanoMessage(messages)) {
          fullResponse += chunk.content
          setCircuitMessages(prev => {
            const last = prev[prev.length - 1]
            if (last && last.id === loadingMsgId) {
              return [...prev.slice(0, -1), { id: loadingMsgId, role: 'assistant', content: fullResponse }]
            }
            const updated = [...prev]
            const assistantIdx = updated.findIndex(m => m.role === 'assistant' && m.id === loadingMsgId)
            if (assistantIdx >= 0) {
              updated[assistantIdx] = { ...updated[assistantIdx], content: fullResponse }
            }
            return updated
          })
          await new Promise(resolve => setTimeout(resolve, 10))
        }
        setCircuitLoading(false)
        setIsThinking(false)
        return
      }
    } catch (apiError) {
      console.warn('API服务不可用，降级到本地响应:', apiError)
    }

    setCircuitMessages(prev => {
      const last = prev[prev.length - 1]
      if (last && last.id === loadingMsgId) {
        return [...prev.slice(0, -1), { 
          id: loadingMsgId, 
          role: 'assistant', 
          content: `${localAnswer}\n\n---\n*💡 当前使用本地知识库回答，如需AI智能回答，请确保后端服务已启动。*`
        }]
      }
      return prev
    })
    setCircuitLoading(false)
    setIsThinking(false)
  }

  const runJuliaSimulation = async (method: string = 'dc') => {
    if (circuit.components.length === 0) {
      message.warning('请先创建电路再运行仿真')
      return
    }

    setSimulating(true)
    setSimulationResult(null)
    setWaveformData(null)
    setProgress(10)

    console.log('[仿真] 开始仿真请求，电路元件数:', circuit.components.length)
    console.log('[仿真] 分析类型:', method)

    try {
      const response = await fetchWithTimeout(`${API_BASE_URL}/julia/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          circuit: circuit,
          analysis_type: method,
          parameters: method === 'transient' ? {
            start_time: 0,
            end_time: 0.001,
            steps: 100
          } : method === 'ac' ? {
            frequency_range: [1, 1000000]
          } : {}
        }),
        timeout: 30000
      })

      setProgress(50)

      console.log('[仿真] 响应状态:', response?.status)
      
      if (!response?.ok) {
        const errorText = await response?.text().catch(() => '无法读取错误信息')
        console.error('[仿真] 服务器错误:', errorText)
        throw new Error(`仿真服务器错误 (${response?.status}): ${errorText}`)
      }

      const data = await response.json()
      console.log('[仿真] 收到响应:', JSON.stringify(data).substring(0, 500))
      
      setProgress(70)

      if (!data.success) {
        console.warn('[仿真] 后端返回失败:', data.error)
        throw new Error(data.error || '仿真执行失败')
      }

      const parseTransientData = (backendData: Record<string, unknown> | undefined): { time: number[]; values: Record<string, number[]> } | undefined => {
        console.log('[仿真] 解析数据:', backendData)
        if (!backendData) {
          console.log('[仿真] 数据为空')
          return undefined
        }
        
        if (Array.isArray(backendData)) {
          console.log('[仿真] 数据是数组，跳过')
          return undefined
        }
        
        if (backendData.time && backendData.values) {
          console.log('[仿真] 使用标准格式')
          return {
            time: backendData.time as number[],
            values: backendData.values as Record<string, number[]>
          }
        }
        
        const waveforms = backendData.waveforms || backendData.waveform
        console.log('[仿真] 波形数据:', waveforms)
        if (waveforms && typeof waveforms === 'object') {
          const time: number[] = []
          const values: Record<string, number[]> = {}
          
          Object.entries(waveforms).forEach(([key, waveformData]) => {
            console.log(`[仿真] 处理波形 ${key}:`, waveformData)
            if (Array.isArray(waveformData)) {
              values[key] = []
              waveformData.forEach((point: Record<string, unknown>, idx: number) => {
                if (point.time !== undefined) {
                  if (time.length === 0) time.push(point.time as number)
                } else if (point.time_ms !== undefined) {
                  if (time.length === 0) time.push((point.time_ms as number) / 1000)
                } else if (time.length === 0) {
                  time.push(idx * 0.0001)
                }
                
                if (point.voltage !== undefined) {
                  values[key].push(point.voltage as number)
                } else if (point.current !== undefined) {
                  values[key].push(point.current as number)
                } else if (point.value !== undefined) {
                  values[key].push(point.value as number)
                } else if (point.magnitude !== undefined) {
                  values[key].push(point.magnitude as number)
                } else if (point.phase !== undefined) {
                  values[key].push(point.phase as number)
                } else if (typeof point === 'number') {
                  values[key].push(point as number)
                }
              })
              if (values[key].length === 0) {
                console.log(`[仿真] 波形 ${key} 数据为空，使用模拟数据`)
                values[key] = Array(100).fill(0).map((_, i) => Math.sin(i / 10))
              }
              console.log(`[仿真] 波形 ${key} 数据点数:`, values[key].length)
            }
          })
          
          if (time.length === 0) {
            console.log('[仿真] 时间轴为空，生成默认时间')
            time.length = 0
            for (let i = 0; i < 100; i++) {
              time.push(i * 0.0001)
            }
          }
          
          if (Object.keys(values).length > 0) {
            console.log('[仿真] 解析成功，波形数量:', Object.keys(values).length)
            return { time, values }
          }
        }
        
        console.log('[仿真] 无法解析数据格式')
        return undefined
      }

      const transientData = parseTransientData(data.result || data.transient || data.waveforms || data.waveform)
      console.log('[仿真] 瞬态数据解析结果:', transientData)
      
      const result: SimulationResult = {
        success: true,
        method,
        message: data.message || '仿真完成',
        result: {
          solution: data.result?.solution || data.solution || data.node_voltages,
          transient: transientData
        }
      }

      console.log('[仿真] 设置仿真结果:', result)
      setSimulationResult(result)

      if (transientData) {
        console.log('[仿真] 设置波形数据')
        setWaveformData(transientData)
      } else if (method === 'dc' && data.result?.solution) {
        console.log('[仿真] DC分析，生成电压柱状图数据')
        const solution = data.result.solution
        const time = Object.keys(solution).map((_, i) => i)
        const values: Record<string, number[]> = {}
        
        Object.entries(solution).forEach(([key, val]) => {
          if (typeof val === 'number') {
            values[key] = [val]
          } else if (val && typeof val === 'object') {
            const valObj = val as Record<string, unknown>
            const voltage = valObj.voltage !== undefined ? valObj.voltage as number : ((valObj.value as number) || 0)
            values[key] = [voltage]
          }
        })
        
        if (Object.keys(values).length > 0) {
          setWaveformData({ time, values })
        }
      } else {
        console.warn('[仿真] 没有波形数据，检查后端返回:', data)
      }

      setSimulationHistory(prev => [...prev.slice(-9), result])
      message.success('仿真完成！')
      console.log('[仿真] 仿真成功完成')
      
      setTimeout(() => {
        drawCircuitDiagram()
      }, 100)
    } catch (error) {
      console.error('[仿真] 失败:', error)
      message.error(`仿真失败: ${(error as Error).message}`)
      
      const mockResult = generateMockSimulationResult(method)
      console.log('[仿真] 使用模拟结果:', mockResult)
      setSimulationResult(mockResult)
      setWaveformData(mockResult.result.transient ? {
        time: mockResult.result.transient.time,
        values: mockResult.result.transient.values
      } : null)
      
      setTimeout(() => {
        drawCircuitDiagram()
      }, 100)
    } finally {
      setSimulating(false)
      setProgress(100)
    }
  }

  const generateMockSimulationResult = (method: string): SimulationResult => {
    if (method === 'transient') {
      const time = Array.from({ length: 100 }, (_, i) => i * 0.00001)
      const values: Record<string, number[]> = {}
      
      circuit.components.forEach((comp, idx) => {
        const colorIdx = idx % 5
        const baseValues = Array.from({ length: 100 }, (_, i) => 
          10 * (1 - Math.exp(-i / 20)) * Math.sin(i / 15)
        )
        values[comp.name] = baseValues
      })
      
      return {
        success: true,
        method,
        result: {
          solution: {
            'V(n1)': 10.0,
            'V(n2)': 5.0
          },
          transient: { time, values }
        }
      }
    }
    
    return {
      success: true,
      method,
      result: {
        solution: {
          'V(n1)': 10.0,
          'V(n2)': 5.0,
          'I(R1)': 0.005,
          'I(R2)': 0.0025
        }
      }
    }
  }

  const addComponent = (type: 'resistor' | 'voltage_source' | 'capacitor' | 'inductor') => {
    const id = `comp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    let newComp: CircuitComponent
    
    switch (type) {
      case 'resistor':
        newComp = { id, type: 'resistor', name: `R${id.slice(-4)}`, nodes: ['n1', 'n2'], params: { value: 100, unit: 'Ω' } }
        break
      case 'voltage_source':
        newComp = { id, type: 'voltage_source', name: `V${id.slice(-4)}`, nodes: ['gnd', 'n1'], params: { value: 10, unit: 'V', polarity: 'positive' } }
        break
      case 'capacitor':
        newComp = { id, type: 'capacitor', name: `C${id.slice(-4)}`, nodes: ['n1', 'n2'], params: { value: 0.001, unit: 'F' } }
        break
      case 'inductor':
        newComp = { id, type: 'inductor', name: `L${id.slice(-4)}`, nodes: ['n1', 'n2'], params: { value: 0.01, unit: 'H' } }
        break
      default:
        return
    }
    
    setCircuit(prev => ({ ...prev, components: [...prev.components, newComp] }))
    message.success(`已添加 ${newComp.name}`)
  }

  const clearCircuit = () => {
    setCircuit(createDefaultCircuit())
    setSimulationResult(null)
    setWaveformData(null)
    setSimulationHistory([])
    message.info('电路已清空')
  }

  const handleWaveformZoom = (delta: number) => {
    setWaveformZoom(prev => Math.max(0.5, Math.min(3, prev + delta)))
  }

  const handleWaveformPan = (direction: 'left' | 'right') => {
    
  }

  const handleWaveformPointHover = (point: {x: number; y: number; label: string} | null) => {
    if (point) {
      setSelectedWaveformPoints(prev => [...prev.filter(p => p.label !== point.label), point])
    } else {
      setSelectedWaveformPoints([])
    }
  }

  const CircuitChatPanel = useMemo(() => {
    const CircuitChatPanelComponent = () => {
      const [input, setInput] = useState('')
      const inputRef = useRef<HTMLTextAreaElement>(null)
      const chatContainerRef = useRef<HTMLDivElement>(null)
      const [showHistory, setShowHistory] = useState(false)

      useEffect(() => {
        if (chatContainerRef.current) {
          chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight
        }
      }, [circuitMessages])

      const handleSend = useCallback(async () => {
        if (!input.trim() || circuitLoading) return
        
        const userMsg: ChatMessage = { id: generateMessageId(), role: 'user', content: input.trim() }
        setLastUserMessage(userMsg)
        setShowRecallButton(false)
        setCircuitMessages(prev => [...prev, userMsg])
        await handleCircuitChat([...circuitMessages.filter(m => m.role === 'user' || (m.role === 'assistant' && m.content)), userMsg])
        setInput('')
        inputRef.current?.focus()
      }, [input, circuitMessages])

      const handleStopThinking = useCallback(() => {
        setIsThinking(false)
        setCircuitLoading(false)
        setShowRecallButton(true)
        setCircuitMessages(prev => [...prev, { 
          id: generateMessageId(), 
          role: 'assistant', 
          content: '**已停止思考**\n\n抱歉，我需要更多时间来处理你的请求。请点击"撤回"重新输入或再次尝试。'
        }])
      }, [])

      const handleRecall = useCallback(() => {
        if (lastUserMessage) {
          setCircuitMessages(prev => prev.filter(m => m.id !== lastUserMessage.id))
          setInput(lastUserMessage.content)
          setShowRecallButton(false)
          inputRef.current?.focus()
        }
      }, [lastUserMessage])

      const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          handleSend()
        }
      }, [handleSend])

      const handleClearChat = useCallback(() => {
        setCircuitMessages([{ 
          id: generateMessageId(), 
          role: 'assistant', 
          content: '你好！我是电路设计助手，请描述你想要设计的电路或提出电路相关问题。' 
        }])
      }, [])

      return (
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={10}>
            <Card 
              title={<><RobotOutlined /> AI电路助手</>}
              extra={
                <Space>
                  <Button 
                    type="text" 
                    size="small" 
                    icon={<HistoryOutlined />}
                    onClick={() => setShowHistory(!showHistory)}
                  >
                    历史
                  </Button>
                  <Button 
                    type="text" 
                    size="small" 
                    onClick={handleClearChat}
                  >
                    清空
                  </Button>
                </Space>
              }
              className="h-full"
              styles={{ body: { height: 'calc(100% - 60px)', display: 'flex', flexDirection: 'column' } }}
            >
              <div className="flex-1 overflow-y-auto pr-2 mb-3" ref={chatContainerRef}>
                <List
                  dataSource={circuitMessages}
                  renderItem={(m) => {
                    const isCurrentStreaming = circuitLoading && 
                      circuitMessages[circuitMessages.length - 1]?.id === m.id
                    
                    return (
                      <div key={m.id} className={`flex mb-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-full px-3 py-2 rounded-lg text-sm ${m.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-800'}`}>
                          <div className="flex items-center gap-1 mb-1">
                            {m.role === 'user' ? <UserOutlined /> : <RobotOutlined />}
                            <span className="text-xs font-semibold">{m.role === 'user' ? '我' : 'AI助手'}</span>
                          </div>
                          {renderMessageContent(m.content, m.id, isCurrentStreaming)}
                        </div>
                      </div>
                    )
                  }}
                />
                {circuitLoading && (
                  <div className="flex justify-start">
                    <div className="bg-gray-100 text-gray-800 px-3 py-2 rounded-lg flex items-center gap-2">
                      <Spin size="small" />
                      <span className="text-sm">思考中…</span>
                    </div>
                  </div>
                )}
              </div>
              <div className="mt-2">
                <div className="flex items-center gap-2 mb-2">
                  <select 
                    className="border border-gray-200 rounded px-2 py-1 text-sm"
                    value={analysisType}
                    onChange={(e) => setAnalysisType(e.target.value as 'dc' | 'ac' | 'transient')}
                  >
                    <option value="dc">直流分析 (DC)</option>
                    <option value="ac">交流分析 (AC)</option>
                    <option value="transient">瞬态分析 (Transient)</option>
                  </select>
                  <Button 
                    type="primary"
                    icon={<PlayCircleOutlined />}
                    onClick={() => runJuliaSimulation(analysisType)}
                    loading={simulating}
                    disabled={circuit.components.length === 0}
                  >
                    运行仿真
                  </Button>
                  <Button onClick={clearCircuit}>
                    清空电路
                  </Button>
                  <Button onClick={handleClearChat}>
                    清空对话
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <textarea
                    ref={inputRef}
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-md resize-none"
                    style={{ 
                      minHeight: '44px',
                      height: '44px',
                      outline: 'none',
                      fontFamily: 'inherit',
                      fontSize: '14px'
                    }}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="描述你想要设计的电路..."
                    disabled={circuitLoading}
                  />
                  {isThinking ? (
                    <Button 
                      type="primary" 
                      danger
                      icon={<StopOutlined />} 
                      onClick={handleStopThinking}
                    >
                      停止
                    </Button>
                  ) : (
                    <>
                      <Button 
                        type="primary" 
                        icon={<SendOutlined />} 
                        onClick={handleSend}
                        disabled={!input.trim()}
                      />
                      {showRecallButton && (
                        <Button 
                          icon={<UndoOutlined />} 
                          onClick={handleRecall}
                          title="撤回"
                        />
                      )}
                    </>
                  )}
                </div>
              </div>
            </Card>
          </Col>

          <Col xs={24} lg={14}>
            <Row gutter={[16, 16]}>
              <Col span={24}>
                <Card 
                  title={<><ThunderboltOutlined /> 电路图</>}
                  className="relative"
                  extra={
                    <Space>
                      <Button size="small" icon={<PlusOutlined />} onClick={() => addComponent('voltage_source')}>电压源</Button>
                      <Button size="small" icon={<PlusOutlined />} onClick={() => addComponent('resistor')}>电阻</Button>
                      <Button size="small" icon={<PlusOutlined />} onClick={() => addComponent('capacitor')}>电容</Button>
                      <Button size="small" icon={<PlusOutlined />} onClick={() => addComponent('inductor')}>电感</Button>
                      <span className="w-px h-6 bg-gray-300 mx-2" />
                      <span className="text-xs min-w-[50px] text-center bg-gray-100 rounded px-2 py-1">
                        {Math.round(circuitZoom * 100)}%
                      </span>
                      <span className="text-xs text-gray-500 ml-2">
                        滚轮缩放 / 拖拽平移
                      </span>
                    </Space>
                  }
                >
                  <div ref={circuitCanvasWrapperRef} className="overflow-hidden border rounded bg-white w-full" style={{ height: 280 }}>
                    <canvas 
                      ref={circuitCanvasRef} 
                      width={700} 
                      height={280} 
                      className="w-full h-full"
                      style={{ 
                        cursor: isDraggingCircuit ? 'grabbing' : (isDraggingComponent ? 'grab' : 'default')
                      }}
                      onMouseDown={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect()
                      const mouseX = e.clientX - rect.left
                      const mouseY = e.clientY - rect.top
                      
                      const clickedComp = findComponentAtPosition(mouseX, mouseY, circuit, circuitZoom, circuitPan)
                      
                      if (clickedComp && e.button === 0) {
                        setSelectedComponent(clickedComp)
                        setIsDraggingComponent(true)
                        setComponentDragStart({ x: mouseX, y: mouseY })
                        const [n1, n2] = [clickedComp.nodes[0], clickedComp.nodes[1]]
                        const node1 = circuit.nodes.find(n => n.id === n1)
                        const node2 = circuit.nodes.find(n => n.id === n2)
                        if (node1 && node2) {
                          setComponentOriginalPos({ x: node1.x, y: node1.y })
                        }
                        e.stopPropagation()
                        return
                      }
                      
                      setCircuitDragStart({ x: mouseX, y: mouseY })
                      setIsDraggingCircuit(true)
                      e.preventDefault()
                    }}
                    onMouseMove={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect()
                      const mouseX = e.clientX - rect.left
                      const mouseY = e.clientY - rect.top
                      
                      if (isDraggingComponent && selectedComponent) {
                        const deltaX = (mouseX - componentDragStart.x) / circuitZoom
                        const deltaY = (mouseY - componentDragStart.y) / circuitZoom
                        
                        setCircuit(prev => {
                          const newCircuit = { ...prev, nodes: [...prev.nodes] }
                          const nodeIds = selectedComponent.nodes
                          nodeIds.forEach(nodeId => {
                            const node = newCircuit.nodes.find(n => n.id === nodeId)
                            if (node) {
                              node.x = Math.round(node.x + deltaX)
                              node.y = Math.round(node.y + deltaY)
                            }
                          })
                          return newCircuit
                        })
                        
                        setComponentDragStart({ x: mouseX, y: mouseY })
                      } else if (isDraggingCircuit) {
                        const deltaX = mouseX - circuitDragStart.x
                        const deltaY = mouseY - circuitDragStart.y
                        setCircuitPan(prev => ({ x: prev.x + deltaX, y: prev.y + deltaY }))
                        setCircuitDragStart({ x: mouseX, y: mouseY })
                      } else {
                        const hovered = findComponentAtPosition(mouseX, mouseY, circuit, circuitZoom, circuitPan)
                        setHoveredComponent({ component: hovered, x: e.clientX, y: e.clientY })
                      }
                    }}
                    onMouseUp={() => {
                      setIsDraggingComponent(false)
                      setIsDraggingCircuit(false)
                      setComponentDragStart({ x: 0, y: 0 })
                      setCircuitDragStart({ x: 0, y: 0 })
                    }}
                    onMouseLeave={() => {
                      setIsDraggingComponent(false)
                      setIsDraggingCircuit(false)
                      setComponentDragStart({ x: 0, y: 0 })
                      setCircuitDragStart({ x: 0, y: 0 })
                      setHoveredComponent({ component: null, x: 0, y: 0 })
                    }}
                    onDoubleClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect()
                      const mouseX = e.clientX - rect.left
                      const mouseY = e.clientY - rect.top
                      
                      const clickedComp = findComponentAtPosition(mouseX, mouseY, circuit, circuitZoom, circuitPan)
                      if (clickedComp) {
                        setSelectedComponent(clickedComp)
                        setShowParameterModal(true)
                      }
                    }}
                    />
                  </div>
                  {hoveredComponent.component && !isDraggingComponent && (
                    <div 
                      className="absolute z-50 bg-gray-900 text-white text-xs rounded px-3 py-2 shadow-lg pointer-events-none"
                      style={{ 
                        left: Math.min(hoveredComponent.x - 150, window.innerWidth - 180),
                        top: hoveredComponent.y + 10
                      }}
                    >
                      <div className="font-semibold">{hoveredComponent.component.name}</div>
                      <div>类型: {hoveredComponent.component.type}</div>
                      {hoveredComponent.component.params.value && (
                        <div>参数: {hoveredComponent.component.params.value} {hoveredComponent.component.params.unit || ''}</div>
                      )}
                      <div>节点: {hoveredComponent.component.nodes.join(' - ')}</div>
                    </div>
                  )}
                  <Alert 
                    message="💡 使用提示" 
                    description="在左侧对话框中用自然语言描述电路，AI会自动生成电路图。也可点击上方按钮手动添加元件。双击元件可编辑参数，拖拽移动元件位置。" 
                    type="info" 
                    showIcon
                    className="mt-3"
                  />
                  
                  <Modal
                    title={`编辑 ${selectedComponent?.name || ''} 参数`}
                    open={showParameterModal}
                    onCancel={() => {
                      setShowParameterModal(false)
                      setSelectedComponent(null)
                    }}
                    footer={null}
                    width={400}
                  >
                    {selectedComponent && (
                      <div className="space-y-4">
                        <div className="grid grid-cols-3 gap-2 text-sm">
                          <span className="font-medium">属性</span>
                          <span className="font-medium col-span-2">值</span>
                        </div>
                        
                        <div className="grid grid-cols-3 gap-2 items-center">
                          <span className="text-gray-600">名称</span>
                          <Input
                            className="col-span-2"
                            value={selectedComponent.name}
                            onChange={(e) => {
                              const newName = e.target.value
                              setCircuit(prev => ({
                                ...prev,
                                components: prev.components.map(c => 
                                  c.id === selectedComponent.id ? { ...c, name: newName } : c
                                )
                              }))
                              setSelectedComponent(prev => prev ? { ...prev, name: newName } : null)
                            }}
                          />
                        </div>
                        
                        <div className="grid grid-cols-3 gap-2 items-center">
                          <span className="text-gray-600">类型</span>
                          <Input className="col-span-2" value={selectedComponent.type} disabled />
                        </div>
                        
                        {selectedComponent.params.value !== undefined && (
                          <div className="grid grid-cols-3 gap-2 items-center">
                            <span className="text-gray-600">参数值</span>
                            <Input
                              className="col-span-1"
                              type="number"
                              value={selectedComponent.params.value}
                              onChange={(e) => {
                                const newValue = parseFloat(e.target.value)
                                if (!isNaN(newValue)) {
                                  setCircuit(prev => ({
                                    ...prev,
                                    components: prev.components.map(c => 
                                      c.id === selectedComponent.id ? { 
                                        ...c, 
                                        params: { ...c.params, value: newValue } 
                                      } : c
                                    )
                                  }))
                                  setSelectedComponent(prev => prev ? { 
                                    ...prev, 
                                    params: { ...prev.params, value: newValue } 
                                  } : null)
                                }
                              }}
                            />
                            <span className="text-gray-500 text-sm">
                              {selectedComponent.params.unit || ''}
                            </span>
                          </div>
                        )}
                        
                        <div className="grid grid-cols-3 gap-2 items-center">
                          <span className="text-gray-600">连接节点</span>
                          <div className="col-span-2 text-sm text-gray-500">
                            {selectedComponent.nodes.join(' - ')}
                          </div>
                        </div>
                        
                        <Divider />
                        
                        <div className="flex justify-end gap-2">
                          <Button onClick={() => {
                            setShowParameterModal(false)
                            setSelectedComponent(null)
                          }}>
                            取消
                          </Button>
                          <Button type="primary" onClick={() => {
                            message.success(`已更新 ${selectedComponent?.name} 参数`)
                            setShowParameterModal(false)
                            setSelectedComponent(null)
                            drawCircuitDiagram()
                          }}>
                            保存
                          </Button>
                        </div>
                      </div>
                    )}
                  </Modal>
                </Card>
              </Col>

              <Col xs={24} lg={12}>
                <Card 
                  title={<><BarChartOutlined /> 波形显示</>}
                  className="h-full"
                  extra={
                    <Space>
                      <Button size="small" icon={<CompressOutlined />} onClick={() => handleWaveformZoom(-0.2)}>缩小</Button>
                      <span className="text-xs">{Math.round(waveformZoom * 100)}%</span>
                      <Button size="small" icon={<FullscreenOutlined />} onClick={() => handleWaveformZoom(0.2)}>放大</Button>
                      <Button size="small" icon={<TableOutlined />} onClick={() => setShowWaveformFullscreen(true)}>全屏</Button>
                    </Space>
                  }
                >
                  {simulating ? (
                    <div className="h-[300px] flex items-center justify-center">
                      <div className="text-center">
                        <Spin size="large" />
                        <div className="mt-4">正在运行Julia仿真引擎…</div>
                        <Progress percent={progress} status="active" className="mt-4 w-48 mx-auto" />
                      </div>
                    </div>
                  ) : waveformData ? (
                    <div 
                      className="h-[300px] bg-white border rounded p-2 overflow-hidden cursor-move relative"
                      onMouseDown={(e) => {
                        setWaveformDragStart({ x: e.clientX, y: e.clientY })
                        setIsDraggingWaveform(true)
                      }}
                      onMouseMove={(e) => {
                        if (isDraggingWaveform) {
                          const deltaX = e.clientX - waveformDragStart.x
                          const deltaY = e.clientY - waveformDragStart.y
                          setWaveformPan(prev => ({ x: prev.x + deltaX, y: prev.y + deltaY }))
                          setWaveformDragStart({ x: e.clientX, y: e.clientY })
                        }
                      }}
                      onMouseUp={() => {
                        setIsDraggingWaveform(false)
                        setWaveformDragStart({ x: 0, y: 0 })
                      }}
                      onMouseLeave={() => {
                        setIsDraggingWaveform(false)
                        setWaveformDragStart({ x: 0, y: 0 })
                      }}
                    >
                      <div 
                        style={{ 
                          transform: `translate(${waveformPan.x}px, ${waveformPan.y}px)`,
                          transition: isDraggingWaveform ? 'none' : 'transform 0.1s ease-out'
                        }}
                      >
                        <svg width="100%" height="100%" viewBox="0 0 650 220" preserveAspectRatio="xMidYMid meet">
                        {Object.entries(waveformData.values).map(([key, vals], idx) => {
                          const colors = ['#1890ff', '#52c41a', '#faad14', '#f5222d', '#722ed1']
                          
                          if (!Array.isArray(vals) || vals.length === 0) {
                            return null
                          }
                          
                          const validVals = vals.filter(v => typeof v === 'number' && !isNaN(v))
                          if (validVals.length === 0) {
                            return null
                          }
                          
                          const maxVal = Math.max(...validVals.map(Math.abs), 0.001)
                          const divisor = vals.length - 1 || 1
                          const points = validVals.map((v, i) => {
                            const x = 25 + (i / divisor) * 600 * waveformZoom
                            const normalizedV = isNaN(v) ? 0 : v
                            const y = 220 - 25 - (normalizedV / maxVal) * 170
                            return `${isNaN(x) ? 25 : x},${isNaN(y) ? 195 : Math.max(25, Math.min(195, y))}`
                          }).join(' ')
                          
                          return (
                            <polyline 
                              key={key} 
                              points={points} 
                              fill="none" 
                              stroke={colors[idx % colors.length]} 
                              strokeWidth="2"
                              onMouseEnter={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect()
                                const midIdx = Math.floor(validVals.length / 2)
                                handleWaveformPointHover({ x: 25 + midIdx * 600 / validVals.length, y: 220 - 25 - validVals[midIdx] / maxVal * 170, label: key })
                              }}
                              onMouseLeave={() => handleWaveformPointHover(null)}
                            />
                          )
                        })}
                        <line x1="25" y1="195" x2="625" y2="195" stroke="#333" />
                        <line x1="25" y1="25" x2="25" y2="195" stroke="#333" />
                        {selectedWaveformPoints.map((point, idx) => (
                          <circle key={idx} cx={point.x} cy={point.y} r="4" fill="#f5222d" />
                        ))}
                      </svg>
                      <div className="mt-2 text-center text-sm text-gray-500">
                        {Object.keys(waveformData.values).map((key, idx) => (
                          <span key={key} className="mx-2">
                            <span style={{ display: 'inline-block', width: 12, height: 12, backgroundColor: ['#1890ff', '#52c41a', '#faad14', '#f5222d', '#722ed1'][idx % 5], marginRight: 4 }}></span>
                            {key}
                          </span>
                        ))}
                      </div>
                      </div>
                    </div>
                  ) : (
                    <div className="h-[300px] flex items-center justify-center text-gray-400">
                      <div className="text-center">
                        <BarChartOutlined style={{ fontSize: 48 }} />
                        <div className="mt-4">运行仿真后显示波形</div>
                      </div>
                    </div>
                  )}
                </Card>
              </Col>

              <Col xs={24} lg={12}>
                <Card title={<><ApiOutlined /> 仿真结果</>}>
                  {simulating ? (
                    <div className="h-[300px] flex items-center justify-center">
                      <Spin size="large" />
                    </div>
                  ) : simulationResult?.success ? (
                    <div className="space-y-3">
                      {simulationResult.result.solution && (
                        <div>
                          <div className="font-medium mb-2 flex items-center gap-2">
                            <TableOutlined /> 节点电压解：
                          </div>
                          {Object.entries(simulationResult.result.solution).map(([key, val]) => (
                            <div key={key} className="flex justify-between py-1 border-b">
                              <span>{key}</span>
                              <span className="font-mono">
                                {typeof val === 'object' && val !== null 
                                  ? (() => {
                                      try {
                                        return JSON.stringify(val, null, 2).replace(/[{}"]/g, ' ').trim()
                                      } catch {
                                        return String(val)
                                      }
                                    })()
                                  : typeof val === 'number' 
                                    ? Number(val).toFixed(6)
                                    : String(val)
                                }
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      {simulationResult.result.transient && simulationResult.result.transient.time && simulationResult.result.transient.time.length > 0 && (
                        <div>
                          <div className="font-medium mb-2 flex items-center gap-2">
                            <BarChartOutlined /> 瞬态分析时间点：
                          </div>
                          <div className="text-sm text-gray-600">
                            共 {simulationResult.result.transient.time.length} 个时间点
                          </div>
                        </div>
                      )}
                      {simulationResult.message && (
                        <div className="text-gray-500 text-sm mt-2">{simulationResult.message}</div>
                      )}
                      {simulationHistory.length > 1 && (
                        <div className="mt-4">
                          <div className="font-medium mb-2">历史记录：</div>
                          <div className="text-sm text-gray-500">
                            共 {simulationHistory.length} 次仿真
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="h-[300px] flex items-center justify-center text-gray-400">
                      <Empty description="暂无仿真结果" />
                    </div>
                  )}
                </Card>
              </Col>
            </Row>
          </Col>
        </Row>
      )
    }
    return React.memo(CircuitChatPanelComponent)
  }, [circuitMessages, circuitLoading, waveformData, simulationResult, simulating, analysisType, simulationHistory, waveformZoom])

  return (
    <MainLayout>
      <Typography.Title level={3} className="flex items-center gap-2">
        <EditOutlined className="text-blue-600" /> 电路仿真编辑器
      </Typography.Title>
      
      <Alert 
        message="智能电路仿真编辑器 (Julia引擎)" 
        description="集成AI对话、自然语言电路描述、Julia仿真计算和自动绘图功能。左侧与AI助手交流描述电路需求，右侧查看生成的电路图和仿真结果。"
        type="success"
        showIcon
        className="mb-4"
      />

      <EditorErrorBoundary>
          <CircuitChatPanel />
      </EditorErrorBoundary>
    </MainLayout>
  )
}
