// 两个 Vite 配置（正式构建与 React 独立入口）共用同一套分包策略，避免各自维护一份。
//
// 这里刻意不把 antd 单独分包：`@/ui/ant` 是桶文件，强制成一个 vendor chunk 会把所有
// 被任意懒加载页面用到的组件都提到首屏，实测首屏负载从 1020 kB 涨到 1488 kB。
// 交给 Rollup 按真实依赖图切分反而更小。
const VENDOR_CHUNKS = [
  {
    name: 'react-runtime',
    matches: ['/node_modules/react/', '/node_modules/react-dom/', '/node_modules/react-router'],
  },
  { name: 'data-runtime', matches: ['/node_modules/@tanstack/', '/node_modules/i18next/'] },
];

export function manualChunks(id) {
  const normalized = id.replaceAll('\\', '/');
  for (const chunk of VENDOR_CHUNKS) {
    if (chunk.matches.some((match) => normalized.includes(match))) return chunk.name;
  }
  return undefined;
}
