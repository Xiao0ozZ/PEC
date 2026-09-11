import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// 观察期保留的 i18n 基础设施：当前平台只提供简体中文，界面没有语言入口，
// 因此 main.tsx 不再预先加载本模块，避免把 i18next 打进首屏。
// 真正启用多语言时，在 main.tsx 顶部 `import './i18n';` 即可恢复初始化。
void i18n.use(initReactI18next).init({
  lng: 'zh-CN',
  fallbackLng: 'zh-CN',
  interpolation: { escapeValue: false },
  resources: {
    'zh-CN': {
      translation: {
        platformName: '项目原型与资料协作平台',
      },
    },
  },
});

export default i18n;
