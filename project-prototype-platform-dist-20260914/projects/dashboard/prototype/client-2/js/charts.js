/* ==========================================================================
   ECharts 接入層
   --------------------------------------------------------------------------
   提供兩件東西：
     KCD.charts.Chart    一個 Vue 元件，負責 init / resize / dispose / 換主題重繪
     KCD.charts.base()   共用的 option 骨架，統一字體、tooltip、網格與座標軸樣式

   為什麼要包一層：ECharts 是命令式的，直接在元件裡寫 init 會漏掉三件事 ——
   容器尺寸變化沒有 resize、元件卸載沒有 dispose、換主題沒有重繪。
   這三個在看板上都會出事（卡位可拖動、主題可切換），所以集中處理一次。
   ========================================================================== */

(function (KCD) {
    'use strict';

    const { ref, onMounted, onBeforeUnmount, watch, h } = Vue;

    /* 系統偏好「減少動態效果」時，圖表動效一律關閉。
       CSS 那邊由 tokens.css 的 media query 處理，canvas 內的動畫 CSS 管不到，
       必須在 option 層關掉。狀態資訊本身不依賴動畫傳達，因此關掉不損失語義。 */
    const reduceMotion = () =>
        window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /** 共用 option 骨架。各模組只需要補 series 與軸的資料部分。 */
    function base() {
        const t = KCD.theme.tokens();
        const still = reduceMotion();
        return {
            /* 動效分兩類，職責不同：
                 進場／換資料  一次性，讓人看出「數字動了」。逐項錯開 60ms，
                               圖表像被依序點亮，而不是整塊瞬間跳出。
                 持續循環      只給未解除的告警（Ping、漣漪），是狀態本身。
               兩者都不能延遲讀數，因此進場總時長控制在 1 秒內。 */
            animation: !still,
            animationDuration: 560,
            animationEasing: 'cubicOut',
            animationDelay: idx => idx * 60,
            // 資料更新用較短的時長：換筛選時要立刻看到新值，不能等動畫。
            animationDurationUpdate: 320,
            animationEasingUpdate: 'cubicInOut',
            textStyle: {
                fontFamily: t['fx-font-ui'],
                color: t['ink-2'],
                fontSize: t['fs-chart-label']
            },
            grid: {
                left: 2, right: 2, top: 8, bottom: 2,
                containLabel: true
            },
            tooltip: {
                // 懸停要給完整資訊：物件全名、指標值、單位。
                backgroundColor: t['sf-chrome'],
                borderColor: t['ln-card'],
                borderWidth: 1,
                padding: [8, 10],
                textStyle: { color: t['ink-1'], fontSize: t['fs-chart-tip'], fontFamily: t['fx-font-ui'] },
                extraCssText: 'border-radius:' + (t['fx-r-inner'] || '6px') + ';box-shadow:0 8px 24px rgba(0,0,0,.28);'
            }
        };
    }

    /** 座標軸的統一樣式：細網格、無軸線、標籤用次級文字色。 */
    function axis(t, opts) {
        opts = opts || {};
        return {
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: {
                color: t['ink-3'],
                fontSize: t['fs-chart-axis'],
                fontFamily: opts.numeric ? t['fx-font-num'] : t['fx-font-ui']
            },
            splitLine: {
                show: !!opts.grid,
                lineStyle: { color: t['ln-hair'], width: 1 }
            }
        };
    }

    const Chart = {
        name: 'KcdChart',
        props: {
            // 完整的 ECharts option。父元件負責在 token 變更時重新計算。
            option: { type: Object, required: true },
            // 傳入後隨之重繪；用於筛選、周期等會改變資料的情境。
            height: { type: [Number, String], default: '100%' }
        },
        emits: ['pick'],
        setup(props, { emit }) {
            const el = ref(null);
            let inst = null;

            function draw() {
                if (!inst) return;
                // notMerge: true —— series 數量會隨筛選變化，合併會留下舊系列。
                inst.setOption(props.option, true);
            }

            function onThemeChange() {
                if (!inst) return;
                // token 已由 KCD.theme.apply 失效，重算 option 由父元件的
                // computed 觸發；這裡只需要讓 ECharts 重新吃一次。
                draw();
            }

            let ro = null;
            onMounted(() => {
                inst = echarts.init(el.value, null, { renderer: 'canvas' });
                draw();
                inst.on('click', params => emit('pick', params));
                // 卡位可拖動、可換規格，容器尺寸會變，必須觀察容器而不是 window。
                ro = new ResizeObserver(() => inst && inst.resize());
                ro.observe(el.value);
                window.addEventListener('kcd:theme-changed', onThemeChange);
            });

            onBeforeUnmount(() => {
                window.removeEventListener('kcd:theme-changed', onThemeChange);
                if (ro) ro.disconnect();
                if (inst) inst.dispose();
                inst = null;
            });

            watch(() => props.option, draw, { deep: true });

            return () => h('div', {
                ref: el,
                class: 'kcd-chart',
                style: {
                    width: '100%',
                    height: typeof props.height === 'number' ? props.height + 'px' : props.height
                }
            });
        }
    };

    /* ----------------------------------------------------------------------
       圖表層的持續動效
       ----------------------------------------------------------------------
       進場動畫只播一次，圖表本身仍是靜的。以下三個 helper 讓圖表內部也動：

       pulseDot(t, coord)  在指定座標放一顆持續脈動的點。用於折線最新值、
                           地圖需注意的對象 —— 表達「這一點還在更新」。
       flowLine(t, hex)    折線用流動漸層描邊，暗示資料在推進。
       glowBar(t, hex)     長條端點加輝光，讓條看起來是「亮起來」而非塗上去。

       全部尊重 reduced-motion：關閉時回傳靜態版本而不是空物件，
       否則圖表會少掉一整層資料。
       ---------------------------------------------------------------------- */

    /** #RRGGBB → rgba()。ECharts 的陰影與漸層需要帶 alpha 的色值。 */
    function fade(hex, alpha) {
        const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex).trim());
        if (!m) return hex;
        return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ','
            + parseInt(m[3], 16) + ',' + alpha + ')';
    }

    /** 持續脈動的單點。coord 為 [x, y]，color 為十六進位。 */
    function pulseDot(coord, color, opts) {
        opts = opts || {};
        const still = reduceMotion();
        return {
            type: still ? 'scatter' : 'effectScatter',
            symbolSize: opts.size || 7,
            rippleEffect: { scale: opts.scale || 3.2, brushType: 'stroke', number: 2 },
            showEffectOn: 'render',
            silent: true,
            itemStyle: { color: color },
            z: opts.z || 3,
            data: [coord]
        };
    }

    /** 折線的流動描邊。ECharts 不支援描邊動畫，因此用三段漸層造出「亮段」，
        亮段位置固定 —— 真正的流動由資料更新時的補間帶出來。 */
    function flowLine(color) {
        return {
            width: 2,
            color: {
                type: 'linear', x: 0, y: 0, x2: 1, y2: 0,
                colorStops: [
                    { offset: 0, color: fade(color, .55) },
                    { offset: .72, color: color },
                    { offset: 1, color: color }
                ]
            },
            shadowColor: fade(color, .45),
            shadowBlur: 8
        };
    }

    /** 長條的端點輝光。讓條看起來是亮起來的，而不是塗上去的。 */
    function glowBar(color, radius) {
        return {
            color: color,
            borderRadius: radius || [0, 4, 4, 0],
            shadowColor: fade(color, .5),
            shadowBlur: 6,
            shadowOffsetX: 1
        };
    }

    KCD.charts = { Chart, base, axis, reduceMotion, fade, pulseDot, flowLine, glowBar };
})(window.KCD);
