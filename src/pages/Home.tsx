import { Typography, Button, Row, Col, Card } from 'antd'
import MainLayout from '@components/layout/MainLayout'
import { Link } from 'react-router-dom'

export default function Home() {
  return (
    <MainLayout>
      {/* Hero */}
      <div className="text-center py-16 bg-gradient-to-b from-blue-50 to-white rounded-xl">
        <Typography.Title level={1} className="text-blue-700">
          欢迎来到 Simulink 交互式教育与AI助手平台
        </Typography.Title>
        <Typography.Paragraph className="text-lg text-gray-600 max-w-3xl mx-auto">
          从学习到实践的完整闭环，提供项目沙盒与智能建模助手，助力中国工程师快速成长。
        </Typography.Paragraph>
        <div className="mt-6 flex gap-4 justify-center">
          <Link to="/education/projects">
            <Button type="primary" size="large">开始学习</Button>
          </Link>
          <Link to="/ai-assistant/chat">
            <Button size="large">向AI提问</Button>
          </Link>
        </div>
      </div>

      {/* 特色卡片 */}
      <Row gutter={[24, 24]} className="mt-12">
        <Col xs={24} md={8}>
          <Card hoverable>
            <Typography.Title level={3} className="text-blue-700">交互式项目沙盒</Typography.Title>
            <p className="text-gray-600">基于真实工业案例的“填空式”实战环境，即时闭环反馈。</p>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card hoverable>
            <Typography.Title level={3} className="text-purple-700">AI建模助手</Typography.Title>
            <p className="text-gray-600">自然语言生成模型，闭环验证与修正，确保结果可靠。</p>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card hoverable>
            <Typography.Title level={3} className="text-teal-700">知识图谱导航</Typography.Title>
            <p className="text-gray-600">可视化网络图，系统化探索概念与模块关联。</p>
          </Card>
        </Col>
      </Row>
    </MainLayout>
  )
}
