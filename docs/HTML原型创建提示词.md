# HTML 原型创建提示词

用于需求阶段制作可独立预览、可直接由 React 平台承载的原生 HTML 原型。页面定案后仍以 HTML 为正式来源，不生成其他框架页面副本。

使用前填写：

- 页面名称：
- 客户端：营运端 / 企业端 / 移动端
- PRD 路径：
- 视觉参考 HTML：
- 输出路径：
- 必须演示的弹窗和交互：

## 提示词

```text
请根据 PRD 创建或修改一个可独立打开、可由 React 平台公共外壳承载的原生 HTML 页面。

1. 先读取 PRD 和指定的参考 HTML。参考页面只用于对齐布局、间距、字体、颜色、按钮、卡片、表格、表单和弹窗效果，不直接复制参考页面的旧外壳、全局样式或启动代码。
2. 完整实现页面字段、模拟数据、筛选、分页、状态、校验、按钮、弹窗和抽屉。不得用占位内容代替已经明确的业务要求，也不得为了省事删除必要交互。
3. 页面结构统一为：
   - 独立预览的自有外壳可用 data-prototype-shell 标记；
   - 业务内容只放在一个 data-page-content 节点内，并在同一节点上标记 data-business-content；
   - 弹窗、抽屉和确认层放在内容区之后，并标记 data-page-overlay；
   - 保留 PAGE_CONTENT、PAGE_OVERLAYS 和 PAGE_LOGIC 编辑边界。
4. 只使用原生 HTML、CSS 和浏览器 API。禁止引入前端框架、组件库、CDN、外部字体和外部图片；禁止使用内联事件、jQuery、未声明的全局变量和重复初始化。
5. 页面样式放在唯一页面根类名下，不污染平台外壳。颜色、背景、边框、文字、阴影、圆角和状态优先使用 --app-* 语义变量；不要在业务样式中重新定义平台主色体系。
6. 页面必须响应平台主题：html[data-theme="light"] 和 html[data-theme="dark"] 都能正常阅读；模板的主题桥接区不能删除、改名或重复实现。页面背景、面板、文字、边框、悬浮层和成功/警告/危险状态不得只写死白色、黑色或灰色。
7. 页面状态、模拟数据、派生展示和事件绑定集中放在 PAGE_LOGIC 区域。使用 addEventListener、dataset、classList 和标准表单 API 实现交互；需要弹窗时优先使用原生 dialog 或页面内可访问的浮层。
8. 页面 Manifest 必须是有效 JSON，并填写 templateVersion、pageKey、pageTitle、client 和 routePath。scriptMode 使用 native，dependencies 和 assets 只登记实际存在的本地资源。
9. 页面完成后对照参考 HTML 检查视觉，并确认按钮、筛选、弹窗、抽屉、分页和校验可以实际操作，浏览器控制台无错误。运行 npm run project -- preflight --file <页面路径> 检查模板契约。
10. 交付时只说明修改文件、参考页面、已实现交互和仍待确认事项，不修改平台公共外壳或其他项目资料。

不要重新设计已经确认的业务口径。视觉可以参考目标页面，但代码必须保持独立、可读、可维护，并使用平台统一主题变量。
```

## 使用流程

1. 复制 `templates/html-prototype-page.html`，按编辑标记修改页面业务内容。
2. 将托管页面放入项目包 `html-pages/{client-id}`，并在 `page-definitions.js` 或“路由菜单管理”中登记。
3. 执行 HTML 预检、项目包校验、单元测试和构建。
4. 在 React 平台中验证外壳、主题、滚动、PRD 对照和页面交互。

模板只提供原生 HTML 的最小可运行示例。业务页面可以替换示例表格和数据，但必须保留 Manifest、内容边界、浮层边界和主题变量约定。
