# 产品功能体验中心

这是一个基于 React、Ant Design 和 Vite 的本地项目资料与原型平台。它提供共用的首页、项目入口、顶栏、侧栏、主题、文档中心、路由菜单和 HTML 页面承载能力，供产品评审、业务演示和前端开发协作使用。

平台不连接真实业务后端。项目包中的页面、模拟数据、资源和 PRD 可以放在本地 `projects/{project-id}`，也可以通过被 Git 忽略的 `project-mounts.local.json` 挂载外部目录。

## 当前范围

- 平台应用：`apps/platform-react`，React 是唯一的平台运行入口。
- 页面来源：项目包内托管 HTML 和外部目录扫描得到的 HTML。
- 项目资料：Manifest、客户端、菜单、HTML、Markdown、资源、模拟数据和移动端演示。
- 主题体系：Ant Design v6 `ConfigProvider`、Design Token 和 `--app-*` 语义变量。
- 文档中心：按 Markdown 所在文件夹分类，支持搜索、Mermaid、相对图片和文档链接。
- 开发模式：页面级 PRD、组件级关联、健康检查、路由菜单管理和 AI 上下文。
- 本地服务：本机写入，局域网只读；Windows 启动脚本同时提供 5188 和 8080 两个 React 服务。

业务页面直接维护原生 HTML；后续若转成 React 页面，应按独立的 React 页面任务实现。

## 技术栈

- React 19 + TypeScript + Vite 6
- React Router 7
- Ant Design 6 + `@ant-design/icons`
- TanStack Query
- ECharts
- Markdown It + Mermaid + DOMPurify
- Vitest + Testing Library
- Playwright

## 目录结构

```text
项目资料原型工程/
├─ apps/platform-react/          React 正式平台应用
├─ packages/project-core/        项目包、HTML、文档、路由和关联领域核心
├─ packages/platform-client/     浏览器数据访问层
├─ packages/platform-contracts/  前后端共享契约
├─ packages/platform-server/     独立 Node 本地服务
├─ packages/platform-mcp/        本地 MCP 只读服务
├─ plugins/                      Vite 开发、构建和接口适配
├─ projects/                     本地项目包目录（Git 忽略）
├─ examples/                     脱敏、可提交的项目包样例
├─ scripts/                      CLI、服务和校验入口
├─ templates/                    项目包和 HTML 页面模板
├─ tests/                        单元与浏览器测试
├─ docs/                         架构、组件、测试和维护文档
├─ 启动React开发环境.cmd         Windows 双端启动脚本
├─ vite.config.js                React 构建配置
└─ package.json
```

常用文档：

- [架构说明](./docs/架构说明.md)
- [项目包指南](./docs/项目包指南.md)
- [组件规范](./docs/组件规范.md)
- [HTML 原型创建提示词](./docs/HTML原型创建提示词.md)
- [测试指南](./docs/测试指南.md)
- [安全指南](./docs/安全指南.md)
- [贡献指南](./docs/贡献指南.md)

## 本地运行

### Windows 双击启动

双击 [启动React开发环境.cmd](./启动React开发环境.cmd)。脚本会检查 Node.js，在缺少依赖时执行安装，然后同时启动：

- `http://127.0.0.1:5188`：本机 React 开发服务；
- `http://本机IP:8080`：局域网访问服务。

脚本会打开两个独立的命令窗口。关闭对应窗口或在窗口内按 `Ctrl+C` 可以停止服务。

### 命令行启动

```powershell
npm install
npm run dev
```

常用命令：

```powershell
npm run dev                 # 本机开发，127.0.0.1:5188
npm run dev:lan             # 局域网开发，0.0.0.0:5188
npm run serve:local         # 读取已构建 dist 的独立 Node 服务
npm run project -- help     # 查看项目包 CLI
npm run project:example     # 安装脱敏样例
npm run audit:projects      # 校验项目包、页面、资源和文档
npm run project:health      # 查看项目健康状态
npm run build               # 生产构建
npm run test:unit           # 单元测试
npm run test:smoke          # 浏览器冒烟测试
```

正式本地服务：

