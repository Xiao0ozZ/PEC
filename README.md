# 产品功能体验中心

> 产品功能体验中心

## 项目说明

本工程是一套 React 项目资料与原型共用外壳。实际项目可以放在本地 `projects/{project-id}`，也可以通过被 Git 忽略的 `project-mounts.local.json` 原地挂载外部项目文件夹。每个项目独立保存自己的配置、客户端入口、HTML 页面、模拟数据、资源、文档和移动端内容，共用首页、路由外壳、公共组件、主题引擎和工程工具。

工程定位为可运行的前端原型，不连接真实后端。页面使用模拟数据呈现业务字段、页面布局、弹窗和主要交互，供产品评审、业务确认、客户演示和前端开发参考。

## 当前范围

- 本仓库只维护共用平台壳子、公共组件、路由、工具、模板和自动化验收能力。
- 实际项目包、业务页面、模拟数据、项目资源和项目文档不随本仓库提交，由各项目单独保存后放入本地 `projects/{project-id}` 使用。
- 本地没有项目包时，首页不显示业务项目入口；加入项目包并重新扫描后，才会出现对应项目和客户端入口。
- 文档中心只读取各项目包 `projects/{project-id}/docs` 下的 Markdown，支持文件夹目录、搜索、Mermaid、相对图片和文档链接。
- 客户端入口：每个客户端可直接进入默认页、先显示平台演示登录页或进入指定页面，并可选择左侧菜单或无侧栏外壳。
- 语言：平台当前只提供简体中文；保留 React i18next 基础设施，但不显示无法实际切换的语言入口。由于当前没有任何组件使用 `useTranslation`，`main.tsx` 不再预加载 `apps/platform-react/src/i18n`，避免把 i18next 打进首屏；真正启用多语言时在 `main.tsx` 顶部加回 `import './i18n';` 即可。只有产品负责人明确提出后才扩展其他语言。
- 界面主题：基于 Ant Design v6 `ConfigProvider`、Design Token 与 CSS Variables；默认主题采用官方 Light 视觉语言和浅蓝布局画布，另提供暗色、玻璃主题；支持跟随系统和独立紧凑密度，用户选择保存在本地浏览器。

## 技术栈

- React 19 + TypeScript + Vite 6
- React Router 7
- Ant Design 6
- TanStack Query
- i18next（当前仅启用简体中文）
- ECharts
- Markdown It + Mermaid + DOMPurify
- Lucide（移动端静态资源已本地化）
- Playwright（路由、交互和视觉回归测试）
- Vitest + Testing Library（React 平台单元测试）

## 目录结构

```text
项目资料原型工程/
├─ apps/platform-react/        React 正式平台应用（默认入口）
├─ packages/project-core/      项目包 Schema、扫描、校验、文档和关联领域核心
├─ packages/platform-client/   框架无关的平台数据访问层
├─ packages/platform-contracts/ 前后端共享的类型与响应归一化契约
├─ packages/platform-server/   独立 Node 本地服务（本机可写、局域网只读）
├─ packages/platform-transfer/ 页面定义、导入、备份、路由与导出编排
├─ plugins/                    项目发现、PRD、导入导出及构建插件
├─ projects/                   本地可插拔项目包目录（已加入 Git 忽略，不提交到本仓库）
├─ examples/                   可提交、脱敏、可运行的项目包样例
├─ scripts/                    项目 CLI、独立服务入口和审计脚本
├─ templates/                  新页面及可迁移 HTML 原型模板
├─ tests/unit/                 领域核心与平台单元测试
├─ tests/e2e/                  React 正式平台浏览器测试（默认）
├─ playwright.config.js        React E2E 配置（默认）
├─ vite.config.js              React 构建配置（默认，产出 dist/）
├─ COMPONENT_GUIDE.md          公共组件、Composables 和新增页面使用规范
├─ ARCHITECTURE.md             工程分层、轻量外壳边界和后续拆分顺序
├─ HTML_PROTOTYPE_CREATION_PROMPT.md 需求阶段可迁移 HTML 原型创建提示词
├─ MIGRATION_GUIDE.md          HTML 原型迁移到本工程的执行规范
├─ PAGE_TRANSFER_GUIDE.md      HTML 原型导入、回导与独立演示包说明
├─ PROJECT_PACKAGE_GUIDE.md    项目包结构、配置、插拔和发布规范
├─ TESTING_GUIDE.md            自动化验收范围、命令和基线更新规则
├─ start-preview-8080.cmd      Windows 双击启动脚本
└─ package.json
```

