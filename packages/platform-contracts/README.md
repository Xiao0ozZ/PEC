# Platform Contracts

共用平台的框架无关前端契约。该包不依赖 React、Vite 或浏览器 API。

- `index.js` 提供运行时规范化、错误模型和最小响应校验；
- `index.d.ts` 提供 React/TypeScript 和其他客户端共用的类型；
- 项目包本身的持久化 Schema 继续以 `packages/project-core/schemas` 为准；
- 本包描述平台运行时接口，不重复定义项目包文件格式。