```powershell
npm run build
npm run serve:local -- --host 0.0.0.0 --port 5188
```

服务启动前会检查构建目录、项目目录和本地挂载配置。监听 `0.0.0.0` 时，远程访问仍然是只读；本机才拥有配置、关联和路由菜单写权限。

## 项目包

项目包至少包含：

```text
projects/{project-id}/
├─ project.json
├─ page-definitions.js
├─ html-pages/{client-id}/
├─ docs/
├─ assets/
├─ data/
├─ prototype/
└─ mobile/
```

新项目可以复制 `templates/project-package`，再执行：

```powershell
npm run project -- init --id sample-project --name "示例项目"
npm run audit:projects
```

`page-definitions.js` 只登记 HTML 页面：

```js
export const clientPageDefinitions = {
  admin: {
    sections: [{ id: 'workspace', title: '工作区' }],
    pages: [
      {
        path: 'home',
        name: 'admin-home',
        title: '首页',
        sourceType: 'html-template',
        source: 'home.html',
        section: 'workspace',
        icon: 'House',
      },
    ],
  },
};
```

页面路由为 `/p/{project-id}/{client-id}/{page-path}`。托管 HTML 放在 `html-pages/{client-id}`；外部 HTML 在 `project.json.prototype` 中配置目录后由平台递归扫描。完整字段和挂载规则见[项目包指南](./docs/项目包指南.md)。

## HTML 原型

复制 [templates/html-prototype-page.html](./templates/html-prototype-page.html) 创建原生 HTML 页面。模板可以直接双击打开，也可以由 React 外壳承载。

模板必须保留：

- 一个 `data-page-content` 和一个 `data-business-content` 内容根；
- `prototype-page-manifest` 页面 Manifest；
- `PAGE_CONTENT`、`PAGE_OVERLAYS`、`PAGE_LOGIC` 编辑边界；
- `--app-*` 主题变量和主题桥接逻辑。

模板不引入外部框架、组件库、CDN、外部字体或外部图片。页面业务状态和事件绑定使用原生浏览器 API，平台负责统一主题、外壳、路由、滚动和 PRD 对照。

单页检查：

```powershell
npm run project -- preflight --file D:\prototypes\page.html
```

## 文档中心

每个项目的 `project.json.docs.root` 指定文档根目录。文档中心递归扫描 Markdown，并按照文件夹生成左侧分类，只显示文件名；文档正文、相对图片和 Mermaid 图表保持来自源目录。

根目录可以是项目包内相对路径，也可以是本机绝对路径。外部文档只读；生产构建会生成 `dist/projects/{project-id}/docs` 的只读快照。

## 主要路由

- `/`：项目资料首页，默认不选择项目；
- `/p/{project-id}/{client-id}`：进入客户端配置的默认页面或登录页；
- `/p/{project-id}/{client-id}/{page-path}`：业务 HTML 页面；
- `/p/{project-id}/mobile`：移动端静态演示；
- `/p/{project-id}/docs`：项目文档中心；
- `/components`：公共组件和设计变量示例；
- `/tools/projects`：项目包管理；
- `/tools/project-routes`：路由菜单管理；
- `/tools/project-health`：项目健康检查；
- `/tools/ai-context`：AI 交付上下文；
- `/tools/console`：开发控制台。

## 设计与代码规范

- React 公共组件从 `apps/platform-react/src/ui` 使用，页面颜色、圆角、阴影、字号和控件尺寸优先使用 Ant Design token。
- HTML 原型使用 `--app-*` 语义变量，不复制平台顶栏、侧栏和全局样式。
- 项目业务字段、模拟数据、资源和 PRD 留在项目包，不写入平台公共壳。
- 新的跨项目能力先沉淀到 `packages/project-core` 或平台公共组件，再由页面调用。

## 质量检查

```powershell
npm run typecheck
npm run lint
npm run test:unit
npm run audit:projects
npm run build
npm run test:smoke
git diff --check
```

静态检查、测试和构建分别证明对应层级的正确性，不能替代真实浏览器验收或真实接口验收。工程不包含真实身份认证、权限服务、数据库和生产业务接口，不能直接作为生产系统部署。
