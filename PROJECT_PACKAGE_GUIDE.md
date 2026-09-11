# 可插拔项目包说明

## 1. 架构定位

工程由“共用外壳”和“项目包”两层组成。

- 共用外壳负责首页、项目选择、登录框架、侧栏、顶栏、公共组件、主题应用、文档阅读、页面导入导出和工程检查。
- 项目包负责自己的项目名称、Logo、主题色、客户端入口、业务页面、模拟数据、资源、文档和移动端内容。
- 项目包之间不共享业务页面或业务数据，不在外壳中硬编码某个项目的入口。

当前实现继续使用 Vite 自带的 Node 插件能力，只在本地开发和构建时扫描文件，不包含数据库、账号服务或独立业务后端。

## 2. 目录规范

```text
projects/{project-id}/
├─ project.json                 项目 Manifest
├─ page-definitions.js          客户端、菜单和页面登记
├─ page-prd-links.js            历史兼容：原型页面与 PRD 文件关联
├─ .platform/
│  └─ page-prd-links.json       页面级 PRD 文件关联配置（工具页维护）
├─ html-pages/{client-id}/      React 平台导入并管理的 HTML 页面
├─ views/{client-id}/           可选：历史 Vue 页面资料，React 不执行
├─ assets/                      Logo、登录背景和项目图片
├─ data/                        可选的项目级模拟数据
├─ docs/                        可选的项目文档
├─ prototype/                   可选的 HTML 原型目录
└─ mobile/                      可选的移动端静态演示
```

`project-id`、项目文件夹名和 `project.json.id` 必须完全相同，并使用小写 kebab-case。

可复制 `templates/project-package` 作为新项目起点。复制后先修改项目 ID 和配置，再执行：

```powershell
npm run project -- init --id sample-project --name "示例项目"
npm run project -- validate
```

仓库还提供脱敏样例，可直接安装到被忽略的本地项目目录：

```powershell
npm run project:example
```

项目包机器可读契约位于 `packages/project-core/schemas`。`project.schema.json` 描述基础字段，运行时校验还会检查客户端与入口引用、默认页面、项目资源和外部 HTML/PRD 目录是否存在。

## 3. project.json

主要字段：

| 字段                     | 说明                                                                   |
| ------------------------ | ---------------------------------------------------------------------- |
| `schemaVersion`          | 当前固定为 `1`                                                         |
| `id`                     | 项目唯一标识，必须与文件夹名一致                                       |
| `name`、`shortName`      | 项目全名和简称                                                         |
| `description`、`version` | 首页说明和项目包版本                                                   |
| `homepage`               | 首页项目选择中的显示状态；隐藏时保留项目包，但不在首页项目选择器中展示 |
| `pageDefinitions`        | 当前固定为 `page-definitions.js`                                       |
| `branding`               | `logo`、`favicon` 等项目资源相对路径                                   |
| `theme`                  | 主色、悬停色、按下色和内容区背景色                                     |
| `clients`                | 项目包含的客户端，以及默认页、进入方式、页面外壳和可选登录演示配置     |
| `entries`                | 项目首页展示的客户端、文档和移动端入口                                 |
| `docs`                   | 文档中心开关与文档目录                                                 |
| `prototype`              | HTML 原型直读总开关，以及按客户端配置的 HTML 目录                      |
| `mobile`                 | 移动端入口开关与静态 HTML 路径                                         |
| `features`               | 页面导入等项目能力开关                                                 |
| `compatibility`          | 历史路由或外部文档过渡配置，新项目通常不需要                           |

项目 Logo、登录背景和移动端入口都使用项目包内相对路径。页面通过 `getProjectAssetUrl(projectId, path)` 获取项目资源地址，不直接拼接开发服务接口。

每个客户端可独立配置进入方式和页面外壳：

```json
{
  "id": "admin",
  "defaultPage": "home",
  "entry": { "mode": "direct" },
  "layout": { "type": "sidebar" }
}
```

