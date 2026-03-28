import React, { Component, ErrorInfo, ReactNode } from 'react'
import { Result, Button } from 'antd'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class EditorErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('编辑器发生错误:', error)
    console.error('错误详情:', errorInfo)
  }

  private handleReload = (): void => {
    window.location.reload()
  }

  private handleGoBack = (): void => {
    window.history.back()
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <Result
          status="error"
          title="编辑器发生错误"
          subTitle="很抱歉，编辑器遇到了意外问题。请尝试刷新页面或返回首页。"
          extra={[
            <Button type="primary" key="reload" onClick={this.handleReload}>
              刷新页面
            </Button>,
            <Button key="back" onClick={this.handleGoBack}>
              返回首页
            </Button>
          ]}
        />
      )
    }

    return this.props.children
  }
}

export function withEditorErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  fallback?: ReactNode
): React.FC<P> {
  return function WrappedComponent(props: P) {
    return (
      <EditorErrorBoundary fallback={fallback}>
        <Component {...props} />
      </EditorErrorBoundary>
    )
  }
}
