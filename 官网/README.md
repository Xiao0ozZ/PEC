# Product Experience Center · GitHub Pages 官网

这是按官网视觉稿复刻的纯静态站点，不依赖 Node、CDN 或在线字体。

## 目录

- `docs/index.html`：官网入口
- `docs/styles.css`：完整样式
- `docs/script.js`：导航、搜索、复制命令、入场动画
- `docs/assets/brand/`：Logo / App Icon
- `docs/assets/icons/`：本站使用的本地 SVG 图标
- `docs/.nojekyll`：GitHub Pages 静态资源兼容

## GitHub Pages 部署

1. 将本压缩包中的 `docs` 文件夹复制到 `Product-Experience-Center` 仓库根目录。
2. 提交并推送到 GitHub。
3. 打开仓库 `Settings` → `Pages`。
4. `Build and deployment` 选择 `Deploy from a branch`。
5. Branch 选择 `main`，目录选择 `/docs`，保存。
6. 等待 GitHub Pages 构建完成后即可访问。

站点使用相对路径，因此也可以直接双击 `docs/index.html` 本地预览，或部署到任意静态服务器。

## Layout refinement

This package includes the spacious layout refinement: wider desktop content area, larger section spacing, more relaxed card sizing, and responsive spacing adjustments for tablet/mobile.
