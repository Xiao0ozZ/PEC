# React 迁移基线

## 版本记录

| 版本 | 日期       | 编辑者 | 变更摘要                                                   | 制定依据                                    |
| ---- | ---------- | ------ | ---------------------------------------------------------- | ------------------------------------------- |
| v1.0 | 2026-08-12 | Codex  | 完成 React 迁移阶段 0 的代码、路由、接口、测试和兼容性基线 | Git `3b5a511`、当前仓库代码、自动化检查结果 |

## 1. 基线结论

阶段 0 已完成，当前 Vue 平台可以作为 React 迁移的可回退基线。

- 基线提交：`3b5a511 Remove obsolete prototype pages and supporting code`
- 基线分支：`main`
- 迁移分支：`codex/react-platform-migration`
- 基线开始前工作区：干净
- 当前迁移改动：仅迁移文档，不含运行时代码
- 项目资料：未修改 `projects/` 中任何文件

React 迁移可以进入阶段 1，但必须先保持现有 Vue 入口可运行。当前项目包仍有正在使用的 Vue SFC 页面，不能提前删除 Vue 运行时。

## 2. 环境与依赖

| 项目         | 基线值           |
| ------------ | ---------------- |
| Node.js      | v24.13.0         |
| npm          | 11.6.2           |
| Git          | 2.52.0.windows.1 |
| 工程版本     | 0.11.0           |
| Vite         | 6.4.3            |
| Vue          | 3.4.21           |
| Vue Router   | 4.4.5            |
| Element Plus | 2.8.0            |
| Vitest       | 4.1.10           |

这些值只用于复现迁移起点。React 依赖会在阶段 2 单独锁定，不会通过升级现有 Vue 依赖来间接引入。

## 3. 基线质量结果

| 检查                                                   | 结果 | 证据                         |
| ------------------------------------------------------ | ---- | ---------------------------- |
| `npm run lint:core`                                    | 通过 | ESLint 无错误                |
| `npm run format:check:core`                            | 通过 | Prettier 检查全部通过        |
| `npm run test:unit`                                    | 通过 | 12 个测试文件、72 项测试通过 |
| `npm run project -- validate --projects-root examples` | 通过 | 示例项目 1 个有效、0 个无效  |
| `npm run build`                                        | 通过 | Vite 生产构建成功            |

本阶段没有运行 Playwright 和视觉回归，因为用户现有约束是不默认启动浏览器。阶段 3 进入真实页面迁移后，需要单独获得浏览器验证授权。

## 4. 当前平台规模

| 范围            | 数量或说明                                  |
| --------------- | ------------------------------------------- |
| `src/**/*.vue`  | 47 个 Vue 文件                              |
| 正式页面视图    | 15 个 `src/views/**/*.vue`                  |
| `src` 中 JS/MJS | 25 个                                       |
| 单元测试        | 12 个测试文件、72 项测试                    |
| E2E             | 3 个 Playwright 场景文件和 1 个公共辅助文件 |
| 视觉基准        | 17 张 Chromium 基准图                       |

正式视图范围：

- 首页和组件规范；
- 客户端登录、客户端外壳承载、移动端和 HTML 直读；
- 文档中心；
- 控制台、项目包管理、路由菜单管理、页面导入导出和 AI 上下文；
- 客户端空状态、项目不可用和 404。

## 5. 路由基线

### 5.1 平台固定路由

| 路径                    | 功能                                   |
| ----------------------- | -------------------------------------- |
| `/`                     | 正式首页；历史皮肤地址作为别名回到首页 |
| `/tools/console`        | 控制台                                 |
| `/tools/projects`       | 项目包管理                             |
| `/tools/project-routes` | 路由与菜单管理                         |
| `/tools/page-transfer`  | 页面导入导出                           |
| `/tools/ai-context`     | AI 上下文中心                          |
| `/components`           | 组件规范                               |

### 5.2 项目动态路由

- `/p/{projectId}`：回到首页并选中项目；
- `/p/{projectId}/{clientId}/login`：客户端登录；
- `/p/{projectId}/{clientId}/{pagePath}`：客户端页面；
- `/p/{projectId}/mobile`：移动端；
- `/p/{projectId}/docs`：文档中心；
- 兼容项目可以保留历史客户端、`/mobile` 和 `/docs` 重定向；
- 隐藏项目通过路由守卫返回首页，不能通过直链继续访问；
- 普通运行使用 History 路由，独立导出运行使用 Hash 路由。

