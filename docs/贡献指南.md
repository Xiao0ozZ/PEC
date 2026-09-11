# 参与贡献

感谢你愿意改进产品功能体验中心。本仓库维护平台壳、公共能力、模板和工程工具，不接收真实业务项目包。

## 开始前

1. 使用 Node.js 20 或更新的 LTS 版本。
2. 执行 `npm install`。
3. 可执行 `npm run project:example` 安装本地示例；该命令写入被 Git 忽略的 `projects/sample-project`。
4. 不要提交 `projects/`、`project-mounts.local.json`、真实 PRD、客户数据或凭证。

## 修改原则

- 项目专属逻辑放在项目包，不写入公共壳。
- 页面、菜单和路由以项目包页面定义为单一来源。
- HTML 模板必须通过 `npm run project -- preflight --file <file>`。
- 变更公共契约时，同时更新文档、示例和单元测试。
- 不覆盖无关的本地修改，不提交构建产物。

## 提交前检查

```powershell
npm run quality:core
```

如修改了真实本地项目包，可额外运行 `npm run quality:check`；这项检查可能暴露项目包自身的历史问题，不能用修改公共壳的方式掩盖。

## Pull Request

请说明问题、方案、影响范围、验证结果和未验证事项。涉及 UI 时附截图；涉及数据写入、导入导出或项目契约时，说明兼容和回滚方式。
