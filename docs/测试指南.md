# 项目资料原型工程自动化验收说明

## 1. 目标

自动化验收用于防止页面迁移、公共样式、组件化和批量修改造成以下回归：

- 路由打开后白屏或内容区为空。
- React 运行错误、HTML iframe 错误或浏览器控制台脚本错误。
- 主按钮文字、边框、卡片和布局异常。
- 登录、客户端切换、退出登录、弹窗、抽屉和分页失效。
- 文档中心无法读取 Markdown 或搜索目录。

测试不连接真实后端，使用工程现有模拟数据。

## 2. 测试环境

- Playwright Chromium
- 视口：`1440 × 900`
- 语言：简体中文
- 时区：`Asia/Shanghai`
- 固定时间：`2026-07-11 10:00`
- React 专用测试服务器：`http://127.0.0.1:4174`

运行测试时不需要提前启动 Vite，Playwright 会自动启动和关闭独立测试服务器。

首次安装后如缺少浏览器，执行：

```powershell
npx playwright install chromium
```

## 3. 常用命令

```powershell
npm run test:smoke          # React 正式入口浏览器冒烟测试
npm run test:ui             # 同上，执行 React E2E 套件
npm run test:unit           # 公共组件 Props、Slots、事件和交互状态单元测试
npm run test                # React 平台组件与纯逻辑测试
npm run test:e2e            # React 正式入口浏览器冒烟测试
npm run test:unit:watch     # 开发时持续运行组件单元测试
npm run project -- preflight --file <html> # HTML 独立交付与导入预检
npm run project -- health [--project <id>] # 项目包、HTML 和追溯健康检查
```

失败时的截图、Trace 和 HTML 报告输出到 `output/playwright/`，该目录不提交 Git。

视觉基线保存在 `tests/visual/baselines/`，需要纳入版本管理；当前正式入口为 React。

## 4. 当前覆盖

### 路由冒烟

测试会扫描全部有效项目包及其 `page-definitions.js`，并同时检查平台首页（含项目选择）、各客户端登录和业务页面、移动端、文档中心、工程工具及组件规范页。新增正式项目页面后无需手工维护路由冒烟清单。

### 组件单元测试

React 单元测试位于 `apps/platform-react`，使用 Vitest、Testing Library 和 jsdom；框架无关核心测试位于 `tests/unit`。两类测试都不需要启动浏览器。

新增或调整公共组件时，必须补充对应测试并执行 npm run test:unit。业务页面的具体字段、模拟数据和视觉保真仍由 Playwright 冒烟与视觉基线覆盖。

### 关键交互

- 营运端默认账号登录。
- 营运端和企业端切换。
- 退出登录。
- 平台账户管理新增员工弹窗。
- 行销方案管理门市方案抽屉。
- 新增公务订单选择员工弹窗。
- 门市订单统计卡片和分页。
- 文档中心读取和目录搜索。
- 未知地址 404、页面标题和返回首页。
- 组件规范页统计卡片、筛选重置及弹窗操作。

### 视觉基线

- 平台首页（含项目入口）、组件规范页
- 营运端登录、工作台、综合仪表板和战情分析看板
- 门市租赁订单、订单详情
- 平台账户管理、行销方案管理
- 企业端登录、仪表板、公务订单管理、公务车辆管理
- 新增公务订单、车辆使用范围
- 文档中心

## 5. 新增或修改页面

1. 新增页面并接入正式路由。
2. 执行 `npm run test:smoke`，确认页面可打开且无脚本错误。
3. 高频演示页面、公共页面或高风险页面加入 React E2E 视觉检查。
4. 页面存在关键弹窗或业务操作时，在 `tests/e2e/` 对应测试中增加交互检查。
5. 执行 `npm run test:e2e` 和 `npm run build`。

## 6. 视觉基线更新规则

视觉测试失败时，先查看失败报告中的期望图、实际图和差异图。

只有以下条件全部满足时才允许更新视觉基线：

1. 页面变化属于已经确认的需求或设计调整。
2. 按钮、弹窗、文字、边框、间距和响应式布局均已人工确认。
3. 不是全局样式污染、字体加载失败、数据变化或测试不稳定导致。

不得为了让测试通过而直接覆盖截图基线。

## 7. 代码质量与 CI

```powershell
npm run lint
npm run format:check
npm run audit:all
npm run quality:check
npm run ci:check
npm run quality:core
```

`quality:check` 执行 ESLint、Prettier 检查、全部静态审计和生产构建；`ci:check` 在此基础上增加组件单元测试和浏览器冒烟测试。

`quality:core` 是开源仓库和平台底座的稳定门禁，只检查可提交的 `apps`、`plugins`、`packages`、脚本、测试、模板和脱敏样例，不扫描被 Git 忽略的真实 `projects` 业务源码。真实项目包应另外执行 `npm run lint`、`npm run project:health` 和相应的业务验收；两类结果不能混为一谈。

GitHub Actions 配置位于仓库根目录 `.github/workflows/prototype-quality.yml`，会执行 `quality:core`。由于真实项目包不提交到仓库，CI 不假定存在客户资料，也不会上传项目 PRD。

历史营运端和企业端页面不执行 Prettier 批量格式化；ESLint 对历史目录采用兼容规则，对工程底座和新页面采用严格规则。

## 8. 当前边界

- 字体、演示图片和图标均使用本地依赖或工程资源；测试环境不得依赖外部视觉资源。
- 视觉基线当前只覆盖桌面端标准视口，移动端和其他桌面尺寸可按后续需求增加项目配置。
- 自动化测试不能替代产品负责人对业务口径、模拟数据和完整操作流程的人工验收。

## 版本记录

| 版本 | 日期       | 内容                                                                              |
| ---- | ---------- | --------------------------------------------------------------------------------- |
| v1.0 | 2026-07-11 | 建立路由、关键交互和视觉截图自动验收。                                            |
| v1.1 | 2026-07-12 | 路由测试改为读取统一页面注册表，增加 ESLint、Prettier 和 CI 检查说明。            |
| v1.2 | 2026-07-13 | 接入 Vitest 组件单元测试，并纳入本地 CI 聚合命令和 GitHub Actions。               |
| v1.3 | 2026-07-16 | 路由冒烟改为扫描可插拔项目包，并增加项目 Manifest、页面文件和资源完整性单元测试。 |
