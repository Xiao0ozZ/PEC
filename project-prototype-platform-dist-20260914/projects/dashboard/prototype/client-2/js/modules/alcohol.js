/* ==========================================================================
   酒測管理看板 — M05 系列
   --------------------------------------------------------------------------
   依據 V7 第 11、12 頁：
     總公司／區主管  通過率、不通過人數、未吹即出車人數、各站所構成與排名
     分公司／員工    同上三個指標，加上酒測異常駕駛與未酒測駕駛排行

   V7 定義：通過率 =（酒測通過人數 ÷ 應酒測人數）× 100%。

   人員明細刻意不用圓餅圖 —— V7 的兩個排行要比較的是「誰的酒測值高、
   誰連續漏測久」，圓餅圖表達不了排序，也放不下車號與天數。

   V7 註明本看板點擊開啟既有功能分頁，因此各模組點擊走 detail_page 語義。
   ========================================================================== */

(function (KCD) {
    'use strict';

    const { computed } = Vue;
    const D = KCD.data;
    const M = KCD.motion;

    const STATES = D.ALCOHOL_STATES;

    function buildData(filters) {
        const scope = D.getBranchScope(filters);
        const isBranch = Boolean(scope);
        const tick = M.pulse.value;

        let rows = D.ALCOHOL_STATIONS.map(r => {
            // 不通過與未吹會即時變動；通過作為互補項由應酒測人數推回，
            // 三態相加因此恆等於應酒測人數。
            const fail = Math.max(0, Math.round(M.jitter(r.fail, r.name + 'f', .3)));
            const miss = Math.max(0, Math.round(M.jitter(r.miss, r.name + 'm', .3)));
            const pass = Math.max(0, r.due - fail - miss);
            return {
                name: r.name, due: r.due, pass, fail, miss,
                rate: r.due > 0 ? Math.round((pass / r.due) * 1000) / 10 : 0
            };
        });

        if (isBranch) {
            const hit = rows.filter(r => r.name === scope);
            if (hit.length) rows = hit;
        }

        const sum = k => rows.reduce((s, r) => s + r[k], 0);
        const totals = { due: sum('due'), pass: sum('pass'), fail: sum('fail'), miss: sum('miss') };
        const byRate = [...rows].sort((a, b) => b.rate - a.rate);

        // 人員排行：分公司視角只留該站的人
        const filterPeople = list => {
            let out = list;
            if (isBranch) out = out.filter(p => p.station === scope);
            return out;
        };

        return {
            isBranch,
            scopeLabel: isBranch ? scope : '全公司',
            limit: D.ALCOHOL_LIMIT,
            totals,
            rate: totals.due > 0 ? Math.round((totals.pass / totals.due) * 1000) / 10 : 0,
            rows: byRate,
            best: byRate[0] || null,
            worst: byRate[byRate.length - 1] || null,
            failDrivers: filterPeople(D.ALCOHOL_FAIL_DRIVERS),
            missDrivers: filterPeople(D.ALCOHOL_MISS_DRIVERS),
            total: rows.length
        };
    }

    /* ---------------------------------------------------------------------
       M05-1 酒測總覽（W）
       V7 的三個主指標：通過率、不通過人數、未吹即出車人數。
       後兩者是「要追的人」，因此都帶狀態色與可點入口。
       --------------------------------------------------------------------- */
    const AlcoholOverview = {
        name: 'AlcoholOverview',
        props: { filters: { type: Object, required: true }, size: { type: String, default: 'W' } },
        emits: ['pick'],
        setup(props, { emit }) {
            const data = computed(() => buildData(props.filters));
            const shownRate = M.useTween(() => data.value.rate, { decimals: 1 });
            const shownFail = M.useTween(() => data.value.totals.fail);
            const shownMiss = M.useTween(() => data.value.totals.miss);
            const bumped = M.useBump(() => data.value.rate);
            function pick(kind, label) {
                emit('pick', { type: 'alcohol-' + kind, name: label, objectLabel: '酒測' });
            }
            return { data, shownRate, shownFail, shownMiss, bumped, pick };
        },
        template: `
            <div class="ds-panel alc-kpi m-scan">
                <div class="alc-kpi-row">
                    <div class="alc-kpi-cell is-lead is-normal">
                        <span class="alc-kpi-label"><i class="m-live"></i>酒測通過率</span>
                        <span class="alc-kpi-val">
                            <strong class="m-beat" :class="{ 'm-bump': bumped }">{{ shownRate }}</strong><em>%</em>
                        </span>
                        <span class="alc-kpi-foot">
                            {{ data.scopeLabel }} · 應酒測 {{ data.totals.due }} 人
                        </span>
                    </div>
                    <button class="alc-kpi-cell is-critical is-clickable"
                            @click="pick('fail', '酒測不通過')">
                        <span class="alc-kpi-label"><i data-lucide="circle-x"></i>酒測不通過</span>
                        <span class="alc-kpi-val"><strong>{{ shownFail }}</strong><em>人</em></span>
                        <span class="alc-kpi-foot">開啟酒測查詢 ›</span>
                    </button>
                    <button class="alc-kpi-cell is-warn is-clickable"
                            @click="pick('miss', '未吹酒測即出車')">
                        <span class="alc-kpi-label"><i data-lucide="circle-help"></i>未吹酒測即出車</span>
                        <span class="alc-kpi-val"><strong>{{ shownMiss }}</strong><em>人</em></span>
                        <span class="alc-kpi-foot">開啟酒測查詢 ›</span>
                    </button>
                    <div class="alc-kpi-cell is-normal" v-if="data.best">
                        <span class="alc-kpi-label"><i data-lucide="award"></i>通過率最佳</span>
                        <span class="alc-kpi-val is-object"><strong>{{ data.best.name }}</strong></span>
                        <span class="alc-kpi-foot">{{ data.best.rate }}% · {{ data.best.due }} 人</span>
                    </div>
                </div>
            </div>
        `
    };

    /* ---------------------------------------------------------------------
       M05-2 通過率環圖（S）
       --------------------------------------------------------------------- */
    const AlcoholDonut = {
        name: 'AlcoholDonut',
        props: { filters: { type: Object, required: true }, size: { type: String, default: 'S' } },
        setup(props) {
            const data = computed(() => buildData(props.filters));
            const shown = M.useTween(() => data.value.rate, { decimals: 1 });

            const option = computed(() => {
                const t = KCD.theme.tokens();
                const d = data.value;
                return Object.assign(KCD.charts.base(), {
                    tooltip: Object.assign(KCD.charts.base().tooltip, {
                        trigger: 'item',
                        formatter: p => '<b>' + p.name + '</b><br>' + p.value + ' 人（' + p.percent + '%）'
                    }),
                    series: [{
                        type: 'pie',
                        radius: ['62%', '86%'],
                        center: ['50%', '50%'],
                        label: { show: false },
                        labelLine: { show: false },
                        itemStyle: { borderColor: t['sf-card'], borderWidth: 2 },
                        emphasis: { scaleSize: 4 },
                        data: STATES.map(s => ({
                            name: s.label,
                            value: d.totals[s.key],
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

            return { data, option, shown, STATES };
        },
        template: `
            <div class="ds-panel alc-donut">
                <div class="ds-panel-head">
                    <h4>酒測結果構成</h4>
                    <b>{{ data.scopeLabel }}</b>
                </div>
                <div class="alc-donut-body">
                    <div class="alc-donut-chart m-orbit">
                        <kcd-chart :option="option" height="100%" />
                        <div class="alc-donut-center m-breathe">
                            <span>通過率</span>
                            <strong>{{ shown }}<em>%</em></strong>
                        </div>
                    </div>
                    <ul class="alc-donut-list">
                        <li v-for="(s, si) in STATES" :key="s.key" class="m-rise" :style="{ '--i': si }" :class="'is-band-' + s.token">
                            <i class="alc-dot"></i>
                            <span class="alc-donut-name">{{ s.label }}</span>
                            <b>{{ data.totals[s.key] }}</b>
                            <span class="alc-donut-unit">人</span>
                        </li>
                    </ul>
                </div>
            </div>
        `
    };

    /* ---------------------------------------------------------------------
       M05-3 站所酒測構成排名（M）
       V7 要求「各站所通過／不通過／未吹的比例，並配合通過率排序」。
       100% 堆疊條：每列歸一，因此比的是構成而不是人數規模。
       --------------------------------------------------------------------- */
    const AlcoholStations = {
        name: 'AlcoholStations',
        props: { filters: { type: Object, required: true }, size: { type: String, default: 'M' } },
        emits: ['pick'],
        setup(props, { emit }) {
            const data = computed(() => buildData(props.filters));

            const option = computed(() => {
                const t = KCD.theme.tokens();
                const rev = data.value.rows.slice().reverse();

                const series = STATES.map((s, i) => ({
                    name: s.label,
                    type: 'bar',
                    stack: 'alc',
                    barWidth: 11,
                    itemStyle: {
                        color: t[s.token],
                        borderRadius: i === 0 ? [6, 0, 0, 6]
                            : (i === STATES.length - 1 ? [0, 6, 6, 0] : 0)
                    },
                    data: rev.map(r => (r.due > 0 ? Math.round((r[s.key] / r.due) * 1000) / 10 : 0))
                }));

                // 右側掛通過率標籤，用零寬 series 承載，位置跟著條走
                series.push({
                    type: 'bar', stack: 'alc', barWidth: 11, silent: true,
                    data: rev.map(() => 0),
                    label: {
                        show: true, position: 'right', distance: 8,
                        color: t['ink-1'], fontSize: t['fs-chart-label'], fontWeight: 700, fontFamily: t['fx-font-num'],
                        formatter: p => rev[p.dataIndex].rate + '%'
                    },
                    tooltip: { show: false }
                });

                return Object.assign(KCD.charts.base(), {
                    grid: { left: 2, right: 52, top: 4, bottom: 2, containLabel: true },
                    tooltip: Object.assign(KCD.charts.base().tooltip, {
                        trigger: 'axis',
                        axisPointer: { type: 'shadow', shadowStyle: { color: t['sf-hover'] } },
                        formatter(ps) {
                            const r = rev[ps[0].dataIndex];
                            const lines = STATES.map(s =>
                                '<div style="display:flex;gap:10px;justify-content:space-between">'
                                + '<span>' + s.label + '</span><b>' + r[s.key] + ' 人</b></div>').join('');
                            return '<b>' + r.name + '</b>' + lines
                                + '<div style="margin-top:4px;opacity:.7">應酒測 ' + r.due
                                + ' 人 · 通過率 ' + r.rate + '%</div>';
                        }
                    }),
                    xAxis: { type: 'value', max: 100, show: false },
                    yAxis: Object.assign(KCD.charts.axis(t), {
                        type: 'category',
                        data: rev.map(r => r.name),
                        axisLabel: { color: t['ink-1'], fontSize: t['fs-chart-name'], fontWeight: 600, fontFamily: t['fx-font-ui'] }
                    }),
                    series
                });
            });

            const chartHeight = computed(() => Math.max(140, data.value.rows.length * 30));

            function onPick(p) {
                const r = data.value.rows.slice().reverse()[p.dataIndex];
                if (r) emit('pick', { type: 'alcohol-station', name: r.name, objectLabel: '站所' });
            }

            return { data, option, chartHeight, onPick, STATES };
        },
        template: `
            <div class="ds-panel alc-stations">
                <div class="ds-panel-head">
                    <h4>站所酒測構成</h4>
                    <span class="ds-legend alc-legend">
                        <span v-for="s in STATES" :key="s.key"
                              :style="{ '--lv': 'var(--' + s.token + ')' }">{{ s.label }}</span>
                    </span>
                </div>
                <p class="ds-panel-sub">每列歸一到 100%，右側為通過率並依此排序</p>
                <kcd-chart :option="option" :height="chartHeight" @pick="onPick" />
            </div>
        `
    };

    /* ---------------------------------------------------------------------
       M05-4 酒測異常駕駛（S）
       V7 要求顯示駕駛、分公司、車號、酒測值、連續異常天數。
       酒測值帶刻度條：法定標準 0.15，超出多少一眼可見 —— 只給數字的話
       0.17 與 0.42 的嚴重度差異讀不出來。
       --------------------------------------------------------------------- */
    const AlcoholFails = {
        name: 'AlcoholFails',
        props: { filters: { type: Object, required: true }, size: { type: String, default: 'S' } },
        emits: ['pick'],
        setup(props, { emit }) {
            const data = computed(() => buildData(props.filters));
            const rows = computed(() => data.value.failDrivers);
            const spot = M.useSpotlight(() => rows.value.length, 3000);
            // 刻度條上限取「標準的 3 倍」或實際最大值，超標幅度才有比例感
            const scaleMax = computed(() => Math.max(
                data.value.limit * 3,
                ...rows.value.map(r => r.value)
            ));
            function pick(r) {
                emit('pick', { type: 'alcohol-driver', name: r.name, objectLabel: '駕駛' });
            }
            return { data, rows, spot, scaleMax, pick };
        },
        template: `
            <div class="ds-panel alc-people">
                <div class="ds-panel-head">
                    <h4>酒測異常駕駛</h4>
                    <b>標準 {{ data.limit }} mg/L · 更多 ›</b>
                </div>
                <ul v-if="rows.length" class="alc-people-list">
                    <li v-for="(r, i) in rows" :key="r.name" class="m-rise is-critical" :style="{ '--i': i }" :class="{ 'is-spot': i === spot }">
                        <button @click="pick(r)">
                            <span class="alc-person">
                                <span class="alc-person-name">{{ r.name }}</span>
                                <span class="alc-person-meta">{{ r.station }} · {{ r.plate }}</span>
                            </span>
                            <span class="alc-gauge">
                                <span class="alc-gauge-track">
                                    <b class="m-grow" :style="{ width: Math.min(100, (r.value / scaleMax) * 100) + '%', '--i': i }"></b>
                                    <i class="alc-gauge-limit"
                                       :style="{ left: (data.limit / scaleMax) * 100 + '%' }"
                                       :title="'法定標準 ' + data.limit"></i>
                                </span>
                                <em>{{ r.value }}</em>
                            </span>
                            <span class="ds-flag">連續 {{ r.days }} 天</span>
                        </button>
                    </li>
                </ul>
                <div v-else class="ds-empty"><i data-lucide="shield-check"></i>當前條件下沒有酒測異常</div>
            </div>
        `
    };

    /* ---------------------------------------------------------------------
       M05-5 未酒測駕駛（S）
       V7 要求顯示駕駛、分公司、車號、連續漏測天數。
       沒有酒測值可比，因此用連續天數排序並以天數長度成條。
       --------------------------------------------------------------------- */
    const AlcoholMisses = {
        name: 'AlcoholMisses',
        props: { filters: { type: Object, required: true }, size: { type: String, default: 'S' } },
        emits: ['pick'],
        setup(props, { emit }) {
            const data = computed(() => buildData(props.filters));
            const rows = computed(() => data.value.missDrivers);
            const spot = M.useSpotlight(() => rows.value.length, 3000);
            const maxDays = computed(() => Math.max(1, ...rows.value.map(r => r.days)));
            function pick(r) {
                emit('pick', { type: 'alcohol-driver', name: r.name, objectLabel: '駕駛' });
            }
            return { data, rows, spot, maxDays, pick };
        },
        template: `
            <div class="ds-panel alc-people">
                <div class="ds-panel-head">
                    <h4>未酒測即出車駕駛</h4>
                    <b>依連續漏測天數 · 更多 ›</b>
                </div>
                <ul v-if="rows.length" class="alc-people-list">
                    <li v-for="(r, i) in rows" :key="r.name" class="m-rise is-warn" :style="{ '--i': i }" :class="{ 'is-spot': i === spot }">
                        <button @click="pick(r)">
                            <span class="alc-person">
                                <span class="alc-person-name">{{ r.name }}</span>
                                <span class="alc-person-meta">{{ r.station }} · {{ r.plate }}</span>
                            </span>
                            <span class="ds-bar alc-days">
                                <b class="m-grow" :style="{ width: (r.days / maxDays) * 100 + '%', '--i': i }"></b>
                            </span>
                            <span class="ds-flag">連續 {{ r.days }} 天</span>
                        </button>
                    </li>
                </ul>
                <div v-else class="ds-empty"><i data-lucide="shield-check"></i>當前條件下沒有漏測紀錄</div>
            </div>
        `
    };

    /* ---------------------------------------------------------------------
       M05-6 通過率趨勢（S）
       --------------------------------------------------------------------- */
    const AlcoholTrend = {
        name: 'AlcoholTrend',
        props: { filters: { type: Object, required: true }, size: { type: String, default: 'S' } },
        setup() {
            const seed = D.ALCOHOL_TREND;
            const option = computed(() => {
                const t = KCD.theme.tokens();
                const fade = (hex, a) => {
                    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex).trim());
                    if (!m) return hex;
                    return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ','
                        + parseInt(m[3], 16) + ',' + a + ')';
                };
                return Object.assign(KCD.charts.base(), {
                    grid: { left: 2, right: 10, top: 22, bottom: 2, containLabel: true },
                    tooltip: Object.assign(KCD.charts.base().tooltip, {
                        trigger: 'axis',
                        formatter: ps => '<b>' + seed[ps[0].dataIndex].date + '</b><br>通過率 '
                            + seed[ps[0].dataIndex].rate + '%'
                    }),
                    xAxis: Object.assign(KCD.charts.axis(t), {
                        type: 'category', boundaryGap: false, data: seed.map(d => d.date)
                    }),
                    yAxis: Object.assign(KCD.charts.axis(t, { grid: true, numeric: true }), {
                        type: 'value', min: 88, max: 100,
                        axisLabel: { color: t['ink-3'], fontSize: t['fs-chart-axis'], formatter: '{value}%' }
                    }),
                    series: [{
                        type: 'line',
                        smooth: true,
                        symbolSize: 5,
                        lineStyle: KCD.charts.flowLine(t['st-normal']),
                        itemStyle: { color: t['st-normal'] },
                        areaStyle: {
                            color: {
                                type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                                colorStops: [
                                    { offset: 0, color: fade(t['st-normal'], .2) },
                                    { offset: 1, color: fade(t['st-normal'], 0) }
                                ]
                            }
                        },
                        label: {
                            show: true, position: 'top', distance: 5,
                            color: t['ink-2'], fontSize: t['fs-chart-label'], fontFamily: t['fx-font-num'],
                            formatter: p => p.value + '%'
                        },
                        data: seed.map(d => d.rate)
                    }, {
                        type: 'effectScatter',
                        symbolSize: 7,
                        rippleEffect: { scale: 3.2, brushType: 'stroke', number: 2 },
                        showEffectOn: 'render',
                        silent: true,
                        itemStyle: { color: t['st-normal'] },
                        z: 3,
                        data: [[seed.length - 1, seed[seed.length - 1].rate]]
                    }]
                });
            });
            const latest = seed[seed.length - 1];
            const delta = Math.round((latest.rate - seed[seed.length - 2].rate) * 10) / 10;
            return { option, latest, delta };
        },
        template: `
            <div class="ds-panel alc-trend">
                <div class="ds-panel-head">
                    <h4>通過率趨勢</h4>
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
       M05-7 酒測明細（L）
       --------------------------------------------------------------------- */
    const AlcoholTable = {
        name: 'AlcoholTable',
        props: { filters: { type: Object, required: true }, size: { type: String, default: 'L' } },
        emits: ['pick'],
        setup(props, { emit }) {
            const data = computed(() => buildData(props.filters));
            function pick(r) {
                emit('pick', { type: 'alcohol-station', name: r.name, objectLabel: '站所' });
            }
            return { data, pick, STATES };
        },
        template: `
            <div class="ds-panel alc-table">
                <div class="ds-panel-head">
                    <h4>站所酒測明細</h4>
                    <b>依通過率排序 · 更多 ›</b>
                </div>
                <div class="alc-table-wrap">
                    <table class="ds-table">
                        <thead>
                            <tr>
                                <th>排名</th>
                                <th class="is-text">站所</th>
                                <th>應酒測</th>
                                <th>通過</th>
                                <th>不通過</th>
                                <th>未吹即出車</th>
                                <th>通過率</th>
                                <th class="is-text">結果構成</th>
                                <th class="is-text">操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="(r, i) in data.rows" :key="r.name">
                                <td>{{ i + 1 }}</td>
                                <td class="is-text"><strong>{{ r.name }}</strong></td>
                                <td>{{ r.due }}</td>
                                <td>{{ r.pass }}</td>
                                <td :class="r.fail ? 'is-down' : ''">{{ r.fail }}</td>
                                <td :class="r.miss ? 'is-warnish' : ''">{{ r.miss }}</td>
                                <td>
                                    <span class="ds-flag" :class="r.rate >= 95 ? 'is-normal' : (r.rate >= 90 ? 'is-notice' : 'is-critical')">
                                        {{ r.rate }}%
                                    </span>
                                </td>
                                <td class="is-text">
                                    <span class="ds-band alc-seg">
                                        <i v-for="s in STATES" :key="s.key"
                                           :style="{ width: (r.due ? (r[s.key] / r.due) * 100 : 0) + '%', '--seg': 'var(--' + s.token + ')' }"
                                           :title="s.label + ' ' + r[s.key] + ' 人'"></i>
                                    </span>
                                </td>
                                <td class="is-text">
                                    <button class="alc-table-link" @click="pick(r)">既有頁面</button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p class="alc-table-note">
                    備註：通過率 =（酒測通過人數 ÷ 應酒測人數）× 100%；點擊「既有頁面」開啟酒測管理查詢分頁。
                </p>
            </div>
        `
    };

    KCD.modules = KCD.modules || {};
    const reg = (id, title, desc, sizes, icon, component) => {
        KCD.modules[id] = { id, title, desc, sizes, icon, component, board: 'std_alcohol' };
    };

    reg('alc-overview', '酒測總覽',
        '通過率、不通過人數、未吹即出車人數與通過率最佳站所。',
        ['W'], 'flask-conical', AlcoholOverview);
    reg('alc-donut', '酒測結果構成',
        '通過／不通過／未吹三態環圖，環心壓通過率。',
        ['S', 'M'], 'chart-pie', AlcoholDonut);
    reg('alc-stations', '站所酒測構成',
        '各站所三態 100% 堆疊條，右側通過率並依此排序。',
        ['M', 'L'], 'building-2', AlcoholStations);
    reg('alc-fails', '酒測異常駕駛',
        '酒測值超標的駕駛排行，含車號、酒測值刻度與連續異常天數。',
        ['S', 'M'], 'circle-x', AlcoholFails);
    reg('alc-misses', '未酒測即出車駕駛',
        '未吹酒測即出車的駕駛排行，含車號與連續漏測天數。',
        ['S', 'M'], 'circle-help', AlcoholMisses);
    reg('alc-trend', '通過率趨勢',
        '近 7 日酒測通過率折線，含與前一日變化。',
        ['S', 'M'], 'chart-line', AlcoholTrend);
    reg('alc-table', '站所酒測明細',
        '逐站所的應酒測、通過、不通過、未吹人數與通過率。',
        ['L'], 'table', AlcoholTable);
})(window.KCD);