React 是唯一的平台运行入口：开发、构建、测试和正式本地服务都使用 `apps/platform-react` 与 `vite.config.js`。项目包中的历史 Vue SFC 只作为资料兼容和页面传输的输入，不再作为平台运行入口。

## 项目包配置

共用外壳不硬编码实际项目。每个项目至少包含 `project.json`、`page-definitions.js` 和业务页面；既可直接放在 `projects/{project-id}`，也可在项目包管理页选择外部项目文件夹完成本机挂载。外部挂载不复制、不移动、不改写源项目，取消挂载只移除本机记录。生产环境是构建快照，项目包变化后必须重新构建发布。

新项目从 `templates/project-package` 复制，完整字段和边界见 [PROJECT_PACKAGE_GUIDE.md](./PROJECT_PACKAGE_GUIDE.md)。

工程级命名统一使用 `app-*`、`ui-*`、`theme-*`，不得使用具体项目名称作为 CSS 变量、公共类名、插件名、事件名、包名或资源文件名。

## 本地运行

### Windows 双击启动

双击 `start-preview-8080.cmd`。脚本会：

1. 检查 Node.js。
2. 在缺少 `node_modules` 时自动安装依赖。
3. 使用 `0.0.0.0:8080` 启动 Vite。
4. 自动打开 `http://127.0.0.1:8080`。

同一局域网的其他人员可通过 `http://本机IP:8080` 访问。关闭脚本窗口或按 `Ctrl+C` 可停止服务。

### 命令行启动

```powershell
npm install
npm run dev -- --host 0.0.0.0 --port 8080 --strictPort
```

## 常用命令

```powershell
npm run dev                 # 本机开发预览，默认 127.0.0.1:5188
npm run dev:lan             # 局域网预览，默认 0.0.0.0:5188
npm run serve:local         # 使用独立 Node 本地服务读取已构建的 dist
npm run mcp:serve           # 本地 MCP Server（stdio 只读工具，供 AI 工具接入）
npm run project -- help     # 查看项目包 CLI
npm run project:example     # 将脱敏样例安装到本地 projects/sample-project
npm run project:validate    # 使用共享核心校验项目包
npm run project:health      # 检查项目、HTML 和需求关联健康状态
npm run quality:core        # 只检查可提交的平台底座与样例，不读取 projects 业务源码
npm run quality             # React 类型、Lint、单测、迁移审计和正式构建
npm run build               # 生产构建
npm run audit:projects      # 项目包配置、页面、资源和文档完整性检查
npm run audit:all           # 项目包与 React 迁移边界审计
npm run test:smoke          # React 正式入口浏览器冒烟测试
npm run test:ui             # 同上，执行 React E2E 套件
npm run test:unit           # 公共组件单元测试
```

独立本地服务当前支持“本机可写、局域网只读”：先执行 `npm run build`，再执行 `npm run serve:local -- --host 0.0.0.0 --port 5188`；服务会为构建后的 React 页面注入本地运行标记，页面继续通过 `platform-client` 读取本地文件。本机可以保存平台设置、项目配置、页面级 PRD 关联、组件级 PRD 关联、路由菜单，并执行 HTML 检查、导入和导出；其他局域网设备只能查看项目、原型、PRD、路由和已生成的导出演示文件。页面传输逻辑位于独立 `platform-transfer` 包，Vue/Vite 编译器只在导出必须编译的 Vue 页面时加载；多页面 ZIP 导出继续要求 Windows。

