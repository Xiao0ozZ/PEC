/* ==========================================================================
   應用外殼
   --------------------------------------------------------------------------
   取代舊的 2400 行 script.js。舊版用模板字串拼 HTML、手工管理重繪，
   模組一多就難維護；這裡改成元件 + 反應式狀態：筛選一變，用到它的模組
   自己重算，不需要任何重繪管線。

   外殼包含：
     宿主佔位   左側選單與頂欄代表既有瞰車大系統，不是本次開發範圍
     看板列     看板切換、工具列、同步時間
     畫布       卡位網格與拖動排序
     模組庫     可加入看板的模組
     二層抽屉   點擊圖表物件後的摘要
   ========================================================================== */

(function (KCD) {
    'use strict';

    const { createApp, ref, reactive, computed, watch, onMounted, nextTick } = Vue;
    const D = KCD.data;

    const STORE_KEY = 'kcd_dashboard_state_v2';

    /* ======================================================================
       分享連結
       ----------------------------------------------------------------------
       把看板設定編碼進 URL 的 hash。用 hash 而不是 query 的兩個理由：
         1. hash 不會送到伺服器，投影連結貼到哪裡都不會外洩參數
         2. file:// 下 query 會被部分瀏覽器忽略，hash 不會 —— 這份原型要能雙擊開啟

       btoa 只吃 Latin-1，看板名稱有中文會直接丟 InvalidCharacterError，
       因此先用 TextEncoder 轉成 UTF-8 位元組再編碼。
       ====================================================================== */

    function b64encode(text) {
        const bytes = new TextEncoder().encode(text);
        let bin = '';
        // 不用 String.fromCharCode(...bytes)：展開大陣列會爆呼叫堆疊
        bytes.forEach(b => { bin += String.fromCharCode(b); });
        return btoa(bin);
    }

    function b64decode(b64) {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new TextDecoder().decode(bytes);
    }

    /** 從 URL 讀出分享設定。格式錯誤一律回 null，不讓壞連結把整頁弄掛。 */
    function readShare() {
        const m = /[#&?]share=([^&]+)/.exec(location.hash || '');
        if (!m) return null;
        try {
            const data = JSON.parse(b64decode(decodeURIComponent(m[1])));
            return data && data.board && Array.isArray(data.layout) ? data : null;
        } catch (e) {
            console.warn('[KCD] 分享連結解析失敗，忽略：', e.message);
            return null;
        }
    }

    // 在 setup 之前判定：分享模式要影響初始狀態，不能等元件掛載後再切
    const SHARED = readShare();

    // 六張業務看板的骨架。模組逐一重做後填進 widgets。
    const BOARDS = [
        { id: 'std_fleet_status', name: '車隊運行狀態', icon: 'truck' },
        { id: 'std_fleet_usage', name: '車隊使用率', icon: 'gauge' },
        { id: 'std_driver_score', name: '駕駛行為評分', icon: 'shield-alert' },
        { id: 'std_exception_notice', name: '異常通報', icon: 'triangle-alert' },
        { id: 'std_alcohol', name: '酒測管理動態', icon: 'flask-conical' },
        { id: 'std_temperature', name: '溫度管理動態', icon: 'thermometer-sun' }
    ];

    // 各看板的預設佈局。
    //
    // 排列順序即版面：畫布是 12 欄 × 64px 列高的網格，自動流佈局會把模組依序
    // 填進第一個放得下的位置。因此「左欄 → 中央大圖 → 右欄 → 左欄 → 右欄」
    // 這個順序會自然排出參考圖的三欄結構（中央的 V 規格佔 8 列高，左右兩側
    // 各疊兩個 4 列高的 S），不需要顯式指定格線位置。
    const DEFAULT_LAYOUT = {
        // 車隊運行狀態：頂部 KPI 帶，中段三欄（左側兩張疊、中央地圖直立、右側兩張疊），
        // 底部滿寬明細表。順序即版面，見上方說明。
        std_fleet_status: [
            { id: 'ops-overview', size: 'W' },
            { id: 'ops-donut', size: 'S' },
            { id: 'ops-map', size: 'V' },
            { id: 'ops-attention', size: 'S' },
            { id: 'ops-rank', size: 'S' },
            { id: 'ops-trend', size: 'S' },
            { id: 'ops-table', size: 'L' }
        ],
        std_exception_notice: [
            { id: 'exception-overview', size: 'W' },
            { id: 'exception-objects', size: 'M' },
            { id: 'exception-events', size: 'M' },
            { id: 'exception-matrix', size: 'L' }
        ],
        /* 車隊使用率：完全照客戶提供的使用率看板參考圖。
           順序造出三欄結構 —— 左欄環圖疊區間分布、中央地圖直立佔 8 列、
           右欄 Top5 疊低於目標，底部滿寬明細表。 */
        std_fleet_usage: [
            { id: 'util-overview', size: 'W' },
            { id: 'util-donut', size: 'S' },
            { id: 'util-map', size: 'V' },
            { id: 'util-top', size: 'S' },
            { id: 'util-bands', size: 'S' },
            { id: 'util-below', size: 'S' },
            { id: 'util-table', size: 'L' }
        ],
        /* 駕駛行為評分：頂部 KPI 帶，中段左欄等級儀表疊風險構成、中央啞鈴圖
           佔滿 M 寬、右欄績優疊風險，底部滿寬明細表。
           啞鈴圖是本看板的主視覺 —— V7 要求同時看本週與上週。 */
        std_driver_score: [
            { id: 'score-overview', size: 'W' },
            { id: 'score-gauge', size: 'S' },
            { id: 'score-move', size: 'M' },
            { id: 'score-up', size: 'S' },
            { id: 'score-factors', size: 'S' },
            { id: 'score-down', size: 'S' },
            { id: 'score-trend', size: 'S' },
            { id: 'score-table', size: 'L' }
        ],
        /* 酒測管理：頂部 KPI 帶（不通過與未吹可直接點進既有查詢頁），
           中段左欄環圖疊趨勢、中央站所構成佔 M 寬、右欄兩個人員排行，
           底部滿寬明細表。人員排行放右欄 —— 值班的人最常看的就是「要追誰」。 */
        std_alcohol: [
            { id: 'alc-overview', size: 'W' },
            { id: 'alc-donut', size: 'S' },
            { id: 'alc-stations', size: 'M' },
            { id: 'alc-fails', size: 'S' },
            { id: 'alc-trend', size: 'S' },
            { id: 'alc-misses', size: 'S' },
            { id: 'alc-table', size: 'L' }
        ],
        /* 溫度管理：三個場域各自獨立成線。
           頂部總覽帶 → 三個場域狀態環並排 → 負擔排名＋合規趨勢＋設備健康
           → 三張異常累計分析各佔滿寬。
           三條線的模組結構刻意相同，使用者學一次能讀三個場域。 */
        std_temperature: [
            { id: 'tmp-overview', size: 'W' },
            { id: 'tmp-best', size: 'W' },
            { id: 'tmp-vehicle-status', size: 'S' },
            { id: 'tmp-warehouse-status', size: 'S' },
            { id: 'tmp-mobile-status', size: 'S' },
            { id: 'tmp-burden', size: 'S' },
            { id: 'tmp-devices', size: 'M' },
            { id: 'tmp-trend', size: 'S' },
            { id: 'tmp-vehicle-top', size: 'L' },
            { id: 'tmp-warehouse-top', size: 'L' },
            { id: 'tmp-mobile-top', size: 'L' }
        ]
    };

    function normalizeWidget(widget) {
        const module = widget && KCD.modules[widget.id];
        if (!module) return null;
        const sizes = Array.isArray(module.sizes) && module.sizes.length ? module.sizes : ['M'];
        return {
            id: widget.id,
            size: sizes.includes(widget.size) ? widget.size : sizes[0]
        };
    }

    function loadState() {
        try {
            return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
        } catch (e) {
            return {};
        }
    }

    function saveState(state) {
        localStorage.setItem(STORE_KEY, JSON.stringify(state));
    }

    const App = {
        components: {},
        setup() {
            // 分享頁是獨立的只讀快照，不讀取接收者本機曾存過的看板設定。
            const isShared = !!SHARED;
            const stored = isShared ? {} : loadState();
            const sharedBoard = isShared ? {
                id: 'shared_' + (SHARED.board.id || 'board'),
                name: SHARED.board.name || '分享看板',
                icon: SHARED.board.icon || 'layout-template'
            } : null;

            const initialTheme = isShared ? SHARED.theme : stored.theme;
            const theme = ref(KCD.theme.ids.includes(initialTheme) ? initialTheme : KCD.theme.default);
            const boardId = ref(sharedBoard
                ? sharedBoard.id
                : (BOARDS.some(b => b.id === stored.boardId) ? stored.boardId : 'std_fleet_status'));
            const editMode = ref(false);
            const filters = reactive(Object.assign({}, D.DEFAULT_FILTERS, isShared ? SHARED.filters : stored.filters));
            const syncedAt = ref(isShared && SHARED.syncedAt ? SHARED.syncedAt : '');
            const syncing = ref(false);

            // 佈局：每張看板一組 { id, size }。只保留已註冊的模組，
            // 這樣舊的 localStorage 不會把已刪模組帶回來。
            //
            // 過濾後若整張看板變空，回落到預設佈局：模組改名或重做時，
            // 舊 localStorage 會把該看板清成空的，使用者不該因此永久看到空看板。
            const layouts = reactive({});
            const storedLayouts = stored.layouts || {};
            BOARDS.forEach(b => {
                const keep = (storedLayouts[b.id] || []).map(normalizeWidget).filter(Boolean);
                const fallback = (DEFAULT_LAYOUT[b.id] || []).map(normalizeWidget).filter(Boolean);
                layouts[b.id] = keep.length ? keep : fallback.slice();
            });
            // 自訂看板的佈局同樣還原。自訂看板允許為空，因此不做回落。
            Object.keys(storedLayouts).forEach(id => {
                if (layouts[id]) return;
                layouts[id] = storedLayouts[id].map(normalizeWidget).filter(Boolean);
            });
            if (sharedBoard) {
                layouts[sharedBoard.id] = SHARED.layout.map(normalizeWidget).filter(Boolean);
            }

            const openPanel = ref('');   // '' | 'board' | 'filter' | 'theme' | 'config'
            const openSlotMenu = ref(-1);  // 展開中的模組操作選單索引
            const libraryOpen = ref(false);
            // 模組庫批次選取：{ [moduleId]: size } —— 使用者可以一次勾多個，最後一起提交。
            const libraryPicks = reactive({});
            const detail = ref(null);
            // focus-mode 是舊 style.css 那整套全螢幕細節處理的開關：
            // 收起側邊欄與頂欄、壓縮看板列、隱藏編輯操作件。掛在 body 上。
            const focusMode = ref(false);

            // 釘選到快捷區的看板。舊原型上限 6 個，沿用。
            const pinnedIds = ref(Array.isArray(stored.pinnedIds) && stored.pinnedIds.length
                ? stored.pinnedIds
                : ['std_fleet_status', 'std_exception_notice']);

            // 自訂看板：對應舊原型的「我的看板 / 新建看板 / 另存副本」。
            const customBoards = ref(sharedBoard
                ? [sharedBoard]
                : (Array.isArray(stored.customBoards) ? stored.customBoards : []));
            const allBoards = computed(() => BOARDS.concat(customBoards.value));
            const board = computed(() => allBoards.value.find(b => b.id === boardId.value) || BOARDS[0]);
            const boardName = computed(() => board.value.name);

            // 企業 Logo 與預設看板：對應舊原型的「設定」面板。
            const branding = reactive(Object.assign(
                { logo: 'logo.png', visible: true },
                isShared ? SHARED.branding : stored.branding
            ));
            const defaultBoardId = ref(stored.defaultBoardId || 'std_fleet_status');
            const nameDraft = ref('');
            watch(board, b => { nameDraft.value = b.name; }, { immediate: true });

            // 快捷看板的由左至右順序就是輪播順序，不另建第二套排序規則。
            const validRotationMinutes = [0, 5, 10];
            const rotationMinutes = ref(validRotationMinutes.includes(Number(stored.rotationMinutes))
                ? Number(stored.rotationMinutes)
                : 0);
            let rotationTimer = null;

            function rotateBoard() {
                const ordered = pinnedBoards.value;
                if (ordered.length < 2) return;
                const currentIndex = ordered.findIndex(b => b.id === boardId.value);
                const next = ordered[(currentIndex + 1 + ordered.length) % ordered.length];
                if (next) switchBoard(next.id);
            }

            function scheduleRotation() {
                if (rotationTimer) {
                    window.clearInterval(rotationTimer);
                    rotationTimer = null;
                }
                if (isShared || !rotationMinutes.value || pinnedBoards.value.length < 2) return;
                rotationTimer = window.setInterval(rotateBoard, rotationMinutes.value * 60 * 1000);
            }

            const createBoardOpen = ref(false);
            const createBoardName = ref('');
            const shareOpen = ref(false);
            const shareCopied = ref(false);

            const slots = computed(() => layouts[boardId.value] || []);
            const scopeLabel = computed(() => D.getBranchScope(filters) || '全公司');
            // 展示模式篩選條右側的日期範圍，隨期間切換
            const periodRange = computed(() => D.periodRange(filters.time));

            const allModules = computed(() => Object.values(KCD.modules));

            function openCreateBoard() {
                createBoardName.value = '';
                createBoardOpen.value = true;
                openPanel.value = '';
            }

            function createBoard() {
                const name = createBoardName.value.trim();
                if (!name) return;
                const id = 'custom_' + Date.now();
                customBoards.value = customBoards.value.concat([{
                    id, name, icon: 'layout-template'
                }]);
                layouts[id] = [];
                boardId.value = id;
                createBoardOpen.value = false;
                openPanel.value = '';
            }

            function saveAsCopy() {
                const id = 'custom_' + Date.now();
                customBoards.value = customBoards.value.concat([{
                    id, name: boardName.value + ' 副本', icon: 'layout-template'
                }]);
                layouts[id] = JSON.parse(JSON.stringify(slots.value));
                boardId.value = id;
                openPanel.value = '';
            }

            function uploadLogo(event) {
                const file = event.target.files && event.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => { branding.logo = reader.result; };
                reader.readAsDataURL(file);
            }

            function saveConfig() {
                const name = nameDraft.value.trim();
                if (name) {
                    const hit = customBoards.value.find(b => b.id === boardId.value);
                    if (hit) {
                        customBoards.value = customBoards.value.map(b =>
                            (b.id === boardId.value ? Object.assign({}, b, { name }) : b));
                    } else {
                        // 標準看板改名：存成覆寫，不動 BOARDS 常量。
                        const std = BOARDS.find(b => b.id === boardId.value);
                        if (std) std.name = name;
                    }
                }
                scheduleRotation();
                openPanel.value = '';
            }

            function stamp() {
                const d = new Date();
                syncedAt.value = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
            }

            function sync() {
                syncing.value = true;
                setTimeout(() => {
                    stamp();
                    // 手動同步立刻推進一輪資料，數字才會跟著滾動
                    KCD.motion.pulse.value++;
                    syncing.value = false;
                }, 600);
            }

            function setTheme(id) {
                theme.value = KCD.theme.apply(id);
                openPanel.value = '';
            }

            function switchBoard(id) {
                boardId.value = id;
                openPanel.value = '';
            }

            function togglePanel(name) {
                openPanel.value = openPanel.value === name ? '' : name;
            }

            function addModule(moduleId, size) {
                layouts[boardId.value] = layouts[boardId.value].concat([{ id: moduleId, size }]);
                libraryOpen.value = false;
            }

            function libraryPickKey(moduleId, size) {
                return moduleId + '::' + size;
            }

            function isLibraryPicked(moduleId, size) {
                return !!libraryPicks[libraryPickKey(moduleId, size)];
            }

            function toggleLibraryPick(moduleId, size) {
                const key = libraryPickKey(moduleId, size);
                if (libraryPicks[key]) delete libraryPicks[key];
                else libraryPicks[key] = { id: moduleId, size };
            }

            const libraryPickCount = computed(() => Object.keys(libraryPicks).length);

            function clearLibraryPicks() {
                Object.keys(libraryPicks).forEach(key => delete libraryPicks[key]);
            }

            function addSelectedModules() {
                const picks = Object.values(libraryPicks);
                if (!picks.length) return;
                layouts[boardId.value] = layouts[boardId.value].concat(picks);
                clearLibraryPicks();
                libraryOpen.value = false;
            }

            function removeModule(index) {
                layouts[boardId.value] = layouts[boardId.value].filter((_, i) => i !== index);
                openSlotMenu.value = -1;
            }

            function resizeModule(index, size) {
                layouts[boardId.value] = layouts[boardId.value].map((w, i) =>
                    (i === index ? Object.assign({}, w, { size }) : w));
                openSlotMenu.value = -1;
            }

            function moduleOf(id) {
                return KCD.modules[id];
            }

            function onPick(payload) {
                detail.value = payload;
            }

            function resetAll() {
                localStorage.removeItem(STORE_KEY);
                location.reload();
            }

            const shareUrl = computed(() => {
                const payload = {
                    v: 1,
                    board: { id: board.value.id, name: boardName.value, icon: board.value.icon },
                    layout: slots.value.map(w => ({ id: w.id, size: w.size })),
                    branding: { logo: branding.logo, visible: branding.visible },
                    theme: theme.value,
                    filters: Object.assign({}, filters),
                    syncedAt: syncedAt.value
                };
                return location.href.split('#')[0] + '#share=' + encodeURIComponent(b64encode(JSON.stringify(payload)));
            });

            async function copyShareLink() {
                try {
                    if (navigator.clipboard && window.isSecureContext) {
                        await navigator.clipboard.writeText(shareUrl.value);
                    } else {
                        const input = document.createElement('textarea');
                        input.value = shareUrl.value;
                        input.style.position = 'fixed';
                        input.style.opacity = '0';
                        document.body.appendChild(input);
                        input.select();
                        document.execCommand('copy');
                        input.remove();
                    }
                    shareCopied.value = true;
                    window.setTimeout(() => { shareCopied.value = false; }, 1600);
                } catch (e) {
                    console.warn('[KCD] 無法複製分享連結：', e.message);
                }
            }

            function openShareDemo() {
                window.open(shareUrl.value, '_blank', 'noopener');
            }

            function toggleFullscreen() {
                const next = !focusMode.value;
                if (next) {
                    // 進全螢幕預設回展示態：大屏是給人看的，不是給人編輯的。
                    editMode.value = false;
                    focusMode.value = true;
                    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
                        document.documentElement.requestFullscreen().catch(() => {});
                    }
                } else {
                    focusMode.value = false;
                    if (document.fullscreenElement && document.exitFullscreen) {
                        document.exitFullscreen().catch(() => {});
                    }
                }
            }

            // 快捷切換列：只顯示已釘選的看板，對應下拉裡的星星。
            const pinnedBoards = computed(() =>
                pinnedIds.value.map(id => allBoards.value.find(b => b.id === id)).filter(Boolean));

            const isPinned = id => pinnedIds.value.includes(id);

            function togglePin(id) {
                if (isPinned(id)) {
                    pinnedIds.value = pinnedIds.value.filter(x => x !== id);
                } else {
                    // 上限 6 個，沿用舊原型：再多快捷列就要橫向滾動，失去「快捷」的意義。
                    if (pinnedIds.value.length >= 6) return;
                    pinnedIds.value = pinnedIds.value.concat([id]);
                }
            }

            function deleteBoard(id) {
                customBoards.value = customBoards.value.filter(b => b.id !== id);
                pinnedIds.value = pinnedIds.value.filter(x => x !== id);
                delete layouts[id];
                if (boardId.value === id) boardId.value = 'std_fleet_status';
            }

            function toggleSlotMenu(index) {
                openSlotMenu.value = openSlotMenu.value === index ? -1 : index;
            }

            function duplicateModule(index) {
                const src = layouts[boardId.value][index];
                const list = layouts[boardId.value].slice();
                list.splice(index + 1, 0, Object.assign({}, src));
                layouts[boardId.value] = list;
                openSlotMenu.value = -1;
            }

            /* 模組庫分類：暫時直接以「所屬看板」分組。
               模組數量會長到 20 個以上，用業務類別分（營運／安全／溫度）看不出
               某個模組是哪張看板要用的；重做期間更需要的是這個對應關係。
               模組在註冊時宣告 board，這裡直接由 BOARDS 生成分類，不另維護清單。 */
            const CATEGORIES = computed(() =>
                [{ key: 'all', label: '全部' }].concat(BOARDS.map(b => ({ key: b.id, label: b.name }))));

            const librarySearch = ref('');
            const libraryCategory = ref('all');
            const categories = CATEGORIES;

            function setLibraryCategory(key) {
                libraryCategory.value = key;
            }

            const libraryList = computed(() => {
                const q = librarySearch.value.trim().toLowerCase();
                return allModules.value.filter(m => {
                    if (libraryCategory.value !== 'all' && m.board !== libraryCategory.value) return false;
                    if (!q) return true;
                    return (m.title + ' ' + m.desc).toLowerCase().includes(q);
                });
            });

            /** 模組所屬看板的名稱，顯示在模組卡的角落。 */
            function boardLabelOf(id) {
                const hit = BOARDS.find(b => b.id === id);
                return hit ? hit.name : '未指定看板';
            }

            const SIZE_LABEL = {
                W: '帶狀 · 滿寬 140px',
                S: '小型 · 三分之一寬 292px',
                M: '中型 · 二分之一寬 292px',
                V: '豎型 · 三分之一寬 596px',
                L: '大型 · 滿寬 444px'
            };
            const SIZE_SHORT = { W: '帶', S: '小', M: '中', V: '豎', L: '大' };
            const SIZE_ICON = { W: 'rows-3', S: 'square', M: 'rectangle-horizontal', V: 'rectangle-vertical', L: 'layout-grid' };

            // body 上的兩個狀態類，舊 style.css 有整套對應規則，必須同步掛上。
            watch(focusMode, v => document.body.classList.toggle('focus-mode', v), { immediate: true });
            watch(editMode, v => document.body.classList.toggle('is-editing-mode', v), { immediate: true });

            // 使用者按 Esc 退出瀏覽器全螢幕時，focus-mode 要跟著解除。
            function onFsChange() {
                if (!document.fullscreenElement) focusMode.value = false;
            }

            // 持久化。theme 由 KCD.theme 掛 class，這裡只存選擇。
            watch([theme, boardId, filters, layouts, customBoards, branding, defaultBoardId, pinnedIds, rotationMinutes], () => {
                if (isShared) return;
                saveState({
                    theme: theme.value,
                    boardId: boardId.value,
                    filters: Object.assign({}, filters),
                    layouts: JSON.parse(JSON.stringify(layouts)),
                    customBoards: JSON.parse(JSON.stringify(customBoards.value)),
                    branding: Object.assign({}, branding),
                    defaultBoardId: defaultBoardId.value,
                    pinnedIds: pinnedIds.value.slice(),
                    rotationMinutes: rotationMinutes.value
                });
            }, { deep: true });

            watch([rotationMinutes, pinnedIds], scheduleRotation, { deep: true, immediate: true });

            // 圖示：Lucide 以 data-lucide 屬性掃描 DOM，Vue 每次重繪都要重掃。
            function paintIcons() {
                if (window.lucide) window.lucide.createIcons();
            }
            watch([boardId, slots, editMode, libraryOpen, detail, openPanel, filters],
                () => nextTick(paintIcons), { deep: true });

            let sortable = null;
            const canvas = ref(null);
            watch([editMode, boardId], () => {
                nextTick(() => {
                    if (sortable) { sortable.destroy(); sortable = null; }
                    if (!editMode.value || !canvas.value) return;
                    sortable = window.Sortable.create(canvas.value, {
                        draggable: '.board-slot',
                        handle: '.board-slot-grip',
                        animation: 160,
                        ghostClass: 'board-slot-ghost',
                        chosenClass: 'board-slot-chosen',
                        dragClass: 'board-slot-dragging',
                        onEnd(evt) {
                            const list = layouts[boardId.value].slice();
                            list.splice(evt.newIndex, 0, list.splice(evt.oldIndex, 1)[0]);
                            layouts[boardId.value] = list;
                        }
                    });
                });
            }, { immediate: true });

            // Alt + 1~6 切換釘選的看板，沿用舊原型的快捷鍵
            function onKeydown(event) {
                if (!event.altKey) return;
                const n = parseInt(event.key, 10);
                if (!n || n < 1 || n > 6) return;
                const target = pinnedBoards.value[n - 1];
                if (target) {
                    event.preventDefault();
                    switchBoard(target.id);
                }
            }

            onMounted(() => {
                KCD.theme.apply(theme.value);
                if (!isShared) stamp();
                paintIcons();
                /* 模擬即時取數：每 6 秒推進一輪，數字小幅波動並滾動。
                   這是原型的演示手段，不是業務邏輯 —— 正式接入改為訂閱後端推送。
                   6 秒是刻意選的：太快像壞了，太慢又看不出在動。 */
                KCD.motion.startPulse(6000);
                document.addEventListener('fullscreenchange', onFsChange);
                document.addEventListener('keydown', onKeydown);
                // 點空白處收起所有下拉與模組選單
                document.addEventListener('click', () => {
                    openPanel.value = '';
                    openSlotMenu.value = -1;
                });
            });

            return {
                theme, themes: KCD.theme.list, setTheme,
                boards: BOARDS, customBoards, allBoards, board, boardName, boardId, switchBoard,
                pinnedBoards, isPinned, togglePin, openCreateBoard, createBoard, createBoardOpen, createBoardName, saveAsCopy, deleteBoard,
                branding, defaultBoardId, nameDraft, uploadLogo, saveConfig, rotationMinutes,
                editMode, focusMode, filters, filterFields: D.FILTER_FIELDS,
                filterOrder: D.FILTER_ORDER, periodRange, scopeLabel,
                syncedAt, syncing, sync,
                openPanel, togglePanel,
                openSlotMenu, toggleSlotMenu, duplicateModule,
                libraryOpen, allModules, addModule, removeModule, resizeModule,
                libraryPicks, libraryPickCount, isLibraryPicked, toggleLibraryPick, clearLibraryPicks, addSelectedModules,
                librarySearch, libraryCategory, categories,
                setLibraryCategory, libraryList, boardLabelOf,
                sizeLabel: s => SIZE_LABEL[s] || s,
                sizeShort: s => SIZE_SHORT[s] || s,
                sizeIcon: s => SIZE_ICON[s] || 'square',
                slots, moduleOf, canvas,
                detail, onPick,
                isShared, shareOpen, shareUrl, shareCopied, copyShareLink, openShareDemo,
                resetAll, toggleFullscreen
            };
        },

    };

    const app = createApp(App);
    // prod 建置會剝掉 Vue 的警告，元件內的渲染錯誤會安靜地渲染成空白 —— 曾因此
    // 漏掉一個 setup 未回傳變數的錯誤。掛上處理器讓這類問題一律浮出。
    app.config.errorHandler = (err, instance, info) => {
        console.error('[KCD] 元件錯誤：', (instance && instance.$options && instance.$options.name) || '?', info, err);
    };
    app.component('KcdChart', KCD.charts.Chart);
    app.mount('#app');
})(window.KCD);
