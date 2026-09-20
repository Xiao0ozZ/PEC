# Platform Client

共用平台的框架无关数据访问层，供 React 平台和独立本地服务使用。

客户端通过构造参数接收 `fetch`、`baseUrl` 和运行环境，不依赖 React 或 Vite。静态部署的只读边界由客户端统一处理，页面来源统一为 HTML 原型、项目文档和项目配置。