```powershell
npm run serve:local -- --help
npm run serve:local -- --port 6200
npm run serve:local -- --host 0.0.0.0 --port 5188
npm run serve:local -- --read-only
```

正式本地入口会在监听端口前检查构建目录、`dist/index.html`、项目目录和本地挂载配置。全新仓库没有被 Git 跟踪的 `projects/` 时会创建空目录；缺少构建会提示执行 `npm run build`；端口冲突会提示使用 `--port` 更换端口。监听 `0.0.0.0` 时会分别输出本机地址和可用的局域网只读地址，`Ctrl+C` 或 `SIGTERM` 会等待服务正常关闭。

### 一键局域网只读分享

以默认的 `127.0.0.1` 启动后，无需重启服务即可在「控制台」页面用开关开启或关闭局域网只读分享。开启时服务会为每个可用的局域网 IPv4 地址额外建立监听并列出可访问 URL，关闭后这些地址立即不再监听；本机监听始终不受影响，切换过程不会中断正在使用的本机页面。

写权限始终只属于服务主机：局域网设备可以查看项目、原型、PRD、路由和已生成的评审文件，所有写接口（含分享开关本身）都返回 403。若服务以 `--host 0.0.0.0` 启动，则分享状态由启动参数决定，界面开关会提示改用 `--host 127.0.0.1`；`--read-only` 模式下不允许切换分享。

项目包、HTML 和 PRD 的日常维护命令：

```powershell
npm run project -- preflight --file D:\prototypes\page.html
npm run project -- mount --project sample --docs D:\product\docs --prototype admin=D:\product\html
npm run project -- mounts
npm run project -- snapshot --project sample
npm run project -- trace --project sample
npm run project -- build-review --base /prototype/
```

`mount` 和项目包管理页的“挂载项目”只写入被 Git 忽略的 `project-mounts.local.json`，不会改 `project.json`、PRD 或 HTML 原文件。挂载项既可指向完整项目根目录，也可只覆盖 PRD 或某个客户端的 HTML 目录。项目健康检查页会集中列出 Manifest、Schema、路由、HTML、PRD、关联、资源和挂载问题。生产构建会把挂载目录复制为本次发布的只读快照；服务器不能借此直接修改本机源资料。

### 项目包 Schema 升级

`migrate` 不带 `--project` 时扫描全部项目包的 `schemaVersion`，按「已是当前版本 / 可升级 / 版本过高 / 缺少迁移器 / 版本非法 / 不可读」分类列出，版本异常的项目包也会被列出而不是笼统归为“项目不可用”。没有 `schemaVersion` 字段的早期项目包按 0 版处理，可迁移到当前版本。

```powershell
npm run project -- migrate                       # 扫描全部项目包版本
npm run project -- migrate --scan --json         # 输出机器可读结果
npm run project -- migrate --project sample      # 预览差异与备份位置，不写文件
npm run project -- migrate --project sample --write
```

指定 `--project` 时先展示版本区间、逐字段差异和备份位置；**只有加 `--write` 才写回**。写入前会把原 `project.json` 备份到 `<项目根>/.backups/schema/<迁移标识>/`，并记录 `metadata.json`；写入使用原子替换，任一步失败都会回滚 `project.json` 与备份文件，磁盘保持迁移前状态。已是当前版本的项目包重复执行不会二次迁移。

### 独立评审包

`build-review` 生成只读静态评审快照，并在输出目录写入 `review-manifest.json`：其中记录快照时间、`base`、以及本次快照覆盖的项目、客户端、页面（含可跳转路由与来源文件）、PRD 文档和两类关联（页面级 `pageLinks`、组件级 `componentBindings`），同时给出合计范围与被排除的无效项目包。命令结束时会打印同一份范围摘要。

```powershell
npm run project -- build-review --base /review/ --out-dir dist-review
```

评审包只包含静态文件，不需要 Node 或 npm 即可查看，放到任意静态托管（共享目录、IIS、nginx）或用平台自身的局域网只读分享打开即可。生成过程只读取项目资料，不写入 `projects/` 或外置 PRD、原型目录。`--out-dir` 会被解析成绝对路径，保证构建产物与评审清单落在同一目录。

