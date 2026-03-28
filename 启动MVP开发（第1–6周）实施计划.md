## 目标

* 依据《开发计划.md》推进 S1–S4 的前四个里程碑：工程化与骨架、认证授权、项目沙盒（列表/详情/简化工作区）、RAG 问答与流式响应。

* 输出可运行的前端项目与占位后端契约，形成可预览的导航与页面结构，支撑高校试点的演示。

## 技术选型

* 前端：React 18 + Vite + TypeScript

* UI：Ant Design（可替换为 shadcn/ui，优先 AntD 以加速）

* 状态：Redux Toolkit（全局）+ TanStack Query（服务器状态）

* 样式：Tailwind CSS + CSS Modules

* 网络：axios；SSE 或 WebSocket（优先 SSE）

* 质量：ESLint + Prettier

## 项目初始化

1. 初始化项目配置：`package.json`、`tsconfig.json`、`vite.config.ts`、`.eslintrc.cjs`、`.prettierrc`、`tailwind.config.cjs`、`postcss.config.cjs`
2. 全局入口与样式：`src/main.tsx`、`src/App.tsx`、`src/styles/index.css`（引入 Tailwind）
3. 目录结构：

   * `src/components/{common,layout,business}`

   * `src/pages/{home,auth,dashboard,education,ai,community,account}`

   * `src/features/{education,ai-assistant,community,account}`

   * `src/services`（axios 实例、API 占位）

   * `src/store`（Redux Toolkit）

   * `src/routes`（路由定义）

   * `src/types`、`src/utils`、`src/config`

## 路由与页面骨架（v0.1）

* 根路由与布局：`/` 首页（营销占位）、顶部导航、侧栏布局（Dashboard 内）

* 认证：`/auth/login`、`/auth/register`、`/auth/reset-password`

* 控制台：`/dashboard`

* 教育模块：

  * `/education/projects`（列表：筛选、搜索、卡片网格）

  * `/education/projects/:projectId`（详情：目标、前置、开始项目）

  * `/education/projects/:projectId/workspace`（简化工作区：三栏布局占位）

  * `/education/projects/:projectId/results`（结果页占位）

* AI 模块：`/ai-assistant/chat`（对话界面占位）

* 个人中心：`/account/{profile,learning-stats,my-projects,subscriptions,settings}`（占位页）

## 认证与授权（v0.1→v0.2）

* 表单页：登录、注册、重置密码（前端校验）

* JWT 管理：localStorage + 安全刷新策略占位

* axios 拦截器：`Authorization` 头、401/403 处理

* 路由守卫：受限页面访问控制；角色占位（RBAC）

## 项目沙盒（v0.2）

* 列表页：筛选项（难度、行业、类型）、搜索框、分页或无限滚动占位

* 详情页：学习目标、前置知识、开始项目按钮、社区讨论占位

* 工作区（简化）：

  * 三栏布局（任务清单 | 画布占位 | AI 助手侧栏）

  * 工具栏（保存、运行仿真、重置、帮助、返回）

  * 底部状态栏（仿真状态、错误提示）

* 结果页：通过/失败、评分、AI建议、参考答案占位、报告下载占位

## AI 智能问答（RAG，占位）（v0.2）

* 对话界面：多轮消息列表、Markdown 渲染、代码高亮、附件按钮占位（`.slx`）

* 流式响应：SSE 客户端封装；打字机效果；中断与错误提示

* 来源可追溯：答案卡片中保留“来源”字段（占位）

## 状态管理与服务

* Store：`userSlice`（登录态/角色/订阅）、`uiSlice`（主题/加载状态）

* Query：项目列表/详情的查询 hooks；提交与仿真运行的 mutation 占位

* Service：`api.ts`（axios 实例）、`auth.api.ts`、`projects.api.ts`、`ai.api.ts`（接口契约占位）

## 验收与预览

* 启动开发服务器并提供预览链接（本地）

* 演示路径：登录→Dashboard→教育项目列表→项目详情→工作区占位→AI 对话占位

* 基础单元测试占位（可选）：路由可达性、组件渲染、状态切换

## 文件与代码生成（概览）

* 新增：工程配置文件、入口与路由、页面与布局组件、store 与 services、样式与 UI 组件

* 保持：已有文档（PRD、开发文档与开发计划）原样保留

## 风险与应对（首月）

* 云仿真暂未接入：以占位 API +模拟日志替代，后续接入 MATLAB 引擎

* SSE 兼容：提供回退（轮询）占位

* UI 库选择：AntD 为主，后续根据需求替换或混用

## 阶段性交付

* v0.1（第4周）：路由骨架、认证、项目列表/详情、RAG占位

* v0.2（第6周）：简化工作区、AI导师（规则）、结果页基础

* v0.3（第8周）：试点包、3–5个案例闭环、个人中心基础

## 需要你的确认

* 是否按上述技术栈与结构初始化并生成前端工程骨架，随后提供本地预览链接与首批页面占位？