- `entry.mode` 支持 `direct`（直接进入默认页）、`platform-login`（先显示平台演示登录页）和 `custom-page`（先进入 `entry.page` 指定的页面）。
- `layout.type` 支持 `sidebar`（左侧菜单）、`topnav`（按路由分组显示顶部导航）、`none`（不显示页面菜单）和 `bare`（不显示平台导航）。前三种模式保留平台顶栏；`bare` 仅在开发模式下显示紧凑工具条，用于返回首页、查看 PRD 和下载源文件。
- 未登记 `entry` 和 `layout` 的历史项目按 `platform-login + sidebar` 运行，避免已有入口行为变化；新建项目默认使用 `direct + sidebar`。

## 4. 页面定义

每个客户端在 `page-definitions.js` 中维护：

- `sections`：侧栏菜单分组和顺序。
- `pages`：路由片段、页面名、标题、HTML 来源或历史 Vue 文件、菜单分组和图标。
- `// <generator:{client-id}-pages>`：页面生成器和 HTML 导入工具的写入位置。

开发模式下，页面对应的 PRD 在项目包 `.platform/page-prd-links.json` 中维护，按客户端和页面名称关联项目 `docs` 目录下的 Markdown 文件。可进入“路由菜单管理”，在页面列表中点击“关联 PRD”完成选择、修改和清除；历史项目中的 `page-prd-links.js` 仍作为兼容读取来源。页面进入统一内部外壳后，可在不离开原型的情况下查看对应 PRD；没有登记关联文档的页面不显示 PRD 入口。

正式路由由外壳自动生成：

```text
/p/{project-id}/{client-id}/login
/p/{project-id}/{client-id}/{page-path}
```

新增业务页面优先复制 `templates/html-prototype-page.html` 制作 HTML，再通过“页面导入导出”登记；也可以在路由菜单管理中新增 HTML 占位页面。页面文件写入 `projects/{project-id}/html-pages/{client-id}`，并同步登记菜单和路由。历史 Vue 页面仍可被项目扫描和页面传输工具识别，但不作为 React 平台运行入口。

## 5. 插拔行为

开发环境中，Vite 会扫描 `projects/*/project.json`。增加、移入、移出或删除项目包后，开发服务会触发全量刷新；如浏览器没有及时更新，重启一次 Vite 服务即可。

生产构建是项目包的发布快照：

    - 构建时存在的项目包会生成到 `dist` 的项目快照。
- 构建完成后仅移动源码项目文件夹，不会改变已经生成的 `dist`。
- 服务器需要增加、移除或更新项目包时，必须重新执行 `npm run build` 并发布新的 `dist`。

这仍是轻量方案。若未来要求服务器在不重新构建的情况下安装全新的 Vue 项目包，需要再引入独立预编译插件包和运行时模块加载机制，不属于当前范围。

### 本地外置资料挂载

完整项目包、PRD 和 HTML 原型都可以挂载到任意本机绝对目录。完整项目可在项目包管理页使用“挂载项目”选择；只覆盖资料源时继续使用 CLI：

```powershell
npm run project -- mount --project sample --docs D:\product\docs
npm run project -- mount --project sample --prototype admin=D:\product\admin-html,client=D:\product\client-html
npm run project -- mount --project sample --clear-docs --clear-prototype admin
npm run project -- mounts
```

挂载写入根目录 `project-mounts.local.json`，该文件已加入 `.gitignore`。`root` 让平台直接使用外部项目文件夹；`docsRoot` 和 `prototypes` 分别覆盖 `project.json` 内的文档和客户端原型目录。平台不会复制或改写源项目；取消完整项目挂载时只删除本机挂载记录，不会删除外部文件。路由菜单管理、文档中心、HTML 直读、健康检查和生产构建使用同一挂载解析规则。可复制 `project-mounts.example.json` 作为手工配置参考。

## 6. 项目包管理

开发服务启动后，可在“项目包状态”页面直接管理项目基础资料：