需要注意：平台使用 History 路由，若要让 `/p/<项目>/<客户端>/<页面>` 这类深链直接可访问，静态托管需配置回退到 `index.html`；从评审包首页点击进入不受影响。

## 新增页面

页面、路由和菜单统一维护在对应项目包的 `page-definitions.js`。HTML 页面放在项目包的 `html-pages/{client-id}`，可以通过页面导入工具登记，也可以手动维护页面定义；禁止分别修改平台 Router 和菜单数组。详细规则见 [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md)。

## 入口与路由

- `/`：项目资料与原型首页；默认不选择项目，选择后在当前首页展示该项目入口。
- `/p/{project-id}`：兼容旧链接，跳转回首页并自动选中指定项目。
- `/p/{project-id}/{client-id}`：按客户端配置进入默认页、平台演示登录页或指定入口页。
- `/p/{project-id}/{client-id}/login`：指定项目客户端的可选演示登录页。
- `/p/{project-id}/{client-id}/{page-path}`：指定项目业务页面。
- `/p/{project-id}/mobile`：指定项目移动端流程演示。
- `/p/{project-id}/docs`：指定项目文档中心，可使用 `?file=相对路径.md` 打开文档。
- `/components`：公共组件、设计变量与交互示例页。
- `/tools/page-transfer`：本机 HTML 原型导入与独立页面导出工具；单页直接下载 HTML，多页才生成 ZIP。
- `/tools/projects`：查看有效和无效项目包及校验结果，并管理项目资料与首页项目选择显示状态。
- `/tools/project-health`：集中查看项目配置、Schema、路由、HTML、PRD、关联、资源和挂载问题及修复建议。
- `/tools/project-routes`：管理客户端菜单、页面顺序和页面级 PRD 关联。
- `/tools/ai-context`：检查项目交付上下文、确认关联建议、分析 PRD 变化并导出机器可读上下文包。
- `/tools/console`：内部开发控制台，集中管理工程工具并开启开发模式。

业务页面采用路由按需加载。切换客户端时按目标客户端的进入方式导航；每个客户端可使用左侧菜单、按路由分组的顶部导航、仅保留平台顶栏或沉浸式内容；仅使用平台演示登录页的客户端显示退出登录操作。

## 开发模式与 PRD 对照

开发模式用于 PM、开发人员和内部评审。开启后，已登记 PRD 关联的业务页面会在统一外壳顶栏显示“查看 PRD”，默认以固定分屏方式同时查看原型和 PRD；也可以切换为浮层或新窗口。PRD 面板还可以下载当前页面对应的 HTML 原型源文件，便于开发人员辅助定位；该下载接口仅在本机开发服务中开放。客户演示时保持关闭，不显示开发信息。

页面与 PRD 文件的对应关系保存在项目包 `.platform/page-prd-links.json`，可在“路由菜单管理”的页面列表中直接选择、修改或清除；历史项目中的 `page-prd-links.js` 仍作为兼容读取来源。没有关联 PRD 的页面不会显示入口。开发模式可以在 `/tools/console` 开启，也可以通过业务页面 URL 的 `?__dev=1` 开启当前浏览器会话。

页面来源支持两种 HTML 模式：页面导入会写入项目包的托管 HTML，启用项目的 `prototype` 后也可以按客户端扫描外部 HTML 文件夹并直接运行原 HTML。HTML 页面不再生成平台 Vue 副本；外部 HTML 默认由平台外壳承载并只显示模板内容区，也可按客户端选择保留 HTML 自身的完整外壳。历史 Vue 页面仅在页面传输需要时作为输入兼容。

