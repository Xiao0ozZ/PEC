/* ==========================================================================
   KCD 全域命名空間與主題橋接
   --------------------------------------------------------------------------
   免建置環境沒有模組系統，因此所有檔案掛在單一 window.KCD 上，
   由 index.html 的 script 順序保證依賴先於使用者載入。

   本檔的核心職責是「把 CSS token 讀成 JS 值」。
   ECharts 不認得 CSS 變數 —— 傳 "var(--st-normal)" 給它只會得到黑色。
   若在 JS 裡另抄一份色票，就等於同一組顏色維護兩處，遲早分岔。
   所以這裡在執行期從 :root 的計算樣式把 token 讀出來，換主題時重讀一次，
   圖表顏色因此永遠跟著 CSS 走，單一事實來源仍然是 tokens.css。
   ========================================================================== */

window.KCD = window.KCD || {};

(function (KCD) {
    'use strict';

    // 需要傳給 ECharts 的 token。名稱與 tokens.css 中的宣告一一對應。
    const TOKEN_KEYS = [
        'sf-page', 'sf-chrome', 'sf-card', 'sf-inset', 'sf-hover',
        'ink-1', 'ink-2', 'ink-3',
        'ln-hair', 'ln-card',
        'brand', 'ink-on-brand',
        'st-info', 'st-normal', 'st-notice', 'st-warn', 'st-critical', 'st-offline',
        'cat-1', 'cat-2', 'cat-3', 'cat-4', 'cat-5', 'cat-6', 'cat-7', 'cat-8',
        'seq-hue',
        'fx-font-ui', 'fx-font-num', 'fx-font-mono',
        'fx-r-card', 'fx-r-panel', 'fx-r-inner'
    ];

    /* 圖表內文字的字級。ECharts 需要數字而不是 "13px"，因此單獨一組並在
       readTokens 裡去掉單位 —— 傳字串給 ECharts 會被當成 0，文字整片消失。
       這四個 token 是圖表字級的單一事實來源；先前散落在各模組的
       fontSize: 10 / 11 / 12 就是靠這層收攏。 */
    const FONT_KEYS = ['fs-chart-axis', 'fs-chart-name', 'fs-chart-label', 'fs-chart-tip'];

    const THEMES = [
        { id: 'theme-light', label: '標準淺色', base: 'theme-light' },
        { id: 'theme-tech', label: '深藍科技', base: 'theme-dark' }
    ];
    const THEME_IDS = THEMES.map(t => t.id);
    const BASE_CLASSES = ['theme-light', 'theme-dark'];
    const DEFAULT_THEME = 'theme-tech';

    let cache = null;

    /** 從當前 body 的計算樣式讀出所有 token。換主題後必須先 invalidate。 */
    function readTokens() {
        if (cache) return cache;
        const cs = getComputedStyle(document.body);
        const out = {};
        TOKEN_KEYS.forEach(key => {
            out[key] = cs.getPropertyValue('--' + key).trim();
        });
        // 字級去掉 px 後轉數字，供 ECharts 的 fontSize 使用
        FONT_KEYS.forEach(key => {
            const raw = parseFloat(cs.getPropertyValue('--' + key));
            out[key] = Number.isFinite(raw) ? raw : 12;
        });
        // 類別色排成陣列，圖表要按序列取色時直接用。
        out.catPalette = [1, 2, 3, 4, 5, 6, 7, 8].map(i => out['cat-' + i]);
        cache = out;
        return out;
    }

    function applyTheme(themeId) {
        const theme = THEMES.find(t => t.id === themeId) || THEMES.find(t => t.id === DEFAULT_THEME);
        document.body.classList.remove(...THEME_IDS, ...BASE_CLASSES);
        document.body.classList.add(theme.id);
        if (theme.base !== theme.id) document.body.classList.add(theme.base);
        cache = null;
        // 通知所有圖表用新 token 重繪。
        window.dispatchEvent(new CustomEvent('kcd:theme-changed', { detail: theme.id }));
        return theme.id;
    }

    KCD.theme = {
        list: THEMES,
        ids: THEME_IDS,
        default: DEFAULT_THEME,
        apply: applyTheme,
        tokens: readTokens,
        invalidate() { cache = null; }
    };
})(window.KCD);