- 新建项目：填写项目 ID、名称、简称、说明、版本、默认语言、主题色、内容区背景和 Logo 后，系统会复制 `templates/project-package` 生成初始化项目包，并带有默认客户端入口。
- 编辑项目：可更新项目基础资料、版本和默认语言、客户端入口名称/说明/图标/默认页面/进入方式/页面外壳/登录演示配置、首页入口显示状态与顺序、文档和移动端入口、工程能力开关及历史兼容开关。
- 首页入口显示：取消“在首页项目选择中显示”后，项目包仍保留在 `projects` 目录，项目内页面和直接路由不受影响；重新勾选即可恢复首页选择入口。
- 客户端 ID、页面定义、菜单分组和页面文件仍由页面工程维护；项目管理页可以新增一个空的客户端页面登记位，或管理已有客户端如何作为项目入口展示，不直接改写已有业务页面和菜单。
- 新增客户端后先在“页面导入导出”中选择该客户端导入 HTML 页面，再设置默认页面；在没有导入页面前，不建议把该客户端作为正式演示入口使用。
- 项目管理页会同步保存 `project.json`；不会修改项目页面、页面定义文件、模拟数据或文档内容。
- 项目 ID 创建后不可修改，必须使用小写 kebab-case，并且会作为项目文件夹名称和动态路由的一部分。
- 新项目包或配置修改完成后，若首页没有立即更新，重启一次 Vite 开发服务即可；生产环境仍需重新构建并发布。
- 项目页面后续通过“页面导入导出”选择目标项目，再导入按模板制作的 HTML 页面，不需要手动改外壳路由。
- 也可以在项目配置中启用 HTML 原型直读，分别为每个客户端填写项目内或本机绝对 HTML 目录；系统会递归扫描文件，根据标题生成页面名称，根据相对路径生成稳定路由，不生成 Vue 副本。
- 每个 HTML 来源可设置 `shellMode`：`auto` 会对模板化 HTML 隐藏原页面菜单和顶栏、只显示内容区；`full` 会完整保留 HTML 自身外壳。选择 `full` 时，建议将对应客户端的 `layout.type` 设为 `bare`，避免平台导航与原页面外壳重复。
- HTML 直读页面在路由管理中标记为“HTML 直读”，只能通过原型目录维护；页面级 PRD 关联仍可在路由管理中配置。
- “路由菜单管理”可以按客户端新增、编辑或删除路由；编辑可调整页面名称、路由片段、菜单分组和图标，也可以新增、重命名或删除菜单分组。仍被页面使用的分组不能删除；删除、编辑、分组修改和 HTML 替换都会在项目包备份目录中保留可还原记录。

该管理能力只存在于本地 Vite 开发服务，接口仅允许本机访问；工程没有增加数据库或独立后端。

## 7. 文档与移动端

- `docs.enabled=true` 时，文档中心按项目扫描 `docs.root`。
- `docs.root` 默认是项目包内的 `docs`，也可以在本地开发环境中配置为本机可访问的绝对路径，以直接读取项目包外的 PRD 原文件。
- 外部 PRD 目录只作为读取源，不会修改 Markdown 原文件；开发环境会实时读取，生产构建会将该目录生成到 `dist` 的文档快照中。
- `prototype.enabled=true` 时，开发环境按 `prototype.clients.{client-id}.root` 扫描对应客户端的 HTML；生产构建会将 HTML 及其相对资源复制到 `dist/projects/{project-id}/prototype/{client-id}`。旧的 `prototype.root` 配置仍兼容读取。
- `mobile.enabled=true` 时，`mobile.entry` 必须指向项目包内的 HTML。

## 8. 开发模式与 PRD 对照

- 开发模式只面向 PM、开发人员和内部评审，不影响客户演示页面。
- 在控制台开启开发模式后，进入已关联 PRD 的业务页面，顶栏会显示“查看 PRD”。
- 默认采用固定分屏；PRD 面板也可以切换为浮层或新窗口打开。
- PRD 面板提供“下载源文件”，按当前页面定义中的 HTML 来源下载对应的原型文件，仅在本机开发服务中开放，用于开发辅助，不会把项目源码发布到生产构建；历史 Vue 页面只在兼容读取场景下保留原始来源。
- 直接访问业务页面并附加 `?__dev=1` 也可以开启当前浏览器会话的开发模式。
- 页面与 PRD 的关联文件不存在或未登记时，页面不显示无效入口。