业务页面开发模式状态保存在工程根目录的 `platform-settings.json`，该文件已加入 `.gitignore`，只作为当前服务实例的本地配置。本机通过 Vite 开发服务保存配置，局域网访问者读取同一份配置，刷新后即可看到 PRD 和源文件入口。静态生产包只能读取构建时写入的 `platform-settings.json` 快照，不能在线修改；需要修改时应更新配置后重新构建发布。首页控制台及首页管理工具仍只保存在当前浏览器的 `sessionStorage`，不写入配置文件；`?__dev=1` 仅作为当前浏览器的临时开发模式覆盖，不会修改共享配置。

## AI 上下文中心

`/tools/ai-context` 将现有项目配置、客户端页面、PRD 文档、页面级关联和组件级关联汇总为统一交付上下文。它是本地确定性分析能力，不调用外部大模型，也不会上传项目资料。

- “项目概览”检查页面缺少 PRD、关联文件失效、组件关联目标失效和文档正文读取失败。
- “页面上下文”可选择任意历史 Vue 或 HTML 页面，复制该页面及其关联需求的 JSON 上下文；业务页面在开发模式下也可从账号菜单直接打开当前页面上下文。
- “关联建议”根据页面标题、路由、源文件名、菜单分组和 PRD 文件信息生成候选，只有本机开发环境中由用户确认后才写入 `.platform/page-prd-links.json`。
- “PRD 影响分析”把当前文档摘要与浏览器本地基线比较，并通过已有页面/组件关联列出潜在影响范围；基线只存入 `localStorage`，不写入 PRD 或项目包。
- “追溯矩阵”按页面汇总页面来源、页面级 PRD、组件级章节关联和待处理问题，并支持导出 JSON。
- “导出上下文包”提供索引 JSON 和包含 PRD 正文的完整 JSON，供 Codex、Claude 或其他工具读取。核心数据结构和分析函数位于 `packages/project-core/src/ai-context.js`，后续本地 MCP Server 可直接复用，不需要重新定义项目模型。

需要把影响分析留给其他电脑或 CI 时，先用 `snapshot` 保存基线，再用 `trace --baseline <文件>` 生成可共享的追溯报告。报告会标出未关联页面、孤立 PRD、失效章节锚点和本次 PRD 变化影响到的页面。

关联建议属于规则匹配结果，不等同于已理解业务语义的模型结论；低、中、高可信度都必须由项目负责人确认。静态生产包支持查看、分析和导出，但不允许修改页面关联。

## 本地 MCP Server

`npm run mcp:serve` 启动本地 MCP（Model Context Protocol）stdio 服务，供 Codex、Claude、ZCode 等工具在不解析仓库文件的情况下取得结构化项目上下文：

- 只读工具：`list_projects`、`get_project_overview`、`get_page_context`、`list_documents`、`list_associations`、`list_health_issues`；不提供任何写工具。
- 仅通过 stdin/stdout 通信，不监听任何网络端口，远程设备无法访问。
- 响应统一脱敏本机绝对路径；全部能力复用 `packages/project-core` 与 CLI 同一数据源，输出结构与界面导出一致。
- 单页上下文也可以不经 MCP 直接用 `npm run project -- context --project <id> --page <client/page> [--output 文件]` 导出 JSON。

客户端配置示例（以支持 MCP 的工具为例）：

```json
{
  "mcpServers": {
    "prototype-platform": {
      "command": "node",
      "args": ["D:/工作文件/项目资料原型工程/scripts/platform-mcp.mjs"]
    }
  }
}
```

## 文档中心机制

- 文档资料源由每个项目包的 `project.json.docs.root` 指定，支持项目包内相对路径，也支持本机可访问的绝对路径；新项目默认使用包内 `docs`。
- 开发环境由 Vite 插件按项目递归扫描；新增、删除或移动 Markdown 后会刷新对应项目目录。
- `npm run build` 会生成 `dist/projects/{project-id}/docs/manifest.json` 和文档内容。
- Markdown 内容经过 DOMPurify 过滤；Mermaid 仅在文档含流程图或时序图时按需加载。
- 生产环境展示的是最近一次构建时的文档快照，PRD 更新后需要重新构建并发布。

## 多语言机制

