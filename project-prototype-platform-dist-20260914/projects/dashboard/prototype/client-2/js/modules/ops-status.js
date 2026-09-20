/* ==========================================================================
   車隊運行狀態看板 — M01 系列
   --------------------------------------------------------------------------
   依據 V7 第 4、5 頁：
     總公司／區主管  行進、怠速、熄火數量與佔比；各站所狀態比例以及總台數
     分公司／員工    同上三態；各車輛各狀態累計時間比例以及總時數

   兩個視角的資料任務不同：總公司比的是「幾台」，分公司比的是「多久」。
   同一模組按權限切換資料源與單位，不拆成兩個模組（分公司是權限視角，
   不是另一張看板）。

   三態顏色：行進＝正常、怠速＝提醒、熄火＝嚴重。客戶在 V7 與參考圖裡都是
   這個讀法 —— 對車隊而言熄火就是閒置資產。映射集中在 STATES 與
   module-ops-status.css 頂部的 .ops-state-* 三行，要改只動一處。
   ========================================================================== */

(function (KCD) {
    'use strict';

    const { computed } = Vue;
    const D = KCD.data;

    const STATES = [
        { key: 'run', label: '行進中', icon: 'navigation', cls: 'ops-state-run', token: 'st-normal' },
        { key: 'idle', label: '怠速', icon: 'timer', cls: 'ops-state-idle', token: 'st-notice' },
        { key: 'off', label: '熄火', icon: 'power', cls: 'ops-state-off', token: 'st-critical' }
    ];

    /* 行進率分級。參考圖的地圖圖例是五檔，色階沿用狀態標尺：
       行進率高＝健康、低＝需要關注，語義方向一致，不另造一套色。 */
    const BANDS = [
        { min: 90, label: '90% 以上', token: 'st-normal' },
        { min: 70, label: '70% ~ 90%', token: 'st-info' },
        { min: 50, label: '50% ~ 70%', token: 'st-notice' },
        { min: 30, label: '30% ~ 50%', token: 'st-warn' },
        { min: 0, label: '30% 以下', token: 'st-critical' }
    ];
    const bandOf = rate => BANDS.find(b => rate >= b.min) || BANDS[BANDS.length - 1];

    /* 需關注車輛。後端回傳「已達門檻」的清單與持續時間，前端不自行判定門檻。 */
    const ATTENTION_SEED = [
        { plate: 'KLG-1357', station: '高雄站', reason: '長時間熄火', minutes: 412, level: 'critical', icon: 'power' },
        { plate: 'KLE-7890', station: '嘉義站', reason: '長時間熄火', minutes: 358, level: 'critical', icon: 'power' },
        { plate: 'KLD-3456', station: '臺南站', reason: '怠速過久', minutes: 143, level: 'warn', icon: 'timer' },
        { plate: 'KLB-5678', station: '花蓮站', reason: '怠速過久', minutes: 112, level: 'warn', icon: 'timer' },
        { plate: 'KLF-2468', station: '臺北站', reason: '未回報位置', minutes: 96, level: 'offline', icon: 'wifi-off' },
        { plate: 'KLC-9012', station: '臺中站', reason: '怠速過久', minutes: 74, level: 'notice', icon: 'timer' }
    ];

    /* 近 7 日行進率。後端按日回傳，前端不做移動平均。 */
    const TREND_SEED = [
        { date: '08-17', rate: 61.2, running: 108 },
        { date: '08-18', rate: 64.8, running: 115 },
        { date: '08-19', rate: 63.1, running: 112 },
        { date: '08-20', rate: 68.4, running: 121 },
        { date: '08-21', rate: 70.2, running: 126 },
        { date: '08-22', rate: 66.9, running: 119 },
        { date: '08-23', rate: 69.5, running: 124 }
    ];

    const LEVEL_TEXT = { notice: '提醒', warn: '注意', critical: '嚴重', offline: '停訊' };

    /** 三態彙總 + 逐對象明細。總公司看站所，分公司看車輛。 */
    function buildData(filters) {
        const scope = D.getBranchScope(filters);
        const isBranch = Boolean(scope);
        const mult = D.scopeMultiplier(filters);
        // 讀一次 pulse 建立依賴：每輪模擬取數後，本函式會重算，
        // 三態數字因此小幅波動並觸發滾動。正式接入改為讀後端推送的資料。
        const tick = KCD.motion.pulse.value;

        let rows = (isBranch ? D.VEHICLES : D.STATIONS).map(row => {
            // 行進與怠速會即時變動；熄火作為互補項由總數推回，三態才會恆等於總數。
            const base = row.run + row.idle + row.off;
            const run = D.scale(KCD.motion.jitter(row.run, row.name + 'r', .06), isBranch ? 1 : mult);
            const idle = D.scale(KCD.motion.jitter(row.idle, row.name + 'i', .08), isBranch ? 1 : mult);
            const total = D.scale(base, isBranch ? 1 : mult);
            const off = Math.max(0, total - run - idle);
            return {
                name: row.name, geo: row.geo, run, idle, off, total,
                rate: total > 0 ? Math.round((run / total) * 1000) / 10 : 0
            };
        });

        if (isBranch && filters.vehicle !== 'all') {
            const picked = rows.filter(r => r.name.toLowerCase() === filters.vehicle);
            if (picked.length) rows = picked;
        }

        const sum = key => rows.reduce((acc, r) => acc + r[key], 0);
        const totals = { run: sum('run'), idle: sum('idle'), off: sum('off') };
        const grand = totals.run + totals.idle + totals.off;

        return {
            isBranch,
            scopeLabel: isBranch ? scope : '全公司',
            objectLabel: isBranch ? '車輛' : '站所',
            totalLabel: isBranch ? '總時數' : '總台數',
            unit: isBranch ? '小時' : '台',
            monitored: isBranch ? rows.length : grand,
            totals,
            grand,
            rate: grand > 0 ? Math.round((totals.run / grand) * 1000) / 10 : 0,
            rows
        };
    }

    // 分公司比的是時長：分鐘在大屏上讀不出量級，一律換算成小時。
    const asUnit = (data, value) => (data.isBranch ? Math.round(value / 60) : value);

    /* ---------------------------------------------------------------------
       M01-1 運行狀態總覽（W）
       參考圖頂部那條 KPI：一格一個讀數，主數靠左，三態並排，各自帶佔比。
       --------------------------------------------------------------------- */
    const OpsOverview = {
        name: 'OpsOverview',
        props: { filters: { type: Object, required: true }, size: { type: String, default: 'W' } },
        setup(props) {
            const data = computed(() => buildData(props.filters));
            const pct = key => D.pct(data.value.totals[key], data.value.grand);
            const val = key => asUnit(data.value, data.value.totals[key]);

            /* 主數與三態讀數都做滾動：大屏上數字直接跳字看不出變化，
               滾動才有量級變化的體感。滾動時長略短於 pulse 週期，
               否則下一輪來時上一輪還沒停。 */
            const M = KCD.motion;
            const shownMonitored = M.useTween(() => data.value.monitored);
            const shownRun = M.useTween(() => val('run'));
            const shownIdle = M.useTween(() => val('idle'));
            const shownOff = M.useTween(() => val('off'));
            const shownRate = M.useTween(() => data.value.rate, { decimals: 1 });
            const bumped = M.useBump(() => data.value.monitored);

            const shownOf = key =>
                ({ run: shownRun, idle: shownIdle, off: shownOff })[key].value;

            return { data, pct, val, STATES, shownMonitored, shownRate, shownOf, bumped };
        },
        template: `
            <div class="ds-panel ops-kpi m-scan">
                <div class="ops-kpi-row">
                    <div class="ops-kpi-cell is-lead">
                        <span class="ops-kpi-label">
                            <i class="m-live"></i>{{ data.isBranch ? '監測車輛' : '監測車輛總數' }}
                        </span>
                        <span class="ops-kpi-val">
                            <strong class="m-beat" :class="{ 'm-bump': bumped }">{{ shownMonitored }}</strong><em>台</em>
                        </span>
                        <span class="ops-kpi-foot">{{ data.scopeLabel }} · 行進率 {{ shownRate }}%</span>
                    </div>
                    <div v-for="(s, si) in STATES" :key="s.key" class="ops-kpi-cell m-rise" :class="s.cls" :style="{ '--i': si + 1 }">
                        <span class="ops-kpi-label"><i :data-lucide="s.icon"></i>{{ s.label }}</span>
                        <span class="ops-kpi-val"><strong>{{ shownOf(s.key) }}</strong><em>{{ data.unit }}</em></span>
                        <span class="ops-kpi-foot">佔比 {{ pct(s.key) }}%</span>
                    </div>
                </div>
                <span class="ds-band ops-seg">
                    <i v-for="s in STATES" :key="s.key" :class="s.cls"
                       :style="{ width: pct(s.key) + '%' }"
                       :title="s.label + ' ' + pct(s.key) + '%'"></i>
                </span>
            </div>
        `
    };

    /* ---------------------------------------------------------------------
       M01-2 運行狀態分布（S）
       環圖 + 右側清單。參考圖「異常類型分布」的結構：環心壓總計，
       清單一行一態，帶數量與佔比。
       --------------------------------------------------------------------- */
    const OpsDonut = {
        name: 'OpsDonut',
        props: { filters: { type: Object, required: true }, size: { type: String, default: 'S' } },
        emits: ['pick'],
        setup(props, { emit }) {
            const data = computed(() => buildData(props.filters));
            const pct = key => D.pct(data.value.totals[key], data.value.grand);
            const val = key => asUnit(data.value, data.value.totals[key]);
            // 環心總數滾動，並讓環心整塊極輕呼吸
            const shownTotal = KCD.motion.useTween(() => data.value.monitored);

            const option = computed(() => {
                const t = KCD.theme.tokens();
                const d = data.value;
                return Object.assign(KCD.charts.base(), {
                    tooltip: Object.assign(KCD.charts.base().tooltip, {
                        trigger: 'item',
                        formatter: p => '<b>' + p.name + '</b><br>' + p.value + ' ' + d.unit + '（' + p.percent + '%）'
                    }),
                    series: [{
                        type: 'pie',
                        radius: ['58%', '84%'],
                        center: ['50%', '50%'],
                        avoidLabelOverlap: false,
                        label: { show: false },
                        labelLine: { show: false },
                        // 段間留 2px 表面間隙，不描邊
                        itemStyle: { borderColor: t['sf-card'], borderWidth: 2 },
                        emphasis: { scaleSize: 4 },
                        data: STATES.map(s => ({
                            name: s.label,
                            value: asUnit(d, d.totals[s.key]),
                            itemStyle: { color: t[s.token] }
                        }))
                    }, {
                        /* 掃描弧：一道細弧繞環持續旋轉，表達「這個環還在收數」。
                           用一個兩段的細環＋ ECharts 的 startAngle 動畫做不到，
                           因此由 CSS 在容器上轉（見 module-*.css 的 .m-orbit）。 */
                        type: 'pie',
                        radius: ['88%', '92%'],
                        center: ['50%', '50%'],
                        silent: true,
                        label: { show: false },
                        labelLine: { show: false },
                        animation: false,
                        data: [
                            { value: 14, itemStyle: { color: KCD.charts.fade(t['brand'], .5) } },
                            { value: 86, itemStyle: { color: 'transparent' } }
                        ]
                    }]
                });
            });

            function onPick(p) {
                emit('pick', { type: 'ops-state', name: p.name, objectLabel: '運行狀態' });
            }

            return { data, option, pct, val, onPick, STATES, shownTotal };
        },
        template: `
            <div class="ds-panel ops-donut">
                <div class="ds-panel-head"><h4>運行狀態分布</h4><b>{{ data.scopeLabel }}</b></div>
                <div v-if="data.grand > 0" class="ops-donut-body">
                    <div class="ops-donut-chart m-orbit">
                        <kcd-chart :option="option" height="100%" @pick="onPick" />
                        <div class="ops-donut-center m-breathe">
                            <span>總計</span>
                            <strong>{{ shownTotal }}</strong>
                            <em>台</em>
                        </div>
                    </div>
                    <ul class="ops-donut-list">
                        <li v-for="(s, si) in STATES" :key="s.key" class="m-rise" :class="s.cls" :style="{ '--i': si }">
                            <i class="ops-dot"></i>
                            <span class="ops-donut-name">{{ s.label }}</span>
                            <b>{{ val(s.key) }}</b>
                            <span class="ops-donut-pct">({{ pct(s.key) }}%)</span>
                        </li>
                    </ul>
                </div>
                <div v-else class="ds-empty"><i data-lucide="inbox"></i>當前條件下沒有運行資料</div>
            </div>
        `
    };

    /* ---------------------------------------------------------------------
       M01-3 站所運行率排名（S）
       橫向長條，依行進率排序。條色用五檔分級 —— 與地圖同一套讀法，
       使用者不必在兩張圖之間換算。
       --------------------------------------------------------------------- */
    const OpsRank = {
        name: 'OpsRank',
        props: { filters: { type: Object, required: true }, size: { type: String, default: 'S' } },
        emits: ['pick'],
        setup(props, { emit }) {
            const data = computed(() => buildData(props.filters));
            const ranked = computed(() =>
                [...data.value.rows].sort((a, b) => b.rate - a.rate).slice(0, 8));

            const option = computed(() => {
                const t = KCD.theme.tokens();
                const rev = ranked.value.slice().reverse();
                const d = data.value;
                return Object.assign(KCD.charts.base(), {
                    grid: { left: 2, right: 46, top: 2, bottom: 2, containLabel: true },
                    tooltip: Object.assign(KCD.charts.base().tooltip, {
                        trigger: 'item',
                        formatter(p) {
                            const r = rev[p.dataIndex];
                            return '<b>' + r.name + '</b><br>行進率 ' + r.rate + '%<br>'
                                + '<span style="opacity:.7">行進 ' + asUnit(d, r.run) + ' / '
                                + d.totalLabel + ' ' + asUnit(d, r.total) + ' ' + d.unit + '</span>';
                        }
                    }),
                    xAxis: { type: 'value', max: 100, show: false },
                    yAxis: Object.assign(KCD.charts.axis(t), {
                        type: 'category',
                        data: rev.map(r => r.name),
                        axisLabel: { color: t['ink-2'], fontSize: t['fs-chart-name'], fontFamily: t['fx-font-ui'] }
                    }),
                    series: [{
                        type: 'bar',
                        barWidth: 9,
                        /* 條色逐項指定（見下方 data 的 itemStyle），因此這裡只給
                           圓角與輝光，不給 color —— 給了會覆蓋掉每條的分檔色。 */
                        itemStyle: {
                            borderRadius: [0, 5, 5, 0],
                            shadowBlur: 6,
                            shadowOffsetX: 1
                        },
                        label: {
                            show: true, position: 'right', distance: 6,
                            color: t['ink-1'], fontFamily: t['fx-font-num'], fontSize: t['fs-chart-label'], fontWeight: 600,
                            formatter: p => rev[p.dataIndex].rate + '%'
                        },
                        data: rev.map(r => ({
                            value: r.rate,
                            itemStyle: { color: t[bandOf(r.rate).token] }
                        }))
                    }]
                });
            });

            const chartHeight = computed(() => Math.max(110, ranked.value.length * 26));

            function onPick(p) {
                const r = ranked.value.slice().reverse()[p.dataIndex];
                if (r) emit('pick', { type: 'ops-object', name: r.name, objectLabel: data.value.objectLabel });
            }

            return { data, ranked, option, chartHeight, onPick };
        },
        template: `
            <div class="ds-panel ops-rank">
                <div class="ds-panel-head">
                    <h4>{{ data.objectLabel }}行進率排名</h4>
                    <b>由高至低</b>
                </div>
                <kcd-chart v-if="ranked.length" :option="option" :height="chartHeight" @pick="onPick" />
                <div v-else class="ds-empty"><i data-lucide="inbox"></i>當前條件下沒有{{ data.objectLabel }}資料</div>
            </div>
        `
    };

    /* ---------------------------------------------------------------------
       M01-4 全台車輛分布（V，看板主視覺）
       ECharts geo + 台灣簡化輪廓。泡的大小是總台數、顏色是行進率分級。
       只有地圖標記發光 —— 全域的 --fx-data-glow 已設為無，這裡單獨加。
       --------------------------------------------------------------------- */
    const OpsMap = {
        name: 'OpsMap',
        props: { filters: { type: Object, required: true }, size: { type: String, default: 'V' } },
        emits: ['pick'],
        setup(props, { emit }) {
            const data = computed(() => buildData(props.filters));
            // 分公司視角只點亮自己那一站，其餘淡出 —— 權限範圍要看得出來。
            const points = computed(() => {
                const scope = D.getBranchScope(props.filters);
                return D.STATIONS.map(s => {
                    const hit = data.value.rows.find(r => r.name === s.name);
                    const run = hit ? hit.run : s.run;
                    const total = hit ? hit.total : (s.run + s.idle + s.off);
                    return {
                        name: s.name, geo: s.geo, total,
                        rate: total > 0 ? Math.round((run / total) * 1000) / 10 : 0,
                        dimmed: Boolean(scope) && s.name !== scope
                    };
                });
            });

            const option = computed(() => {
                const t = KCD.theme.tokens();
                const rows = points.value;
                const maxTotal = Math.max(1, ...rows.map(r => r.total));
                return {
                    animationDuration: 420,
                    textStyle: { fontFamily: t['fx-font-ui'] },
                    tooltip: Object.assign(KCD.charts.base().tooltip, {
                        trigger: 'item',
                        formatter(p) {
                            const r = p.data.row;
                            return '<b>' + r.name + '</b><br>行進率 ' + r.rate + '%<br>'
                                + '<span style="opacity:.7">總台數 ' + r.total + ' 台</span>';
                        }
                    }),
                    geo: {
                        map: 'taiwan-counties',
                        roam: false,
                        /* 真實圖資含 22 個縣市界。邊線刻意壓得很淡（.16）：
                           界線太重會把整島切成 22 塊，變成行政地圖而不是儀表底圖。
                           整島的「發光輪廓」感由 shadowBlur 給，不靠邊線加粗。 */
                        itemStyle: {
                            areaColor: t['sf-inset'],
                            borderColor: color(t['brand'], .16),
                            borderWidth: .6,
                            shadowColor: color(t['brand'], .3),
                            shadowBlur: 16
                        },
                        emphasis: { disabled: true },
                        silent: true,
                        left: '6%', right: '6%', top: '5%', bottom: '5%'
                    },
                    series: [{
                        type: 'effectScatter',
                        coordinateSystem: 'geo',
                        // 只有嚴重分級的站所做漣漪，避免整張圖都在動
                        showEffectOn: 'render',
                        rippleEffect: { scale: 2.6, brushType: 'stroke', number: 2 },
                        zlevel: 2,
                        label: {
                            show: true, position: 'right', distance: 7,
                            formatter: p => p.data.row.name,
                            color: t['ink-2'], fontSize: t['fs-chart-label'], fontFamily: t['fx-font-ui']
                        },
                        labelLayout: { hideOverlap: true },
                        data: rows.filter(r => bandOf(r.rate).token === 'st-critical' && !r.dimmed)
                            .map(r => makePoint(r, t, maxTotal))
                    }, {
                        type: 'scatter',
                        coordinateSystem: 'geo',
                        zlevel: 1,
                        label: {
                            show: true, position: 'right', distance: 7,
                            formatter: p => p.data.row.name,
                            color: t['ink-2'], fontSize: t['fs-chart-label'], fontFamily: t['fx-font-ui']
                        },
                        labelLayout: { hideOverlap: true },
                        data: rows.filter(r => !(bandOf(r.rate).token === 'st-critical' && !r.dimmed))
                            .map(r => makePoint(r, t, maxTotal))
                    }]
                };
            });

            /* 每個點的樣式寫進 data item：symbolSize 的回調收到的是原始
               value 陣列而不是資料物件，opacity / shadowColor 也不支援函式。 */
            function makePoint(r, t, maxTotal) {
                const c = r.dimmed ? t['st-void'] : t[bandOf(r.rate).token];
                return {
                    name: r.name,
                    value: r.geo.concat([r.total]),
                    row: r,
                    symbolSize: 13 + (r.total / maxTotal) * 14,
                    itemStyle: {
                        color: c,
                        opacity: r.dimmed ? .3 : .92,
                        borderColor: color(t['ink-1'], r.dimmed ? .12 : .5),
                        borderWidth: 1,
                        shadowColor: r.dimmed ? 'transparent' : c,
                        shadowBlur: r.dimmed ? 0 : 12
                    }
                };
            }

            /** #RRGGBB → rgba()。token 是十六進位，ECharts 的陰影需要帶 alpha。 */
            function color(hex, alpha) {
                const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex).trim());
                if (!m) return hex;
                return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ','
                    + parseInt(m[3], 16) + ',' + alpha + ')';
            }

            function onPick(p) {
                const r = p.data && p.data.row;
                if (r) emit('pick', { type: 'ops-object', name: r.name, objectLabel: '站所' });
            }

            return { data, option, onPick, BANDS };
        },
        template: `
            <div class="ds-panel ops-map">
                <div class="ds-panel-head">
                    <h4>全台車輛分布</h4>
                    <b>{{ data.scopeLabel }}</b>
                </div>
                <div class="ops-map-body">
                    <kcd-chart :option="option" height="100%" @pick="onPick" />
                    <ul class="ops-map-legend">
                        <li v-for="b in BANDS" :key="b.label">
                            <i :style="{ background: 'var(--' + b.token + ')' }"></i>{{ b.label }}
                        </li>
                    </ul>
                    <p class="ops-map-note">泡徑為總台數，色為行進率分級</p>
                </div>
            </div>
        `
    };

    /* ---------------------------------------------------------------------
       M01-5 需關注車輛（S）
       參考圖右欄「高風險異常（未解除）」的結構：等級標籤 + 對象 + 原因與
       持續時間 + 右側量值。門檻由後端判定，前端只映射樣式。
       --------------------------------------------------------------------- */
    const OpsAttention = {
        name: 'OpsAttention',
        props: { filters: { type: Object, required: true }, size: { type: String, default: 'S' } },
        emits: ['pick'],
        setup(props, { emit }) {
            const scope = computed(() => D.getBranchScope(props.filters));
            const rows = computed(() => {
                let list = ATTENTION_SEED;
                if (scope.value) list = list.filter(r => r.station === scope.value);
                if (scope.value && props.filters.vehicle !== 'all') {
                    const picked = list.filter(r => r.plate.toLowerCase() === props.filters.vehicle);
                    if (picked.length) list = picked;
                }
                return list;
            });
            const dur = m => (m >= 60 ? Math.floor(m / 60) + ' 小時 ' + (m % 60) + ' 分' : m + ' 分');
            /* 輪播高亮：長清單自己走一遍，值班的人不必逐行掃。
               只移動高亮，列的位置不動 —— 自動滾動會讓人抓不住剛看到的那一行。 */
            const spot = KCD.motion.useSpotlight(() => rows.value.length, 2800);
            function pick(r) {
                emit('pick', { type: 'ops-vehicle', name: r.plate, objectLabel: '車輛' });
            }
            return { rows, dur, pick, spot, LEVEL_TEXT, scopeLabel: computed(() => scope.value || '全公司') };
        },
        template: `
            <div class="ds-panel ops-attention">
                <div class="ds-panel-head">
                    <h4>需關注車輛</h4>
                    <b>{{ scopeLabel }} · 更多 ›</b>
                </div>
                <ul v-if="rows.length" class="ops-att-list">
                    <li v-for="(r, i) in rows" :key="r.plate" class="m-rise" :style="{ '--i': i }">
                        <button :class="['is-' + r.level, { 'is-spot': i === spot }]" @click="pick(r)">
                            <span class="ds-flag">{{ LEVEL_TEXT[r.level] }}</span>
                            <span class="ops-att-body">
                                <span class="ops-att-plate">{{ r.plate }}</span>
                                <span class="ops-att-meta">{{ r.station }} · {{ r.reason }}</span>
                            </span>
                            <span class="ops-att-dur">
                                <i :data-lucide="r.icon"></i>{{ dur(r.minutes) }}
                            </span>
                        </button>
                    </li>
                </ul>
                <div v-else class="ds-empty"><i data-lucide="shield-check"></i>當前條件下沒有需關注車輛</div>
            </div>
        `
    };

    /* ---------------------------------------------------------------------
       M01-6 運行趨勢（S）
       近 7 日行進率折線。只放一條線 —— 這塊要回答的是「趨勢往哪走」，
       疊第二條序列會讓 4 欄寬的面板讀不清。
       --------------------------------------------------------------------- */
    const OpsTrend = {
        name: 'OpsTrend',
        props: { filters: { type: Object, required: true }, size: { type: String, default: 'S' } },
        setup() {
            const option = computed(() => {
                const t = KCD.theme.tokens();
                return Object.assign(KCD.charts.base(), {
                    grid: { left: 2, right: 10, top: 22, bottom: 2, containLabel: true },
                    tooltip: Object.assign(KCD.charts.base().tooltip, {
                        trigger: 'axis',
                        formatter(ps) {
                            const d = TREND_SEED[ps[0].dataIndex];
                            return '<b>' + d.date + '</b><br>行進率 ' + d.rate + '%<br>'
                                + '<span style="opacity:.7">行進車輛 ' + d.running + ' 台</span>';
                        }
                    }),
                    xAxis: Object.assign(KCD.charts.axis(t), {
                        type: 'category',
                        boundaryGap: false,
                        data: TREND_SEED.map(d => d.date)
                    }),
                    yAxis: Object.assign(KCD.charts.axis(t, { grid: true, numeric: true }), {
                        type: 'value',
                        min: 40, max: 90,
                        axisLabel: { color: t['ink-3'], fontSize: t['fs-chart-axis'], formatter: '{value}%' }
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
                                    { offset: 0, color: 'rgba(56,198,244,.22)' },
                                    { offset: 1, color: 'rgba(56,198,244,0)' }
                                ]
                            }
                        },
                        label: {
                            show: true, position: 'top', distance: 5,
                            color: t['ink-2'], fontSize: t['fs-chart-label'], fontFamily: t['fx-font-num'],
                            formatter: p => p.value + '%'
                        },
                        data: TREND_SEED.map(d => d.rate)
                    }, {
                        /* 最新一點持續脈動：一眼看出「這是還在更新的資料」，
                           而不是一張靜態截圖。只脈動最後一點，不是整條線 ——
                           整條都在動反而讀不出趨勢。 */
                        type: 'effectScatter',
                        symbolSize: 7,
                        rippleEffect: { scale: 3.2, brushType: 'stroke', number: 2 },
                        showEffectOn: 'render',
                        silent: true,
                        itemStyle: { color: t['brand'] },
                        z: 3,
                        data: [[TREND_SEED.length - 1, TREND_SEED[TREND_SEED.length - 1].rate]]
                    }]
                });
            });
            const latest = TREND_SEED[TREND_SEED.length - 1];
            const prev = TREND_SEED[TREND_SEED.length - 2];
            const delta = Math.round((latest.rate - prev.rate) * 10) / 10;
            return { option, latest, delta };
        },
        template: `
            <div class="ds-panel ops-trend">
                <div class="ds-panel-head">
                    <h4>行進率趨勢</h4>
                    <b>近 7 日</b>
                </div>
                <p class="ds-panel-sub">
                    最新 {{ latest.rate }}%
                    <span :class="delta >= 0 ? 'is-up' : 'is-down'">
                        {{ delta >= 0 ? '▲' : '▼' }} {{ Math.abs(delta) }}%
                    </span>
                    較前一日
                </p>
                <kcd-chart :option="option" height="100%" />
            </div>
        `
    };

    /* ---------------------------------------------------------------------
       M01-7 運行明細（L）
       參考圖底部那張滿寬表。用表格而不是圖：這裡要回答的是「逐一核對」，
       欄位多且需要精確值，圖形反而不如表。
       --------------------------------------------------------------------- */
    const OpsTable = {
        name: 'OpsTable',
        props: { filters: { type: Object, required: true }, size: { type: String, default: 'L' } },
        emits: ['pick'],
        setup(props, { emit }) {
            const data = computed(() => buildData(props.filters));
            const rows = computed(() => [...data.value.rows].sort((a, b) => b.rate - a.rate));
            function pick(r) {
                emit('pick', { type: 'ops-object', name: r.name, objectLabel: data.value.objectLabel });
            }
            return { data, rows, pick, asUnit, bandOf, STATES };
        },
        template: `
            <div class="ds-panel ops-table">
                <div class="ds-panel-head">
                    <h4>{{ data.objectLabel }}運行明細</h4>
                    <b>依行進率排序 · 更多 ›</b>
                </div>
                <div class="ops-table-wrap">
                    <table class="ds-table">
                        <thead>
                            <tr>
                                <th>排名</th>
                                <th>{{ data.objectLabel }}</th>
                                <th class="is-num">{{ data.totalLabel }}</th>
                                <th class="is-num">行進</th>
                                <th class="is-num">怠速</th>
                                <th class="is-num">熄火</th>
                                <th>行進率</th>
                                <th>狀態構成</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="(r, i) in rows" :key="r.name">
                                <td class="is-num">{{ i + 1 }}</td>
                                <td><strong>{{ r.name }}</strong></td>
                                <td class="is-num">{{ asUnit(data, r.total) }} {{ data.unit }}</td>
                                <td class="is-num">{{ asUnit(data, r.run) }}</td>
                                <td class="is-num">{{ asUnit(data, r.idle) }}</td>
                                <td class="is-num">{{ asUnit(data, r.off) }}</td>
                                <td>
                                    <span class="ds-flag" :class="'is-band-' + bandOf(r.rate).token">
                                        {{ r.rate }}%
                                    </span>
                                </td>
                                <td>
                                    <span class="ds-band ops-seg is-slim">
                                        <i v-for="s in STATES" :key="s.key" :class="s.cls"
                                           :style="{ width: (r.total ? (r[s.key] / r.total) * 100 : 0) + '%' }"></i>
                                    </span>
                                </td>
                                <td><button class="ops-table-link" @click="pick(r)">詳情</button></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `
    };

    KCD.modules = KCD.modules || {};
    const reg = (id, title, desc, sizes, icon, component) => {
        KCD.modules[id] = {
            id, title, desc, sizes, icon, component,
            // 模組庫暫時以所屬看板分組，因此每個模組都要宣告 board
            board: 'std_fleet_status'
        };
    };

    reg('ops-overview', '運行狀態總覽',
        '監測車輛總數與行進、怠速、熄火的數量、佔比與比例帶。',
        ['W'], 'layout-dashboard', OpsOverview);
    reg('ops-donut', '運行狀態分布',
        '三態環圖，環心壓總計，側邊清單列出數量與佔比。',
        ['S', 'M'], 'chart-pie', OpsDonut);
    reg('ops-rank', '行進率排名',
        '各站所或車輛依行進率排序的橫條，條色為五檔分級。',
        ['S', 'M'], 'bar-chart-3', OpsRank);
    reg('ops-map', '全台車輛分布',
        '台灣輪廓上的站所氣泡，泡徑為總台數、色為行進率分級。',
        ['V', 'M'], 'map', OpsMap);
    reg('ops-attention', '需關注車輛',
        '長時間熄火、怠速過久與未回報位置的車輛清單及持續時間。',
        ['S', 'M'], 'siren', OpsAttention);
    reg('ops-trend', '行進率趨勢',
        '近 7 日行進率折線，含與前一日的變化。',
        ['S', 'M'], 'trending-up', OpsTrend);
    reg('ops-table', '運行明細',
        '逐站所或逐車輛的三態數量、行進率與狀態構成明細表。',
        ['L'], 'table', OpsTable);
})(window.KCD);
