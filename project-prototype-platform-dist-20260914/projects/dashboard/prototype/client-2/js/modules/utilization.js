/* ==========================================================================
   車隊使用率看板 — M02 系列
   --------------------------------------------------------------------------
   依據 V7 第 6 頁與客戶提供的「TMS / FMS 使用率看板」參考圖。

   V7 定義：使用率 = 有效出車數 ÷ 總車輛數，因此不會超過 100%。
   目標值預設 70%，由看板級條件調整（需求文檔 5.2）—— 三個模組共用同一個
   目標值，各自帶齒輪會出現互相矛盾的標準。

   前端不計算「有效出車」的業務口徑，也不重新推斷排名；使用率、漲跌幅、
   較目標差異與排序序列全部由後端回傳。
   ========================================================================== */

(function (KCD) {
    'use strict';

    const { computed } = Vue;
    const D = KCD.data;
    const M = KCD.motion;

    const BANDS = D.UTIL_BANDS;
    const bandOf = v => D.bandOf(BANDS, v);

    /** 全看板共用的一次計算。pulse 進入依賴，因此模擬取數時整屏一起更新。 */
    function buildData(filters) {
        const scope = D.getBranchScope(filters);
        const isBranch = Boolean(scope);
        const tick = M.pulse.value;

        let rows = D.UTILIZATION.map(r => {
            // 使用率小幅波動；上限 100 —— V7 明確使用率不會超過 100%。
            const rate = Math.min(100, M.jitter(r.rate, r.name + 'u', .03));
            return Object.assign({}, r, {
                rate,
                geo: D.GEO_BY_NAME[r.name],
                gap: Math.round((rate - D.UTIL_TARGET) * 10) / 10,
                band: bandOf(rate)
            });
        });

        // 分公司視角只留該站；此處以站所代表分公司。
        if (isBranch) {
            const hit = rows.filter(r => r.name === scope);
            if (hit.length) rows = hit;
        }

        const sorted = [...rows].sort((a, b) => b.rate - a.rate);
        const below = sorted.filter(r => r.rate < D.UTIL_TARGET);
        const avg = rows.length
            ? Math.round((rows.reduce((s, r) => s + r.rate, 0) / rows.length) * 10) / 10
            : 0;

        return {
            isBranch,
            scopeLabel: isBranch ? scope : '全公司',
            target: D.UTIL_TARGET,
            avg,
            // 與前一工作日同期比較，方向與數值都由後端回傳
            delta: Math.round((avg - 66.8) * 10) / 10,
            prev: 66.8,
            rows: sorted,
            best: sorted[0] || null,
            worst: sorted[sorted.length - 1] || null,
            below,
            total: rows.length
        };
    }

    /* ---------------------------------------------------------------------
       M02-1 使用率總覽（W）
       參考圖左上那組數字：整體使用率、目標、較前一工作日、低於目標站所數。
       --------------------------------------------------------------------- */
    const UtilOverview = {
        name: 'UtilOverview',
        props: { filters: { type: Object, required: true }, size: { type: String, default: 'W' } },
        setup(props) {
            const data = computed(() => buildData(props.filters));
            const shownAvg = M.useTween(() => data.value.avg, { decimals: 1 });
            const shownBelow = M.useTween(() => data.value.below.length);
            const bumped = M.useBump(() => data.value.avg);
            return { data, shownAvg, shownBelow, bumped };
        },
        template: `
            <div class="ds-panel util-kpi m-scan">
                <div class="util-kpi-row">
                    <div class="util-kpi-cell is-lead">
                        <span class="util-kpi-label"><i class="m-live"></i>整體使用率</span>
                        <span class="util-kpi-val">
                            <strong class="m-beat" :class="{ 'm-bump': bumped }">{{ shownAvg }}</strong><em>%</em>
                        </span>
                        <span class="util-kpi-foot">{{ data.scopeLabel }} · 目標 {{ data.target }}%</span>
                    </div>
                    <div class="util-kpi-cell">
                        <span class="util-kpi-label">目標使用率</span>
                        <span class="util-kpi-val"><strong>{{ data.target }}</strong><em>%</em></span>
                        <span class="util-kpi-foot">看板級條件可調</span>
                    </div>
                    <div class="util-kpi-cell" :class="data.delta >= 0 ? 'is-normal' : 'is-critical'">
                        <span class="util-kpi-label">較前一工作日</span>
                        <span class="util-kpi-val">
                            <strong>{{ data.delta >= 0 ? '+' : '' }}{{ data.delta }}</strong><em>%</em>
                        </span>
                        <span class="util-kpi-foot">前值 {{ data.prev }}%</span>
                    </div>
                    <div class="util-kpi-cell" :class="data.below.length ? 'is-warn' : 'is-normal'">
                        <span class="util-kpi-label">低於目標站所</span>
                        <span class="util-kpi-val">
                            <strong>{{ shownBelow }}</strong><em>/ {{ data.total }}</em>
                        </span>
                        <span class="util-kpi-foot">未達 {{ data.target }}% 的站所</span>
                    </div>
                </div>
            </div>
        `
    };

    /* ---------------------------------------------------------------------
       M02-2 使用率環圖（S）
       參考圖主視覺：厚環顯示整體使用率，環心壓數值，並以一道刻痕標出目標位置
       —— 只給數字看不出「離目標多遠」，刻痕才把達標與否變成一眼可見。
       --------------------------------------------------------------------- */
    const UtilDonut = {
        name: 'UtilDonut',
        props: { filters: { type: Object, required: true }, size: { type: String, default: 'S' } },
        setup(props) {
            const data = computed(() => buildData(props.filters));
            const shown = M.useTween(() => data.value.avg, { decimals: 1 });

            const option = computed(() => {
                const t = KCD.theme.tokens();
                const d = data.value;
                const hit = d.avg >= d.target;
                return Object.assign(KCD.charts.base(), {
                    tooltip: Object.assign(KCD.charts.base().tooltip, {
                        trigger: 'item',
                        formatter: p => (p.name === '已達'
                            ? '整體使用率 ' + d.avg + '%'
                            : '距 100% 還有 ' + Math.round((100 - d.avg) * 10) / 10 + '%')
                    }),
                    series: [{
                        type: 'pie',
                        radius: ['66%', '88%'],
                        center: ['50%', '50%'],
                        startAngle: 90,
                        label: { show: false },
                        labelLine: { show: false },
                        silent: false,
                        data: [
                            {
                                name: '已達', value: d.avg,
                                itemStyle: {
                                    color: t[hit ? 'st-normal' : 'st-warn'],
                                    borderRadius: 4
                                }
                            },
                            {
                                name: '未達', value: Math.max(0, 100 - d.avg),
                                itemStyle: { color: t['sf-inset'] },
                                emphasis: { disabled: true }
                            }
                        ]
                    }, {
                        /* 目標刻痕：用一個只有兩段的細環，把 100% 圓周上的
                           目標位置畫出來。比在環外加文字更直觀。 */
                        type: 'pie',
                        radius: ['90%', '97%'],
                        center: ['50%', '50%'],
                        startAngle: 90,
                        silent: true,
                        label: { show: false },
                        labelLine: { show: false },
                        data: [
                            { value: d.target - 0.6, itemStyle: { color: 'transparent' } },
                            { value: 1.2, itemStyle: { color: t['ink-2'] } },
                            { value: Math.max(0, 100 - d.target - 0.6), itemStyle: { color: 'transparent' } }
                        ]
                    }]
                });
            });

            return { data, option, shown };
        },
        template: `
            <div class="ds-panel util-donut">
                <div class="ds-panel-head">
                    <h4>使用率總覽</h4>
                    <b>{{ data.scopeLabel }}</b>
                </div>
                <div class="util-donut-body">
                    <kcd-chart :option="option" height="100%" />
                    <div class="util-donut-center m-breathe">
                        <span>整體使用率</span>
                        <strong>{{ shown }}<em>%</em></strong>
                        <span class="util-donut-target">目標 {{ data.target }}%</span>
                    </div>
                </div>
            </div>
        `
    };

    /* ---------------------------------------------------------------------
       M02-3 站所使用率分布（V）
       台灣輪廓上的站所氣泡，色為使用率五檔。與運行狀態的地圖同一套讀法。
       --------------------------------------------------------------------- */
    const UtilMap = {
        name: 'UtilMap',
        props: { filters: { type: Object, required: true }, size: { type: String, default: 'V' } },
        emits: ['pick'],
        setup(props, { emit }) {
            const data = computed(() => buildData(props.filters));
            const scope = computed(() => D.getBranchScope(props.filters));

            const option = computed(() => {
                const t = KCD.theme.tokens();
                // 地圖固定顯示所有站所，分公司視角只是把其餘站淡出
                const rows = D.UTILIZATION.map(r => {
                    const live = data.value.rows.find(x => x.name === r.name);
                    const rate = live ? live.rate : r.rate;
                    return {
                        name: r.name, rate, geo: D.GEO_BY_NAME[r.name],
                        dimmed: Boolean(scope.value) && r.name !== scope.value
                    };
                }).filter(r => r.geo);

                return {
                    animation: !KCD.charts.reduceMotion(),
                    animationDuration: 560,
                    textStyle: { fontFamily: t['fx-font-ui'] },
                    tooltip: Object.assign(KCD.charts.base().tooltip, {
                        trigger: 'item',
                        formatter(p) {
                            const r = p.data.row;
                            return '<b>' + r.name + '</b><br>使用率 ' + r.rate + '%<br>'
                                + '<span style="opacity:.7">目標 ' + D.UTIL_TARGET + '%</span>';
                        }
                    }),
                    geo: {
                        map: 'taiwan-counties',
                        roam: false,
                        silent: true,
                        /* 縣市界壓淡，同 ops-map 的理由：界線太重會變成行政地圖。 */
                        itemStyle: {
                            areaColor: t['sf-inset'],
                            borderColor: rgba(t['brand'], .16),
                            borderWidth: .6,
                            shadowColor: rgba(t['brand'], .28),
                            shadowBlur: 16
                        },
                        emphasis: { disabled: true },
                        left: '6%', right: '6%', top: '5%', bottom: '5%'
                    },
                    series: [{
                        type: 'effectScatter',
                        coordinateSystem: 'geo',
                        showEffectOn: 'render',
                        rippleEffect: { scale: 2.4, brushType: 'stroke', number: 2 },
                        zlevel: 2,
                        label: labelCfg(t),
                        labelLayout: { hideOverlap: true },
                        // 只有低於目標的站所做漣漪：要注意的是沒達標的
                        data: rows.filter(r => !r.dimmed && r.rate < D.UTIL_TARGET).map(r => point(r, t))
                    }, {
                        type: 'scatter',
                        coordinateSystem: 'geo',
                        zlevel: 1,
                        label: labelCfg(t),
                        labelLayout: { hideOverlap: true },
                        data: rows.filter(r => r.dimmed || r.rate >= D.UTIL_TARGET).map(r => point(r, t))
                    }]
                };
            });

            const labelCfg = t => ({
                show: true, position: 'right', distance: 7,
                formatter: p => p.data.row.name,
                color: t['ink-2'], fontSize: t['fs-chart-label'], fontFamily: t['fx-font-ui']
            });

            /* 每個點的樣式寫進 data item：symbolSize 回調收到的是原始 value
               陣列而非資料物件，opacity / shadowColor 也不支援函式形式。 */
            function point(r, t) {
                const c = r.dimmed ? t['st-void'] : t[bandOf(r.rate).token];
                return {
                    name: r.name,
                    value: r.geo.concat([r.rate]),
                    row: r,
                    symbolSize: 15 + (r.rate / 100) * 13,
                    itemStyle: {
                        color: c,
                        opacity: r.dimmed ? .3 : .92,
                        borderColor: rgba(t['ink-1'], r.dimmed ? .12 : .48),
                        borderWidth: 1,
                        shadowColor: r.dimmed ? 'transparent' : c,
                        shadowBlur: r.dimmed ? 0 : 11
                    }
                };
            }

            /** #RRGGBB → rgba()。token 是十六進位，ECharts 的陰影需要帶 alpha。 */
            function rgba(hex, alpha) {
                const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex).trim());
                if (!m) return hex;
                return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ','
                    + parseInt(m[3], 16) + ',' + alpha + ')';
            }

            function onPick(p) {
                const r = p.data && p.data.row;
                if (r) emit('pick', { type: 'util-object', name: r.name, objectLabel: '站所' });
            }

            return { data, option, onPick, BANDS };
        },
        template: `
            <div class="ds-panel util-map">
                <div class="ds-panel-head">
                    <h4>站所使用率分布</h4>
                    <b>{{ data.scopeLabel }}</b>
                </div>
                <div class="util-map-body">
                    <kcd-chart :option="option" height="100%" @pick="onPick" />
                    <ul class="util-map-legend">
                        <li v-for="b in BANDS" :key="b.label">
                            <i :style="{ background: 'var(--' + b.token + ')' }"></i>{{ b.label }}
                        </li>
                    </ul>
                    <p class="util-map-note">低於目標的站所帶漣漪標記</p>
                </div>
            </div>
        `
    };

    /* ---------------------------------------------------------------------
       M02-4 使用率區間分布（S）
       參考圖的五檔分布：一檔一列，帶條、家數與佔比。
       用分檔而不是直方圖：讀者要問的是「幾家在哪一檔」，不是連續分布形狀。
       --------------------------------------------------------------------- */
    const UtilBands = {
        name: 'UtilBands',
        props: { filters: { type: Object, required: true }, size: { type: String, default: 'S' } },
        setup(props) {
            const data = computed(() => buildData(props.filters));
            const bands = computed(() => {
                const rows = data.value.rows;
                return BANDS.map(b => {
                    const hit = rows.filter(r => bandOf(r.rate).label === b.label);
                    return {
                        label: b.label, token: b.token,
                        count: hit.length,
                        pct: D.pct(hit.length, rows.length)
                    };
                });
            });
            return { data, bands };
        },
        template: `
            <div class="ds-panel util-bands">
                <div class="ds-panel-head">
                    <h4>使用率區間分布</h4>
                    <b>共 {{ data.total }} 個站所</b>
                </div>
                <ul class="util-bands-list">
                    <li v-for="(b, bi) in bands" :key="b.label" class="m-rise" :style="{ '--i': bi }">
                        <i class="util-band-dot" :style="{ background: 'var(--' + b.token + ')' }"></i>
                        <span class="util-band-name">{{ b.label }}</span>
                        <span class="ds-bar" :style="{ '--v': b.pct, '--lv': 'var(--' + b.token + ')' }"><b class="m-grow" :style="{ '--i': bi }"></b></span>
                        <span class="util-band-count">{{ b.count }}<em>個</em></span>
                        <span class="util-band-pct">({{ b.pct }}%)</span>
                    </li>
                </ul>
            </div>
        `
    };

    /* ---------------------------------------------------------------------
       M02-5／M02-6 使用率排名（S）
       同一個元件、兩種模式：Top 前段班、Bottom 低於目標。
       兩者版面完全相同，只有取樣與狀態色不同 —— 使用者不必學兩種排行。
       --------------------------------------------------------------------- */
    function makeRank(mode) {
        return {
            name: 'UtilRank' + mode,
            props: { filters: { type: Object, required: true }, size: { type: String, default: 'S' } },
            emits: ['pick'],
            setup(props, { emit }) {
                const data = computed(() => buildData(props.filters));
                const rows = computed(() => (mode === 'top'
                    ? data.value.rows.slice(0, 5)
                    : data.value.below.slice().reverse().slice(0, 5)));
                const spot = M.useSpotlight(() => rows.value.length, 3000);
                function pick(r) {
                    emit('pick', { type: 'util-object', name: r.name, objectLabel: '站所' });
                }
                return { data, rows, spot, pick, mode };
            },
            template: `
                <div class="ds-panel util-rank">
                    <div class="ds-panel-head">
                        <h4>{{ mode === 'top' ? '使用率 Top 5' : '低於目標使用率' }}</h4>
                        <b>{{ mode === 'top' ? '由高至低' : '目標 ' + data.target + '% · 更多 ›' }}</b>
                    </div>
                    <ol v-if="rows.length" class="util-rank-list">
                        <li v-for="(r, i) in rows" :key="r.name" class="m-rise" :style="{ '--i': i }"
                            :class="[{ 'is-spot': i === spot }, 'is-band-' + r.band.token]">
                            <button @click="pick(r)">
                                <span class="util-rank-no" :class="{ 'is-medal': mode === 'top' && i < 3 }">{{ i + 1 }}</span>
                                <span class="util-rank-name">{{ r.name }}</span>
                                <span class="ds-bar"><b class="m-grow" :style="{ width: r.rate + '%', '--i': i }"></b></span>
                                <span class="util-rank-rate">{{ r.rate }}<em>%</em></span>
                                <span class="util-rank-delta" :class="r.delta >= 0 ? 'is-up' : 'is-down'">
                                    {{ r.delta >= 0 ? '▲' : '▼' }} {{ Math.abs(r.delta) }}%
                                </span>
                            </button>
                        </li>
                    </ol>
                    <div v-else class="ds-empty">
                        <i data-lucide="shield-check"></i>
                        {{ mode === 'top' ? '當前條件下沒有站所資料' : '所有站所都已達標' }}
                    </div>
                </div>
            `
        };
    }

    /* ---------------------------------------------------------------------
       M02-7 使用率明細（L）
       參考圖底部那張滿寬表。欄位多且需要精確值，因此用表而不是圖；
       趨勢欄放迷你折線，讓每一列自己帶上「往哪走」。
       --------------------------------------------------------------------- */
    const UtilTable = {
        name: 'UtilTable',
        props: { filters: { type: Object, required: true }, size: { type: String, default: 'L' } },
        emits: ['pick'],
        setup(props, { emit }) {
            const data = computed(() => buildData(props.filters));
            function pick(r) {
                emit('pick', { type: 'util-object', name: r.name, objectLabel: '站所' });
            }
            /** 迷你折線的 SVG path。用 SVG 而非 ECharts：一列一個實例太重，
                而這裡只需要形狀，不需要座標軸與 tooltip。 */
            function sparkPath(values) {
                const min = Math.min(...values), max = Math.max(...values);
                const span = max - min || 1;
                const w = 76, h = 20;
                return values.map((v, i) => {
                    const x = (i / (values.length - 1)) * w;
                    const y = h - ((v - min) / span) * h;
                    return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
                }).join(' ');
            }
            return { data, pick, sparkPath };
        },
        template: `
            <div class="ds-panel util-table">
                <div class="ds-panel-head">
                    <h4>站所使用率明細</h4>
                    <b>依使用率排序 · 更多 ›</b>
                </div>
                <div class="util-table-wrap">
                    <table class="ds-table">
                        <thead>
                            <tr>
                                <th>排名</th>
                                <th class="is-text">站所</th>
                                <th>使用率</th>
                                <th>較上月變化</th>
                                <th>較目標差異</th>
                                <th>目標</th>
                                <th>有效工時</th>
                                <th>行駛工時</th>
                                <th>怠速工時</th>
                                <th>熄火工時</th>
                                <th class="is-text">趨勢（近 7 日）</th>
                                <th class="is-text">操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="(r, i) in data.rows" :key="r.name">
                                <td>{{ i + 1 }}</td>
                                <td class="is-text"><strong>{{ r.name }}</strong></td>
                                <td>
                                    <span class="util-cell-rate">
                                        <span class="ds-bar" :style="{ '--lv': 'var(--' + r.band.token + ')' }">
                                            <b class="m-grow" :style="{ width: r.rate + '%' }"></b>
                                        </span>
                                        <em>{{ r.rate }}%</em>
                                    </span>
                                </td>
                                <td :class="r.delta >= 0 ? 'is-up' : 'is-down'">
                                    {{ r.delta >= 0 ? '▲' : '▼' }} {{ Math.abs(r.delta) }}%
                                </td>
                                <td :class="r.gap >= 0 ? 'is-up' : 'is-down'">
                                    {{ r.gap >= 0 ? '+' : '' }}{{ r.gap }}%
                                </td>
                                <td>{{ data.target }}%</td>
                                <td>{{ r.effective.toLocaleString() }}</td>
                                <td>{{ r.drive.toLocaleString() }}</td>
                                <td>{{ r.idle.toLocaleString() }}</td>
                                <td>{{ r.off.toLocaleString() }}</td>
                                <td class="is-text">
                                    <svg class="util-spark" viewBox="0 0 76 20" preserveAspectRatio="none"
                                         :class="r.delta >= 0 ? 'is-up' : 'is-down'">
                                        <path :d="sparkPath(r.spark)" fill="none" stroke="currentColor"
                                              stroke-width="1.5" stroke-linecap="round" />
                                    </svg>
                                </td>
                                <td class="is-text">
                                    <button class="util-table-link" @click="pick(r)">詳情</button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p class="util-table-note">
                    備註：使用率 = 有效出車數 ÷ 總車輛數；目標使用率依各站所營運目標設定。
                </p>
            </div>
        `
    };

    KCD.modules = KCD.modules || {};
    const reg = (id, title, desc, sizes, icon, component) => {
        KCD.modules[id] = { id, title, desc, sizes, icon, component, board: 'std_fleet_usage' };
    };

    reg('util-overview', '使用率總覽帶',
        '整體使用率、目標值、較前一工作日變化與低於目標站所數。',
        ['W'], 'gauge', UtilOverview);
    reg('util-donut', '使用率環圖',
        '整體使用率厚環，環上以刻痕標出目標位置。',
        ['S', 'M'], 'chart-pie', UtilDonut);
    reg('util-map', '站所使用率分布',
        '台灣輪廓上的站所氣泡，色為使用率五檔，低於目標者帶漣漪。',
        ['V', 'M'], 'map', UtilMap);
    reg('util-bands', '使用率區間分布',
        '五個使用率區間各有幾個站所及其佔比。',
        ['S', 'M'], 'align-left', UtilBands);
    reg('util-top', '使用率 Top 5',
        '使用率前五名站所，含較上月變化。',
        ['S', 'M'], 'trophy', makeRank('top'));
    reg('util-below', '低於目標使用率',
        '未達目標使用率的站所排名，含較上月變化。',
        ['S', 'M'], 'trending-down', makeRank('below'));
    reg('util-table', '站所使用率明細',
        '逐站所的使用率、較上月變化、較目標差異、四類工時與近 7 日趨勢。',
        ['L'], 'table', UtilTable);
})(window.KCD);