React 平台保留 i18next 基础设施，但当前只提供简体中文，不显示无法实际切换的语言入口。项目 HTML 原型中的业务模拟数据、姓名、车牌、订单号和业务记录默认不翻译；只有产品负责人明确提出某个页面和目标语言后，才扩展对应的语言资源。

## 组件化底座

- `apps/platform-react/src/features/theme` 统一维护 Ant Design Design Token、项目主题色和主题模式。
- `apps/platform-react/src/ui` 提供平台页面、外壳、表面容器和 Ant Design 组件入口。
- `apps/platform-react/src/features` 按项目、路由、文档、原型和主题拆分可复用领域能力。

详细规则见 [COMPONENT_GUIDE.md](./COMPONENT_GUIDE.md)。

## 页面迁移规则

需求阶段先复制 [templates/html-prototype-page.html](./templates/html-prototype-page.html) 创建可迁移 HTML。模板内已经写明可编辑范围和迁移标记；旧页面可以用于对齐既有视觉与交互，但不能直接复制其外壳、全局样式和启动代码。

页面定案后可通过页面导入工具写入项目包的 `html-pages/{client-id}`，由 React 平台直接承载。HTML 仍是正式页面来源，导出文件可继续回导或交给其他 AI 修改。接入页面必须：

- 只接入页面内容区及其同级弹窗、抽屉，不复制旧侧栏和旧顶栏。
- 保留源页面字段、模拟数据、按钮、表格、弹窗和交互。
- 使用统一 React 外壳、路由和菜单，不复制页面自有的旧外壳。
- 页面专属状态保留在 HTML 内；项目级模拟数据放在项目包的 `data`。
- 页面写入前通过 HTML 模板检查，完成后运行 `npm run audit:migration` 和 `npm run build`。

详细规则见 [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md)。

导入导出工具的完整使用规则见 [PAGE_TRANSFER_GUIDE.md](./PAGE_TRANSFER_GUIDE.md)。

## 代码质量与 CI

```powershell
npm run lint:app      # React 正式平台 ESLint
npm run lint          # 全工程 ESLint；包含平台底座、核心包和本地项目包
npm run format        # Prettier：格式化平台底座、核心包和模板
npm run format:check  # 检查格式，不写文件
npm run audit:all     # 项目包与 React 迁移边界审计
npm run quality:check # Lint、格式、审计和生产构建
npm run ci:check      # React 静态门禁和专用浏览器冒烟测试
```

HTML 原型保持源文件自身格式，React 平台和工程底座执行严格规则。仓库 CI 位于 `.github/workflows/prototype-quality.yml`，提交涉及本工程或 PRD 文档时会自动执行质量检查、构建、组件单元测试和浏览器冒烟测试。

## 自动化验收

- 路由冒烟测试自动扫描全部有效项目包及其 `page-definitions.js`，检查页面可见性、内容区和浏览器运行错误。
- 关键交互覆盖登录、客户端切换、退出、弹窗、抽屉、统计卡片、分页和文档搜索。
- 高频演示页面可建立固定视口的 Chromium 视觉基线。
- 已确认的视觉变更才允许更新 React 浏览器测试基线，不得用更新基线掩盖页面回归。

完整规则见 [TESTING_GUIDE.md](./TESTING_GUIDE.md)。

## 验证状态

- 工程提供 React 路由、菜单、外壳、弹窗和原型承载审计能力。
- 自动化测试覆盖公共组件、项目包扫描、路由冒烟、关键交互和视觉基线。
- 文档中心和移动端演示支持本地资源构建，不依赖外部 CDN。
- 生产构建和质量检查命令已纳入本地脚本及 GitHub Actions。

本工程不包含真实接口、身份认证、权限校验和数据持久化，不能作为生产系统直接部署。

## 版本记录

