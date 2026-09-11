import React from 'react';
import ReactDOM from 'react-dom/client';

import 'antd/dist/reset.css';
import './styles/global.css';
import './styles/platform-workspace.css';
import './styles/ant-v6.css';
// 框架样式放在最后，确保侧栏/双面板规则覆盖旧外壳的既有布局写法。
import './styles/app-shell-frame.css';

import { App } from './app/App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
