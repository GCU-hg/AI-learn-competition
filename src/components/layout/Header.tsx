import { Layout, Menu, Button, Tag } from 'antd'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAppSelector } from '@store/hooks'
import { useAppDispatch } from '@store/hooks'
import { logout } from '@store/index'

export default function Header() {
  const location = useLocation()
  const selected = location.pathname.split('/')[1] || 'home'
  const navigate = useNavigate()
  const user = useAppSelector(s => s.user.user)
  const dispatch = useAppDispatch()
  const onClick = (e: any) => {
    const map: Record<string, string> = {
      home: '/',
      education: '/education/projects',
      learning: '/education/learning-path',
      editor: '/editor',
      community: '/community/explore',
      graph: '/knowledge/graph',
      training: '/training/fault-debug',
      account: '/account/profile'
    }
    const to = map[e.key]
    if (to) navigate(to)
  }
  return (
    <Layout.Header className="flex items-center justify-between">
      <div className="flex items-center">
        <div className="text-white font-semibold mr-6">Simulink 教育平台</div>
        <Menu theme="dark" mode="horizontal" selectedKeys={[selected]} onClick={onClick} items={(() => {
          const items = [
            { key: 'home', label: <Link to="/">首页</Link> },
            { key: 'education', label: <Link to="/education/projects">教育</Link> },
            { key: 'learning', label: <Link to="/education/learning-path">学习路径</Link> },
            { key: 'editor', label: <Link to="/editor">编辑器</Link> },
            { key: 'community', label: <Link to="/community/explore">社区</Link> },
            { key: 'questions', label: <Link to="/community/questions">问答</Link> },
            { key: 'graph', label: <Link to="/knowledge/graph">知识图谱</Link> },
            { key: 'training', label: <Link to="/training/fault-debug">故障训练</Link> },
            { key: 'account', label: <Link to="/account/profile">我的</Link> }
          ]
          if (user?.role === 'admin') {
            items.push({ key: 'admin', label: <Link to="/admin">管理</Link> })
          }
          return items
        })()} />
      </div>
      <div className="flex items-center gap-3">
        {user && <Tag color={user.role === 'admin' ? 'red' : 'blue'}>{user.username}</Tag>}
        {user ? (
          <Button type="default" onClick={() => { dispatch(logout()); navigate('/auth/login') }}>退出</Button>
        ) : (
          <>
            <Link to="/auth/login"><Button type="text" className="text-white">登录</Button></Link>
            <Link to="/auth/register"><Button type="primary">注册</Button></Link>
          </>
        )}
      </div>
    </Layout.Header>
  )
}