| 版本    | 日期       | 内容                                                                                                                               |
| ------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| v0.1.0  | 2026-07-10 | 建立 Vue 3 原型工程，统一客户端外壳、路由及页面迁移规范。                                                                          |
| v0.2.0  | 2026-07-11 | 完成基础客户端入口、登录页、路由审计和页面迁移规范。                                                                               |
| v0.3.0  | 2026-07-11 | 增加移动端入口、多语言框架、自适应滚动、路由按需加载和工程审计脚本。                                                               |
| v0.4.0  | 2026-07-11 | 增加 Vue 文档中心、PRD 自动扫描、Markdown 与 Mermaid 渲染及构建时文档发布。                                                        |
| v0.4.1  | 2026-07-11 | 明确新页面默认只开发简体中文，多语言改为按指定页面补充。                                                                           |
| v0.5.0  | 2026-07-11 | 建立 Playwright 路由冒烟、关键交互和视觉截图基线，补充自动化验收规范。                                                             |
| v0.6.0  | 2026-07-12 | 增加样式隔离审计、本地字体与演示图片、ECharts 生命周期治理、404 与全局异常兜底，并扩充自动化基线。                                 |
| v0.7.0  | 2026-07-12 | 建立设计变量、公共组件、Composables、组件规范页及无损迁移试点。                                                                    |
| v0.8.0  | 2026-07-12 | 增加新页面生成器、页面注册单一配置源、ESLint、Prettier 和 GitHub Actions 持续集成。                                                |
| v0.9.0  | 2026-07-12 | 扩充公共组件，升级组件规范页和新页面模板，覆盖列表、详情、反馈与表单结构。                                                         |
| v0.9.1  | 2026-07-13 | 接入 Vitest 组件单元测试，并纳入本地 CI 与 GitHub Actions。                                                                        |
| v0.10.0 | 2026-07-13 | 增加需求阶段可迁移 HTML 创建提示词，明确旧原型仅作视觉参照及 HTML 定案后单向迁移 Vue 的流程。                                      |
| v0.10.1 | 2026-07-13 | 增加可独立预览且可机械提取的 HTML 专用模板，作为后续需求阶段新原型的统一起点。                                                     |
| v0.10.2 | 2026-07-15 | 增加页面导入导出工具：规范 HTML 可导入 Vue 工程，已接入页面可按选择生成独立演示包。                                                |
| v0.10.3 | 2026-07-15 | 修正页面导出口径：单页输出独立 HTML，多页才输出仅含所选 HTML 的 ZIP，并补齐文件菜单跳转。                                          |
| v0.10.4 | 2026-07-15 | 导出演示 HTML 改用 CDN 加载公共依赖，避免把字体、Vue 和组件库整套内嵌造成文件过大。                                                |
| v0.10.5 | 2026-07-15 | 完成首个规范 HTML 导入页面验收，补充来源文件登记并修正导入页面的静态审计兼容性。                                                   |
| v0.10.6 | 2026-07-15 | 精简独立 HTML 导出运行时，移除全量多语言词库；新建订单实测由约 587 KB 降至约 66 KB。                                               |
| v0.10.7 | 2026-07-15 | 明确导出构建使用生产压缩，并压缩最终 HTML 外壳空白，进一步避免单页演示文件被无效格式撑大。                                         |
| v0.11.0 | 2026-07-16 | 改造为共用外壳与可插拔项目包：增加项目发现、动态入口和路由、项目主题与资源、项目级文档、项目化导入导出、空白项目模板和完整性校验。 |
| v0.11.1 | 2026-07-16 | 增加项目包首页显示管理；隐藏项目入口不会删除项目包，重新启用后可恢复首页选择。                                                     |
| v0.12.0 | 2026-07-17 | 增加开发模式 PRD 对照：页面关联 PRD，支持默认固定分屏、浮层、新窗口阅读和下载当前页面 Vue 源文件。                                 |
| v0.12.1 | 2026-07-17 | 将共用平台壳子独立为单独仓库；实际项目包改为本地独立保存，不纳入壳子仓库。                                                         |
| v0.12.2 | 2026-07-17 | 将开发模式改为共享平台配置，局域网访问者可读取同一份开发模式状态。                                                                 |
| v0.12.3 | 2026-07-17 | 将首页管理入口恢复为浏览器本地开关，与共享开发模式完全分离。                                                                       |
