import { Layout } from 'antd'
import Header from './Header'
import { PropsWithChildren } from 'react'

export default function MainLayout({ children }: PropsWithChildren) {
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header />
      <Layout.Content className="p-6 bg-gray-50">{children}</Layout.Content>
    </Layout>
  )
}
