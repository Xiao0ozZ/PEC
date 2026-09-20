/* ==========================================================================
   駕駛行為評分看板 — M03 系列
   --------------------------------------------------------------------------
   依據 V7 第 7、8 頁：
     總公司／區主管  車隊分數、安全績優／風險預警分公司、行為績優／風險排名
     分公司／員工    同上，但排名對象換成駕駛員

   V7 明確要求排名區塊呈現「本週分數、上週分數、名次升降幾名、分數差異與
   漲跌幅」，因此排名不是單純的長條，而是帶名次變化的對照。

   V7 開發總表註明本看板「點擊開啟既有功能分頁」，沒有第二層彈窗；
   因此各模組的點擊一律走 detail_page 語義（原型先以摘要抽屉佔位）。

   分數、等級、排名與名次升降全部由後端回傳，前端不重新推斷。
   ========================================================================== */

(function (KCD) {
    'use strict';

    const { computed } = Vue;
    const D = KCD.data;
    const M = KCD.motion;

    const BANDS = D.SCORE_BANDS;
    const bandOf = v => D.bandOf(BANDS, v);

    function buildData(filters) {
        const scope = D.getBranchScope(filters);
        const isBranch = Boolean(scope);
        const tick = M.pulse.value;

        const src = isBranch ? D.SCORE_DRIVERS : D.SCORE_STATIONS;
        const rows = src.map(r => {
            // 分數小幅波動並收在 0~100
            const score = Math.max(0, Math.min(100, M.jitter(r.score, r.name + 's', .015)));
            return Object.assign({}, r, {
                score,
                diff: Math.round((score - r.prev) * 10) / 10,
                // 名次升降：正值代表進步幾名
                move: r.rankPrev - r.rank,
                band: bandOf(score)
            });
        });

        const byScore = [...rows].sort((a, b) => b.score - a.score);
        const avg = rows.length
            ? Math.round((rows.reduce((s, r) => s + r.score, 0) / rows.length) * 10) / 10
            : 0;
        const prevAvg = rows.length
            ? Math.round((rows.reduce((s, r) => s + r.prev, 0) / rows.length) * 10) / 10
            : 0;

        return {
            isBranch,
            scopeLabel: isBranch ? scope : '全公司',
            objectLabel: isBranch ? '駕駛' : '分公司',
            avg,
            prevAvg,
            delta: Math.round((avg - prevAvg) * 10) / 10,
            band: bandOf(avg),
            rows: byScore,
            best: byScore[0] || null,
            worst: byScore[byScore.length - 1] || null,
            // 依名次升降取進步最多與退步最多
            climbers: [...rows].sort((a, b) => b.move - a.move).slice(0, 3),
            fallers: [...rows].sort((a, b) => a.move - b.move).slice(0, 3),
            atRisk: rows.filter(r => r.score < 70).length,
            total: rows.length
        };
    }

    /* ---------------------------------------------------------------------
       M03-1 車隊評分總覽（W）
       --------------------------------------------------------------------- */
    const ScoreOverview = {
        name: 'ScoreOverview',
        props: { filters: { type: Object, required: true }, size: { type: String, default: 'W' } },
        setup(props) {
            const data = computed(() => buildData(props.filters));
            const shownAvg = M.useTween(() => data.value.avg, { decimals: 1 });
            const shownRisk = M.useTween(() => data.value.atRisk);
            const bumped = M.useBump(() => data.value.avg);
            return { data, shownAvg, shownRisk, bumped };
        },
        template: `
            <div class="ds-panel score-kpi m-scan">
                <div class="score-kpi-row">
                    <div class="score-kpi-cell is-lead" :class="'is-band-' + data.band.token">
                        <span class="score-kpi-label"><i class="m-live"></i>車隊平均分數</span>
                        <span class="score-kpi-val">
                            <strong class="m-beat" :class="{ 'm-bump': bumped }">{{ shownAvg }}</strong><em>分</em>
                        </span>
                        <span class="score-kpi-foot">{{ data.scopeLabel }} · 等級 {{ data.band.label }}</span>
                    </div>
                    <div class="score-kpi-cell" :class="data.delta >= 0 ? 'is-normal' : 'is-critical'">
                        <span class="score-kpi-label">較上週</span>
                        <span class="score-kpi-val">
                            <strong>{{ data.delta >= 0 ? '+' : '' }}{{ data.delta }}</strong><em>分</em>
                        </span>
                        <span class="score-kpi-foot">上週 {{ data.prevAvg }} 分</span>
                    </div>
                    <div class="score-kpi-cell is-normal" v-if="data.best">
                        <span class="score-kpi-label"><i data-lucide="award"></i>安全績優</span>
                        <span class="score-kpi-val is-object">
                            <strong>{{ data.best.name }}</strong>
                        </span>
                        <span class="score-kpi-foot">{{ data.best.score }} 分 · {{ data.objectLabel }}</span>
                    </div>
                    <div class="score-kpi-cell is-critical" v-if="data.worst">
                        <span class="score-kpi-label"><i data-lucide="triangle-alert"></i>風險預警</span>
                        <span class="score-kpi-val is-object">
                            <strong>{{ data.worst.name }}</strong>
                        </span>
                        <span class="score-kpi-foot">{{ data.worst.score }} 分 · 待改善 {{ shownRisk }} 個</span>
                    </div>
                </div>
            </div>
        `
    };

    /* ---------------------------------------------------------------------
       M03-2 評分等級儀表（S）
       分段等級環：把分數落在哪個等級區間畫出來。
       V7 要求「明確評分區間和風險等級」，所以環本身就是等級尺，
       不只是一個進度圈。
       --------------------------------------------------------------------- */
    const ScoreGauge = {
        name: 'ScoreGauge',
        props: { filters: { type: Object, required: true }, size: { type: String, default: 'S' } },
        setup(props) {
            const data = computed(() => buildData(props.filters));
            const shown = M.useTween(() => data.value.avg, { decimals: 1 });

            const option = computed(() => {
                const t = KCD.theme.tokens();
                const d = data.value;
                // 由低到高排出五段區間，作為儀表的底色刻度
                const asc = [...BANDS].reverse();
                const stops = asc.map((b, i) => {
                    const next = asc[i + 1];
                    const upper = next ? next.min : 100;
                    return [upper / 100, t[b.token]];
                });
                return {
                    animation: !KCD.charts.reduceMotion(),
                    animationDuration: 700,
                    animationEasing: 'cubicOut',
                    series: [{
                        type: 'gauge',
                        startAngle: 210,
                        endAngle: -30,
                        min: 0,
                        max: 100,
                        radius: '92%',
                        center: ['50%', '58%'],
                        progress: { show: false },
                        // 等級尺：五段顏色即 SCORE_BANDS
                        axisLine: { lineStyle: { width: 12, color: stops } },
                        axisTick: { show: false },
                        splitLine: { distance: -14, length: 8, lineStyle: { color: t['sf-card'], width: 2 } },
                        axisLabel: { distance: 16, color: t['ink-3'], fontSize: t['fs-chart-axis'], fontFamily: t['fx-font-num'] },
                        pointer: {
                            icon: 'path://M2,0 L-2,0 L-1,-58 L1,-58 Z',
                            length: '58%',
                            width: 5,
                            offsetCenter: [0, 0],
                            itemStyle: { color: t['ink-1'] }
                        },
                        anchor: {
                            show: true, size: 10, showAbove: true,
                            itemStyle: { color: t['ink-1'] }
                        },
                        detail: { show: false },
                        title: { show: false },
                        data: [{ value: d.avg }]
                    }]
                };
            });

            return { data, option, shown, BANDS };
        },
        template: `
            <div class="ds-panel score-gauge">
                <div class="ds-panel-head">
                    <h4>評分等級</h4>
                    <b>{{ data.scopeLabel }}</b>
                </div>
                <div class="score-gauge-body">
                    <kcd-chart :option="option" height="100%" />
                    <div class="score-gauge-read m-breathe" :class="'is-band-' + data.band.token">
                        <strong>{{ shown }}</strong>
                        <span class="ds-flag">{{ data.band.label }}</span>
                    </div>
                </div>
                <ul class="score-gauge-scale">
                    <li v-for="b in BANDS" :key="b.label">
                        <i :style="{ background: 'var(--' + b.token + ')' }"></i>{{ b.label }} {{ b.min }}+
                    </li>
                </ul>
            </div>
        `
    };

    /* ---------------------------------------------------------------------
       M03-3 名次升降（M）
       啞鈴圖：一列一個對象，左點是上週分、右點是本週分，連線長度即變化幅度。
       V7 要求同時看到本週與上週 —— 兩個獨立長條要來回比對，啞鈴一眼就看出
       「往哪邊移動、移了多少」。
       --------------------------------------------------------------------- */
    const ScoreMove = {
        name: 'ScoreMove',
        props: { filters: { type: Object, required: true }, size: { type: String, default: 'M' } },
        emits: ['pick'],
        setup(props, { emit }) {
            const data = computed(() => buildData(props.filters));

            const option = computed(() => {
                const t = KCD.theme.tokens();
                const rows = data.value.rows;
                const rev = rows.slice().reverse();
                const names = rev.map(r => r.name);

                return Object.assign(KCD.charts.base(), {
                    grid: { left: 2, right: 62, top: 6, bottom: 2, containLabel: true },
                    tooltip: Object.assign(KCD.charts.base().tooltip, {
                        trigger: 'axis',
                        axisPointer: { type: 'shadow', shadowStyle: { color: t['sf-hover'] } },
                        formatter(ps) {
                            const r = rev[ps[0].dataIndex];
                            const mv = r.move > 0 ? '上升 ' + r.move + ' 名'
                                : (r.move < 0 ? '下降 ' + Math.abs(r.move) + ' 名' : '名次持平');
                            return '<b>' + r.name + '</b><br>'
                                + '本週 ' + r.score + ' 分（上週 ' + r.prev + ' 分）<br>'
                                + '<span style="opacity:.75">'
                                + (r.diff >= 0 ? '+' : '') + r.diff + ' 分 · 第 ' + r.rank + ' 名 · ' + mv
                                + '</span>';
                        }
                    }),
                    xAxis: Object.assign(KCD.charts.axis(t, { grid: true, numeric: true }), {
                        type: 'value', min: 50, max: 100
                    }),
                    yAxis: Object.assign(KCD.charts.axis(t), {
                        type: 'category',
                        data: names,
                        axisLabel: { color: t['ink-1'], fontSize: t['fs-chart-name'], fontWeight: 600, fontFamily: t['fx-font-ui'] }
                    }),
                    series: [{
                        /* 連線用一根「從上週分起、長度為差異」的透明底＋實心段
                           堆疊條實現：ECharts 沒有原生啞鈴圖，這是最省的做法。 */
                        name: '變化',
                        type: 'bar',
                        stack: 'dumbbell',
                        barWidth: 3,
                        silent: true,
                        itemStyle: { color: 'transparent' },
                        data: rev.map(r => Math.min(r.prev, r.score) - 50)
                    }, {
                        name: '差異',
                        type: 'bar',
                        stack: 'dumbbell',
                        barWidth: 3,
                        silent: true,
                        itemStyle: {
                            color: p => (rev[p.dataIndex].diff >= 0 ? t['st-normal'] : t['st-critical']),
                            borderRadius: 2
                        },
                        data: rev.map(r => Math.abs(r.score - r.prev) || 0.4)
                    }, {
                        name: '上週',
                        type: 'scatter',
                        symbolSize: 9,
                        itemStyle: { color: t['sf-inset'], borderColor: t['ink-3'], borderWidth: 1.5 },
                        data: rev.map((r, i) => [r.prev, i])
                    }, {
                        name: '本週',
                        type: 'scatter',
                        symbolSize: 12,
                        itemStyle: { color: p => t[rev[p.dataIndex].band.token] },
                        label: {
                            show: true, position: 'right', distance: 8,
                            color: t['ink-1'], fontSize: t['fs-chart-label'], fontWeight: 700, fontFamily: t['fx-font-num'],
                            formatter(p) {
                                const r = rev[p.dataIndex];
                                const arrow = r.move > 0 ? '▲' : (r.move < 0 ? '▼' : '－');
                                return r.score + '  ' + arrow + (r.move ? Math.abs(r.move) : '');
                            }
                        },
                        data: rev.map((r, i) => [r.score, i])
                    }]
                });
            });

            const chartHeight = computed(() => Math.max(140, data.value.rows.length * 30));

            function onPick(p) {
                const r = data.value.rows.slice().reverse()[p.dataIndex];
                // V7：本看板點擊開啟既有功能分頁
                if (r) emit('pick', { type: 'score-object', name: r.name, objectLabel: data.value.objectLabel });
            }

            return { data, option, chartHeight, onPick };
        },
        template: `
            <div class="ds-panel score-move">
                <div class="ds-panel-head">
                    <h4>{{ data.objectLabel }}分數與名次變化</h4>
                    <span class="ds-legend score-move-legend">
                        <span class="is-prev">上週</span>
                        <span class="is-now">本週</span>
                    </span>
                </div>
                <p class="ds-panel-sub">點與點的距離即分數變化；右側箭頭為名次升降</p>
                <kcd-chart :option="option" :height="chartHeight" @pick="onPick" />
            </div>
        `
    };

    /* ---------------------------------------------------------------------
       M03-4／M03-5 進步與退步（S）
       同一個元件兩種模式。V7 要求「本週排名最佳／最差三名」並顯示升降幾名。
       --------------------------------------------------------------------- */
    function makeMovers(mode) {
        return {
            name: 'ScoreMovers' + mode,
            props: { filters: { type: Object, required: true }, size: { type: String, default: 'S' } },
            emits: ['pick'],
            setup(props, { emit }) {
                const data = computed(() => buildData(props.filters));
                const rows = computed(() => (mode === 'up' ? data.value.climbers : data.value.fallers));
                const spot = M.useSpotlight(() => rows.value.length, 3200);
                function pick(r) {
                    emit('pick', { type: 'score-object', name: r.name, objectLabel: data.value.objectLabel });
                }
                return { data, rows, spot, pick, mode };
            },
            template: `
                <div class="ds-panel score-movers">
                    <div class="ds-panel-head">
                        <h4>{{ mode === 'up' ? '行為績優' : '行為風險' }}{{ data.objectLabel }}</h4>
                        <b>{{ mode === 'up' ? '名次上升最多' : '名次下降最多' }}</b>
                    </div>
                    <ul class="score-movers-list">
                        <li v-for="(r, i) in rows" :key="r.name" class="m-rise" :style="{ '--i': i }"
                            :class="[{ 'is-spot': i === spot }, mode === 'up' ? 'is-normal' : 'is-critical']">
                            <button @click="pick(r)">
                                <span class="score-mover-rank">
                                    <em>{{ r.rank }}</em>
                                    <span class="score-mover-move" :class="r.move >= 0 ? 'is-up' : 'is-down'">
                                        {{ r.move > 0 ? '▲' : (r.move < 0 ? '▼' : '－') }}{{ r.move ? Math.abs(r.move) : '' }}
                                    </span>
                                </span>
                                <span class="score-mover-body">
                                    <span class="score-mover-name">{{ r.name }}</span>
                                    <span class="score-mover-meta">
                                        上週 {{ r.prev }} 分 · 第 {{ r.rankPrev }} 名
                                    </span>
                                </span>
                                <span class="score-mover-score" :class="'is-band-' + r.band.token">
                                    <strong>{{ r.score }}</strong>
                                    <span :class="r.diff >= 0 ? 'is-up' : 'is-down'">
                                        {{ r.diff >= 0 ? '+' : '' }}{{ r.diff }}
                                    </span>
                                </span>
                            </button>
                        </li>
                    </ul>
                </div>
            `
        };
    }

    /* ---------------------------------------------------------------------
       M03-6 風險行為構成（S）
       三類風險行為的堆疊構成。V7 提到雷達圖，但也明確「沒有穩定維度時
       不得為了視覺效果強行使用雷達圖」——目前後端只有三個維度，
       三軸雷達會退化成三角形，讀不出東西，因此改用堆疊條。
       --------------------------------------------------------------------- */
    const ScoreFactors = {
        name: 'ScoreFactors',
        props: { filters: { type: Object, required: true }, size: { type: String, default: 'S' } },
        setup(props) {
            const data = computed(() => buildData(props.filters));
            const factors = D.SCORE_FACTORS;

            const option = computed(() => {
                const t = KCD.theme.tokens();
                // 只取風險最高的五個對象：全部列出會讓 4 欄寬的面板擠不下
                const rows = data.value.rows.slice(-5).reverse();
                const rev = rows.slice().reverse();
                return Object.assign(KCD.charts.base(), {
                    grid: { left: 2, right: 34, top: 4, bottom: 2, containLabel: true },
                    tooltip: Object.assign(KCD.charts.base().tooltip, {
                        trigger: 'axis',
                        axisPointer: { type: 'shadow', shadowStyle: { color: t['sf-hover'] } }
                    }),
                    xAxis: { type: 'value', show: false },
                    yAxis: Object.assign(KCD.charts.axis(t), {
                        type: 'category',
                        data: rev.map(r => r.name),
                        axisLabel: { color: t['ink-2'], fontSize: t['fs-chart-name'], fontFamily: t['fx-font-ui'] }
                    }),
                    series: factors.map((f, i) => ({
                        name: f.label,
                        type: 'bar',
                        stack: 'risk',
                        barWidth: 10,
                        itemStyle: {
                            color: t['cat-' + f.cat],
                            borderRadius: i === 0 ? [4, 0, 0, 4]
                                : (i === factors.length - 1 ? [0, 4, 4, 0] : 0)
                        },
                        label: i === factors.length - 1 ? {
                            show: true, position: 'right', distance: 6,
                            color: t['ink-2'], fontSize: t['fs-chart-label'], fontFamily: t['fx-font-num'],
                            formatter(p) {
                                const r = rev[p.dataIndex];
                                return (r.harsh + r.speed + r.fatigue) + ' 次';
                            }
                        } : { show: false },
                        data: rev.map(r => r[f.key])
                    }))
                });
            });

            const chartHeight = computed(() => Math.max(110, Math.min(5, data.value.rows.length) * 28));

            return { data, option, chartHeight, factors };
        },
        template: `
            <div class="ds-panel score-factors">
                <div class="ds-panel-head">
                    <h4>風險行為構成</h4>
                    <span class="ds-legend score-factor-legend">
                        <span v-for="f in factors" :key="f.key"
                              :style="{ '--lv': 'var(--cat-' + f.cat + ')' }">{{ f.label }}</span>
                    </span>
                </div>
                <p class="ds-panel-sub">風險最高的 {{ Math.min(5, data.total) }} 個{{ data.objectLabel }}，依通報次數堆疊</p>
                <kcd-chart :option="option" :height="chartHeight" />
            </div>
        `
    };

    /* ---------------------------------------------------------------------
       M03-7 車隊分數趨勢（S）
       --------------------------------------------------------------------- */
    const ScoreTrend = {
        name: 'ScoreTrend',
        props: { filters: { type: Object, required: true }, size: { type: String, default: 'S' } },
        setup() {
            const seed = D.SCORE_TREND;
            const option = computed(() => {
                const t = KCD.theme.tokens();
                return Object.assign(KCD.charts.base(), {
                    grid: { left: 2, right: 10, top: 22, bottom: 2, containLabel: true },
                    tooltip: Object.assign(KCD.charts.base().tooltip, {
                        trigger: 'axis',
                        formatter: ps => '<b>' + seed[ps[0].dataIndex].date + '</b><br>車隊平均 '
                            + seed[ps[0].dataIndex].score + ' 分'
                    }),
                    xAxis: Object.assign(KCD.charts.axis(t), {
                        type: 'category', boundaryGap: false, data: seed.map(d => d.date)
                    }),
                    yAxis: Object.assign(KCD.charts.axis(t, { grid: true, numeric: true }), {
                        type: 'value', min: 70, max: 90
                    }),
                    series: [{
                        type: 'line',
                        smooth: true,
                        symbolSize: 5,
                        lineStyle: KCD.charts.flowLine(t['brand']),
                        itemStyle: { color: t['brand'] },
                        areaStyle: {
                            color: {
                                type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                                colorStops: [
                                    { offset: 0, color: fade(t['brand'], .22) },
                                    { offset: 1, color: fade(t['brand'], 0) }
                                ]
                            }
                        },
                        label: {
                            show: true, position: 'top', distance: 5,
                            color: t['ink-2'], fontSize: t['fs-chart-label'], fontFamily: t['fx-font-num']
                        },
                        data: seed.map(d => d.score)
                    }, {
                        // 最新一點持續脈動：一眼看出這是還在更新的資料
                        type: 'effectScatter',
                        symbolSize: 7,
                        rippleEffect: { scale: 3.2, brushType: 'stroke', number: 2 },
                        showEffectOn: 'render',
                        silent: true,
                        itemStyle: { color: t['brand'] },
                        z: 3,
                        data: [[seed.length - 1, seed[seed.length - 1].score]]
                    }]
                });
            });

            /** 面積漸層需要帶 alpha 的色值，token 是十六進位，這裡轉一次。 */
            function fade(hex, alpha) {
                const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex).trim());
                if (!m) return hex;
                return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ','
                    + parseInt(m[3], 16) + ',' + alpha + ')';
            }

            const latest = seed[seed.length - 1];
            const delta = Math.round((latest.score - seed[seed.length - 2].score) * 10) / 10;
            return { option, latest, delta };
        },
        template: `
            <div class="ds-panel score-trend">
                <div class="ds-panel-head">
                    <h4>車隊分數趨勢</h4>
                    <b>近 7 日</b>
                </div>
                <p class="ds-panel-sub">
                    最新 {{ latest.score }} 分
                    <span :class="delta >= 0 ? 'is-up' : 'is-down'">
                        {{ delta >= 0 ? '▲' : '▼' }} {{ Math.abs(delta) }}
                    </span>
                    較前一日
                </p>
                <kcd-chart :option="option" height="100%" />
            </div>
        `
    };

    /* ---------------------------------------------------------------------
       M03-8 評分明細（L）
       --------------------------------------------------------------------- */
    const ScoreTable = {
        name: 'ScoreTable',
        props: { filters: { type: Object, required: true }, size: { type: String, default: 'L' } },
        emits: ['pick'],
        setup(props, { emit }) {
            const data = computed(() => buildData(props.filters));
            function pick(r) {
                emit('pick', { type: 'score-object', name: r.name, objectLabel: data.value.objectLabel });
            }
            return { data, pick, factors: D.SCORE_FACTORS };
        },
        template: `
            <div class="ds-panel score-table">
                <div class="ds-panel-head">
                    <h4>{{ data.objectLabel }}評分明細</h4>
                    <b>依本週分數排序 · 更多 ›</b>
                </div>
                <div class="score-table-wrap">
                    <table class="ds-table">
                        <thead>
                            <tr>
                                <th>名次</th>
                                <th class="is-text">{{ data.objectLabel }}</th>
                                <th>本週分數</th>
                                <th>上週分數</th>
                                <th>分數差異</th>
                                <th>名次升降</th>
                                <th class="is-text">等級</th>
                                <th v-for="f in factors" :key="f.key">{{ f.label }}</th>
                                <th>合計通報</th>
                                <th class="is-text">操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="r in data.rows" :key="r.name">
                                <td>{{ r.rank }}</td>
                                <td class="is-text"><strong>{{ r.name }}</strong></td>
                                <td>
                                    <span class="score-cell">
                                        <span class="ds-bar" :style="{ '--lv': 'var(--' + r.band.token + ')' }">
                                            <b class="m-grow" :style="{ width: r.score + '%' }"></b>
                                        </span>
                                        <em>{{ r.score }}</em>
                                    </span>
                                </td>
                                <td>{{ r.prev }}</td>
                                <td :class="r.diff >= 0 ? 'is-up' : 'is-down'">
                                    {{ r.diff >= 0 ? '+' : '' }}{{ r.diff }}
                                </td>
                                <td :class="r.move >= 0 ? 'is-up' : 'is-down'">
                                    {{ r.move > 0 ? '▲' : (r.move < 0 ? '▼' : '－') }}{{ r.move ? Math.abs(r.move) : '' }}
                                </td>
                                <td class="is-text">
                                    <span class="ds-flag" :class="'is-band-' + r.band.token">{{ r.band.label }}</span>
                                </td>
                                <td v-for="f in factors" :key="f.key">{{ r[f.key] }}</td>
                                <td>{{ r.harsh + r.speed + r.fatigue }}</td>
                                <td class="is-text">
                                    <button class="score-table-link" @click="pick(r)">既有頁面</button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p class="score-table-note">
                    備註：分數、等級、名次與升降由後端計算；點擊「既有頁面」開啟駕駛行為查詢分頁。
                </p>
            </div>
        `
    };

    KCD.modules = KCD.modules || {};
    const reg = (id, title, desc, sizes, icon, component) => {
        KCD.modules[id] = { id, title, desc, sizes, icon, component, board: 'std_driver_score' };
    };

    reg('score-overview', '車隊評分總覽',
        '車隊平均分數、較上週變化、安全績優與風險預警對象。',
        ['W'], 'shield-check', ScoreOverview);
    reg('score-gauge', '評分等級儀表',
        '分段等級環，明確標出分數落在哪個風險區間。',
        ['S', 'M'], 'gauge', ScoreGauge);
    reg('score-move', '分數與名次變化',
        '啞鈴圖對照本週與上週分數，右側標示名次升降。',
        ['M', 'L'], 'move-vertical', ScoreMove);
    reg('score-up', '行為績優對象',
        '名次上升最多的三個對象，含上週名次與分數差異。',
        ['S', 'M'], 'trending-up', makeMovers('up'));
    reg('score-down', '行為風險對象',
        '名次下降最多的三個對象，含上週名次與分數差異。',
        ['S', 'M'], 'trending-down', makeMovers('down'));
    reg('score-factors', '風險行為構成',
        '急加減速、超速、疲勞駕駛三類行為的堆疊構成。',
        ['S', 'M'], 'layers', ScoreFactors);
    reg('score-trend', '車隊分數趨勢',
        '近 7 日車隊平均分數折線，含與前一日變化。',
        ['S', 'M'], 'chart-line', ScoreTrend);
    reg('score-table', '評分明細',
        '逐對象的本週與上週分數、名次升降、等級與三類行為次數。',
        ['L'], 'table', ScoreTable);
})(window.KCD);
