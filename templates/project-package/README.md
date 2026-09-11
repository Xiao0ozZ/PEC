# 项目包模板

1. 将整个目录复制到工程的 `projects/{project-id}`。
2. 将文件夹名和 `project.json` 的 `id` 同时改为相同的 kebab-case 标识。
3. 修改项目名称、主题、客户端和入口。
4. 在 `page-definitions.js` 登记页面，规范 HTML 页面放在 `html-pages/{client-id}`。
5. 执行 `npm run audit:projects` 检查项目包，再启动工程。

项目包不得修改平台外壳代码。项目专属配置、页面、资源、模拟数据、文档和移动端内容都应留在自己的项目文件夹中。
