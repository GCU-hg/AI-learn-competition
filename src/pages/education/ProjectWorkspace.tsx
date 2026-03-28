import { useEffect, useState } from 'react'
import { Typography, Button, Card, List, Checkbox, Progress, Tag, Space, Tooltip } from 'antd'
import { PlayCircleOutlined, SaveOutlined, ReloadOutlined, QuestionCircleOutlined, CheckCircleOutlined, ClockCircleOutlined } from '@ant-design/icons'
import { useParams } from 'react-router-dom'
import MainLayout from '@components/layout/MainLayout'

interface Task {
  id: string
  title: string
  description: string
  completed: boolean
  estimatedTime: number
  difficulty: 'easy' | 'medium' | 'hard'
}

export default function ProjectWorkspace() {
  const { projectId } = useParams()
  const storageKey = `workspace:${projectId}`
  const [tasks, setTasks] = useState<Task[]>([
    {
      id: '1',
      title: '创建系统模型',
      description: '使用Simulink创建基本的控制系统模型',
      completed: true,
      estimatedTime: 15,
      difficulty: 'easy'
    },
    {
      id: '2',
      title: '添加传感器组件',
      description: '为系统添加温度传感器和反馈回路',
      completed: false,
      estimatedTime: 20,
      difficulty: 'medium'
    },
    {
      id: '3',
      title: '配置仿真参数',
      description: '设置仿真时间、步长和求解器类型',
      completed: false,
      estimatedTime: 10,
      difficulty: 'easy'
    },
    {
      id: '4',
      title: '运行仿真分析',
      description: '执行仿真并分析系统响应',
      completed: false,
      estimatedTime: 25,
      difficulty: 'hard'
    }
  ])

  const [simulationStatus, setSimulationStatus] = useState<'idle' | 'running' | 'completed' | 'error'>('idle')
  const [simulationProgress, setSimulationProgress] = useState(0)
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true)
  const [hints, setHints] = useState<string[]>([])
  const addTaskFromHint = () => {
    const label = '检查仿真结果并调优参数'
    setTasks(prev => {
      if (prev.some(t => t.title === label)) return prev
      return [...prev, { id: String(prev.length + 1), title: label, description: '依据响应曲线调整PID等参数', completed: false, estimatedTime: 20, difficulty: 'medium' }]
    })
  }

  useEffect(() => {
    try {
      const s = localStorage.getItem('settings')
      if (s) {
        const obj = JSON.parse(s)
        if (typeof obj.autoSave === 'boolean') setAutoSaveEnabled(obj.autoSave)
      }
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        const data = JSON.parse(saved)
        if (Array.isArray(data.tasks)) setTasks(data.tasks)
        if (data.simulationStatus) setSimulationStatus(data.simulationStatus)
        if (typeof data.simulationProgress === 'number') setSimulationProgress(data.simulationProgress)
      }
    } catch {}
  }, [storageKey])

  useEffect(() => {
    if (!autoSaveEnabled) return
    try {
      localStorage.setItem(storageKey, JSON.stringify({ tasks, simulationStatus, simulationProgress, savedAt: Date.now() }))
    } catch {}
  }, [tasks, simulationStatus, simulationProgress, autoSaveEnabled, storageKey])

  useEffect(() => {
    const hs: string[] = []
    const done = tasks.filter(t => t.completed).map(t => t.id)
    if (!done.includes('3')) {
      hs.push('请检查并配置仿真参数（时间、步长、求解器）')
    }
    if (!done.includes('2')) {
      hs.push('添加必要的传感器组件并连接反馈回路')
    }
    if (simulationStatus === 'idle') {
      hs.push('完成基本任务后可运行仿真观察系统响应')
    }
    if (simulationStatus === 'completed') {
      hs.push('查看结果页并分析响应曲线与性能指标')
    }
    setHints(hs)
  }, [tasks, simulationStatus])

  const toggleTask = (taskId: string) => {
    setTasks(prev => prev.map(task => 
      task.id === taskId ? { ...task, completed: !task.completed } : task
    ))
  }

  const completedTasks = tasks.filter(task => task.completed).length
  const totalTasks = tasks.length
  const progressPercentage = (completedTasks / totalTasks) * 100

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty) {
      case 'easy': return 'green'
      case 'medium': return 'orange'
      case 'hard': return 'red'
      default: return 'default'
    }
  }

  const runSimulation = async () => {
    setSimulationStatus('running')
    setSimulationProgress(0)
    
      const interval = setInterval(() => {
      setSimulationProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval)
          setSimulationStatus('completed')
          try {
            const resultKey = `results:${projectId}`
            const completedTasksCount = tasks.filter(t => t.completed).length
            const accuracy = Math.round((completedTasksCount / tasks.length) * 100)
            localStorage.setItem(resultKey, JSON.stringify({
              completedAt: new Date().toISOString(),
              completedTasks: completedTasksCount,
              totalTasks: tasks.length,
              accuracy,
              simulationStatus: 'completed'
            }))
          } catch {}
          return 100
        }
        return prev + 10
      })
    }, 500)
  }

  const resetWorkspace = () => {
    setTasks(prev => prev.map(task => ({ ...task, completed: false })))
    setSimulationStatus('idle')
    setSimulationProgress(0)
    try {
      localStorage.removeItem(`results:${projectId}`)
      localStorage.setItem(storageKey, JSON.stringify({ tasks, simulationStatus: 'idle', simulationProgress: 0, savedAt: Date.now() }))
    } catch {}
  }

  return (
    <MainLayout>
      <div className="flex justify-between items-center mb-6">
        <div>
          <Typography.Title level={3}>项目工作区 #{projectId}</Typography.Title>
          <Typography.Text type="secondary">温度控制系统仿真项目</Typography.Text>
        </div>
        <Space>
          <Button icon={<SaveOutlined />} onClick={() => {
            try {
              localStorage.setItem(storageKey, JSON.stringify({ tasks, simulationStatus, simulationProgress, savedAt: Date.now() }))
            } catch {}
          }}>保存进度</Button>
          <Button 
            type="primary" 
            icon={<PlayCircleOutlined />}
            onClick={runSimulation}
            loading={simulationStatus === 'running'}
          >
            运行仿真
          </Button>
          <Button icon={<ReloadOutlined />} onClick={resetWorkspace}>重置</Button>
          <Tooltip title="获取帮助">
            <Button icon={<QuestionCircleOutlined />} />
          </Tooltip>
        </Space>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        <Card 
          title={
            <div className="flex justify-between items-center">
              <span>任务清单</span>
              <Tag color="blue">{completedTasks}/{totalTasks}</Tag>
            </div>
          }
          className="h-[600px]"
        >
          <Progress percent={progressPercentage} size="small" className="mb-4" />
          <List
            dataSource={tasks}
            renderItem={task => (
              <List.Item className="px-0">
                <div className="flex items-start gap-3 w-full">
                  <Checkbox 
                    checked={task.completed}
                    onChange={() => toggleTask(task.id)}
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Typography.Text 
                        strong 
                        className={task.completed ? 'line-through text-gray-400' : ''}
                      >
                        {task.title}
                      </Typography.Text>
                      <Tag color={getDifficultyColor(task.difficulty)}>
                        {task.difficulty}
                      </Tag>
                    </div>
                    <Typography.Text type="secondary" className="text-sm">
                      {task.description}
                    </Typography.Text>
                    <div className="flex items-center gap-2 mt-1">
                      <ClockCircleOutlined className="text-xs text-gray-400" />
                      <Typography.Text type="secondary" className="text-xs">
                        预计 {task.estimatedTime} 分钟
                      </Typography.Text>
                    </div>
                  </div>
                  {task.completed && <CheckCircleOutlined className="text-green-500" />}
                </div>
              </List.Item>
            )}
          />
        </Card>

        
        <Card 
          title="模型画布" 
          className="h-[600px]"
          bodyStyle={{ padding: 0, height: 'calc(100% - 56px)' }}
        >
          <div className="h-full bg-gray-50 flex items-center justify-center relative">
            <div className="text-center">
              <div className="w-32 h-32 bg-blue-100 rounded-lg mx-auto mb-4 flex items-center justify-center">
                <PlayCircleOutlined className="text-4xl text-blue-500" />
              </div>
              <Typography.Text type="secondary">Simulink 模型画布</Typography.Text>
              <div className="mt-2 text-xs text-gray-400">
                拖拽组件到此处开始建模
              </div>
            </div>
            
            
            {simulationStatus === 'running' && (
              <div className="absolute inset-0 bg-blue-500 bg-opacity-10 flex items-center justify-center">
                <div className="bg-white rounded-lg p-6 shadow-lg">
                  <Progress 
                    type="circle" 
                    percent={simulationProgress} 
                    size={80}
                    status={simulationStatus === 'running' ? 'active' : 'success'}
                  />
                  <Typography.Text className="block text-center mt-3">
                    仿真运行中... {simulationProgress}%
                  </Typography.Text>
                </div>
              </div>
            )}
          </div>
        </Card>

        
        <Card title="AI助手" className="h-[600px]">
          <div className="h-full flex flex-col">
            <div className="flex-1 bg-gray-50 rounded-lg p-4 mb-4">
              <div className="space-y-3">
                <div className="bg-white rounded-lg p-3">
                  <Typography.Text className="text-sm">
                    欢迎使用AI助手！我可以帮助您：
                  </Typography.Text>
                </div>
                {hints.length > 0 && (
                  <div className="bg-yellow-50 rounded-lg p-3">
                    <Typography.Text className="text-sm text-yellow-700">
                      AI导师建议：
                    </Typography.Text>
                    <ul className="list-disc pl-5 mt-2">
                      {hints.map((h, i) => (
                        <li key={i} className="text-sm text-yellow-800">{h}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="bg-blue-50 rounded-lg p-3">
                  <Typography.Text className="text-sm text-blue-700">
                    • 解释仿真概念和原理
                  </Typography.Text>
                </div>
                <div className="bg-green-50 rounded-lg p-3">
                  <Typography.Text className="text-sm text-green-700">
                    • 指导模型构建步骤
                  </Typography.Text>
                </div>
                <div className="bg-orange-50 rounded-lg p-3">
                  <Typography.Text className="text-sm text-orange-700">
                    • 分析仿真结果
                  </Typography.Text>
                </div>
              </div>
            </div>
            
            <div className="space-y-2">
              <Button block size="small">💡 获取建模建议</Button>
              <Button block size="small">🔧 组件使用指南</Button>
              <Button block size="small">📊 结果分析帮助</Button>
              <Button block size="small" type="primary">💬 开始对话</Button>
              <Button block size="small" onClick={addTaskFromHint}>➕ 应用建议到任务</Button>
            </div>
          </div>
        </Card>
      </div>

      
      <Card className="mt-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Typography.Text type="secondary">仿真状态:</Typography.Text>
            {simulationStatus === 'idle' && <Tag>待运行</Tag>}
            {simulationStatus === 'running' && <Tag color="blue">运行中</Tag>}
            {simulationStatus === 'completed' && <Tag color="green">已完成</Tag>}
            {simulationStatus === 'error' && <Tag color="red">错误</Tag>}
          </div>
          
          <div className="flex items-center gap-2">
            <Typography.Text type="secondary" className="text-sm">
              自动保存: {autoSaveEnabled ? '已启用' : '已关闭'}
            </Typography.Text>
            <Typography.Text type="secondary" className="text-sm">
              •
            </Typography.Text>
            <Typography.Text type="secondary" className="text-sm">
              完成任务 {completedTasks}/{totalTasks}
            </Typography.Text>
          </div>
        </div>
      </Card>
    </MainLayout>
  )
}