React Router 必须保持以上 URL、查询参数、Hash、重定向、标题和隐藏项目访问规则。

## 6. 运行时接口基线

### 6.1 虚拟模块

- `virtual:project-html-pages`：向前端提供扫描后的 HTML 原型页面清单。

### 6.2 项目与资源

- `/__projects/manifest`
- `/__projects/create`
- `/__projects/update`
- `/__projects/file`
- `/__projects/source`
- `/__projects/html-content/{projectId}/{clientId}/{path}`
- `/__projects/page-prd-links`
- `/__projects/prd-bindings`

### 6.3 PRD 与平台设置

- `/__prd/manifest`
- `/__prd/file`
- `/__platform/settings`

### 6.4 页面、路由与导入导出

- `/__page-transfer/inspect`
- `/__page-transfer/import`
- `/__page-transfer/export`
- `/__page-transfer/download`
- `/__page-transfer/routes`
- `/__page-transfer/route/create`
- `/__page-transfer/route/update`
- `/__page-transfer/route/delete`
- `/__page-transfer/route/restore`
- `/__page-transfer/route/order`
- `/__page-transfer/section/update`
- `/__page-transfer/section/restore`

阶段 1 必须先为这些接口建立框架无关的数据契约和错误模型，React 页面不得直接依赖插件内部实现。

## 7. 项目包兼容清单

当前本地项目包中发现 15 个 Vue SFC 文件：

- 8 个位于 `projects/demo/views/`，属于仍可能被当前项目路由使用的工程页面；
- 7 个位于 `projects/demo/.backups/pages/`，属于页面备份。

正在使用的 Vue 页面包括：

- `projects/demo/views/admin/ContractQuotasView.vue`
- `projects/demo/views/admin/HomeView.vue`
- `projects/demo/views/admin/ServiceProductsView.vue`
- `projects/demo/views/admin/TimeShareOrdersView.vue`
- `projects/demo/views/admin/VehicleConsole1View.vue`
- `projects/demo/views/client-2/1View.vue`
- `projects/demo/views/client-2/2View.vue`
- `projects/demo/views/client-2/StoreOrdersView.vue`

处理规则：

1. 迁移期间不修改这些项目文件；
2. React 先承载项目包中的独立 HTML、PRD、Mock 和资源；
3. Vue SFC 页面继续由 Vue 兼容入口运行；
4. 阶段 5 再显式选择转换为标准 HTML 模板或 React 模块；
5. 阶段 8 删除 Vue 运行时前，所有仍在使用的 SFC 必须有明确去向。

## 8. 已知基线风险

### 8.1 构建产物偏大

生产构建已通过，但存在超过 500 kB 的压缩前 JS Chunk：

- 主入口约 1,875 kB；
- Mermaid/Cynefin 等按需模块约 598-691 kB。

这是当前 Vue 基线已有问题。React 迁移不得继续恶化，阶段 2 起应记录首次加载和按需加载结果；文档中心的 Mermaid 必须延迟加载。

### 8.2 生产构建包含本地项目资料

当前生产构建会将已安装项目的 HTML、PRD 和资源复制到 `dist/projects/`。这是现有部署能力的一部分，但也意味着生产包可能包含本地项目资料。迁移期间保持行为兼容，后续若要开源发布通用平台包，应单独区分“空平台构建”和“带项目审阅构建”。

### 8.3 浏览器行为尚未在本阶段重新验证

现有 Playwright 场景与视觉基准仍保留，但本阶段未启动浏览器。iframe 导航、PRD 浮层、拖动、滚动定位和复杂弹窗必须在对应功能迁移阶段做真实浏览器回归。

## 9. 回退方式

- 迁移前基线：切回 `main` 的 `3b5a511`；
- 迁移开发：继续在 `codex/react-platform-migration`；
- React 正式切换前，不删除 Vue 入口和相关依赖；
- `projects/` 未加入版本控制，本次迁移不以 Git 操作覆盖或回退项目资料。

## 10. 下一阶段入口

阶段 1 从框架无关契约开始：

1. 建立 `platform-contracts`；
2. 统一现有项目、PRD、路由和导入导出 DTO；
3. 建立稳定错误码；
4. 建立 `platform-client` 数据访问层；
5. 先让现有 Vue 服务调用新 Client，证明行为兼容，再让 React 使用。