## 9. 导入导出

页面导入导出工具会先选择目标项目：

- 导入时，客户端、菜单分组和目标目录都来自所选项目包。
- 导入后的 HTML 页面写入所选项目的 `html-pages/{client-id}`，页面登记写入该项目的 `page-definitions.js`。
- 导出时只展示所选项目的页面，输出目录按项目隔离。
- 单页输出独立 HTML，多页输出 ZIP；导出包不包含其他项目页面。

## 10. AI 交付上下文

“AI 上下文中心”只读取项目包现有配置和项目内容，不要求项目包增加新的必填文件：

- 页面来源：`project.json`、`page-definitions.js` 和按客户端扫描得到的 HTML 直读页面。
- 需求来源：`docs.root` 下的 Markdown，只读。
- 页面级关联：`.platform/page-prd-links.json`，兼容历史 `page-prd-links.js`。
- 组件级关联：`.platform/prd-bindings.json`。

系统会生成页面覆盖率、失效关联、待确认关联建议和 PRD 变化影响。关联建议只有用户确认后才更新页面级关联配置；影响分析基线保存在当前浏览器，不写入项目包。导出的 JSON 上下文包是派生资料，可以交给 AI 或自动化工具使用，但不能替代项目包和 PRD 原文件作为事实来源。

命令行可生成持久化基线和追溯报告：

```powershell
npm run project -- snapshot --project sample
npm run project -- trace --project sample
```

追溯报告包含页面级 PRD、组件级章节、未覆盖页面、孤立文档、失效章节锚点和相对基线的影响范围。它只读取源资料并写入被 Git 忽略的 `output/`，不会修改 PRD。

## 11. 校验与边界

`npm run audit:projects` 会检查：

- 项目 ID、客户端、入口和默认页。
- 页面定义、菜单分组、重复路由和页面文件。
- Logo、移动端入口和文档目录。
- HTML 导入所需的生成器标记。

单个 HTML 在导入、直读或独立交付前，可先执行：

```powershell
npm run project -- preflight --file D:\prototypes\page.html
```

项目级综合检查使用 `npm run project:health`，会同时报告挂载目录、HTML 基础契约、页面 PRD 覆盖率和失效关联。

项目包不得修改外壳的 `apps/platform-react/src/ui`、`apps/platform-react/src/app`、平台路由或公共主题底座。确实可跨项目复用的能力才进入公共组件；项目业务字段、模拟数据和专属资源留在项目包内。

## 版本记录

| 版本 | 日期       | 内容                                                                                                     |
| ---- | ---------- | -------------------------------------------------------------------------------------------------------- |
| v1.6 | 2026-07-16 | 增加项目包首页显示开关，支持隐藏项目选择入口但保留项目包和项目内页面。                                   |
| v1.5 | 2026-07-16 | 扩展菜单分组管理，支持新增、重命名、删除及分组备份还原。                                                 |
| v1.4 | 2026-07-16 | 增加客户端菜单分组重命名、备份与还原能力。                                                               |
| v1.3 | 2026-07-16 | 增加项目级路由菜单管理、删除备份/还原和 HTML 替换备份能力。                                              |
| v1.2 | 2026-07-16 | 扩展项目包管理：支持客户端入口、项目资料入口、能力开关、版本语言和兼容配置。                             |
| v1.1 | 2026-07-16 | 增加本地项目包管理：可新建初始化项目包、编辑项目资料与 Logo，并与 HTML 页面导入流程衔接。                |
| v1.0 | 2026-07-16 | 建立可插拔项目包目录、Manifest、动态入口路由、项目主题、资源读取、项目级文档、导入导出和完整性校验规范。 |
