/* ==========================================================================
   溫度管理看板 — M06 / M07 / M08 系列
   --------------------------------------------------------------------------
   依據 V7 第 13、14 頁。

   三個場域各自獨立成線，不混在一起：
     M06 車輛      以車輛為單位
     M07 庫房      以庫房為單位；未安裝庫溫設備時整塊隱藏
     M08 移動資源  籠車、冰箱等；未啟用時整塊隱藏

   這個拆法對應技術討論會議的結論「溫度按使用場域分單元，由用戶自行組合成
   冷鏈主題」。三線的模組結構刻意做成同一套，只是資料源與單位不同 ——
   使用者學一次就能讀三個場域。

   關鍵公式（V7 明確定義，前端不重算）：
     溫控負擔 = 總異常分鐘數 ÷ 總車輛數，數值越低越好

   未開通的處理：模組讀 TEMP_FIELDS[field].installed。這是後端回傳的開通
   狀態；未開通時模組顯示明確說明而不是空圖表 —— 需求文檔 6.3 要求
   「功能未開通」與「無資料」必須是不同狀態。
   ========================================================================== */

(function (KCD) {
    'use strict';

    const { computed } = Vue;
    const D = KCD.data;
    const M = KCD.motion;

    /** 單一場域的狀態彙總。field 為 vehicle / warehouse / mobile。 */
    function buildStatus(field, filters) {
        const meta = D.TEMP_FIELDS[field];
        const tick = M.pulse.value;
        const seed = D.TEMP_STATUS[field];
        const scope = D.getBranchScope(filters);
        const mult = D.scopeMultiplier(filters);

        // 異常數即時變動；正常數由總數推回，兩者相加恆等於總數。
        const total = D.scale(seed.normal + seed.abnormal, scope ? 0.3 : mult);
        const abnormal = Math.min(total, Math.max(0, Math.round(
            M.jitter(seed.abnormal, field + 'a', .22) * (scope ? 0.3 : mult))));
        const normal = Math.max(0, total - abnormal);

        return {
            meta,
            installed: meta.installed,
            scopeLabel: scope || '全公司',
            total, normal, abnormal,
            rate: total > 0 ? Math.round((normal / total) * 1000) / 10 : 0
        };
    }

    /** 異常累計 Top 5。sensorKeys 為該場域出現過的所有溫度計名稱，
        用於堆疊圖的固定序列 —— 序列固定，顏色槽位才不會在資料變化時跳。 */
    function buildTop(field, filters) {
        const scope = D.getBranchScope(filters);
        const tick = M.pulse.value;
        let rows = D.TEMP_TOP[field].map(r => {
            const sensors = {};
            let abnormal = 0;
            Object.keys(r.sensors).forEach(k => {
                const v = Math.max(0, Math.round(M.jitter(r.sensors[k], r.name + k, .12)));
                sensors[k] = v;
                abnormal += v;
            });
            return Object.assign({}, r, {
                sensors,
                abnormal,
                // 異常累計 ÷ 壓縮機累計：這台對象的異常佔了冷鏈運行時間多少比例
                ratio: r.comp > 0 ? Math.round((abnormal / r.comp) * 1000) / 10 : 0,
                // V7 要求 hover 顯示「平均每車異常時間」：總異常 ÷ 總車輛數
                perUnit: r.fleet > 0 ? Math.round((abnormal / r.fleet) * 100) / 100 : 0
            });
        });
        if (scope) {
            const hit = rows.filter(r => r.station === scope);
            if (hit.length) rows = hit;
        }
        rows.sort((a, b) => b.abnormal - a.abnormal);

        const sensorKeys = [];
        D.TEMP_TOP[field].forEach(r => Object.keys(r.sensors).forEach(k => {
            if (!sensorKeys.includes(k)) sensorKeys.push(k);
        }));

        return { rows, sensorKeys, scopeLabel: scope || '全公司' };
    }

    /* 溫控最佳／預警對象。V7 第 13 頁第 2、3 點是兩個獨立指標，
       不是排名的頭尾 —— 因此單獨算，並帶上異常負擔數值。 */
    function buildBest(filters) {
        const tick = M.pulse.value;
        const scope = D.getBranchScope(filters);
        let list = D.TEMP_BURDEN.map(r => ({
            name: r.name,
            minutes: Math.max(0, Math.round(M.jitter(r.minutes, r.name + 'b', .1) * 10) / 10)
        }));
        if (scope) {
            const hit = list.filter(r => r.name === scope);
            if (hit.length) list = hit;
        }
        list.sort((a, b) => a.minutes - b.minutes);
        return {
            scopeLabel: scope || '全公司',
            best: list[0] || null,
            worst: list[list.length - 1] || null,
            rows: list
        };
    }

    const fmtMin = m => (m >= 60
        ? Math.floor(m / 60) + ' 小時 ' + (m % 60) + ' 分'
        : m + ' 分');

    /* ---------------------------------------------------------------------
       溫度總覽（W）
       三個場域並排，各自一格：正常／異常對象數與合規率。
       未開通的場域直接不出現在這一列 —— V7 要求未安裝就不呈現。
       --------------------------------------------------------------------- */
    const TempOverview = {
        name: 'TempOverview',
        props: { filters: { type: Object, required: true }, size: { type: String, default: 'W' } },
        emits: ['pick'],
        setup(props, { emit }) {
            const fields = computed(() => Object.keys(D.TEMP_FIELDS)
                .map(k => buildStatus(k, props.filters))
                .filter(s => s.installed));
            // 三個場域合計的異常對象數，作為整屏的主數
            const totalAbnormal = computed(() =>
                fields.value.reduce((s, f) => s + f.abnormal, 0));
            const shownAbnormal = M.useTween(() => totalAbnormal.value);
            const bumped = M.useBump(() => totalAbnormal.value);
            function pick(f) {
                emit('pick', { type: 'temp-field', name: f.meta.label, objectLabel: '溫度場域' });
            }
            return { fields, shownAbnormal, bumped, pick };
        },
        template: `
            <div class="ds-panel tmp-kpi m-scan">
                <div class="tmp-kpi-row">
                    <div class="tmp-kpi-cell is-lead" :class="shownAbnormal > 0 ? 'is-critical' : 'is-normal'">
                        <span class="tmp-kpi-label"><i class="m-live"></i>溫控異常對象</span>
                        <span class="tmp-kpi-val">
                            <strong class="m-beat" :class="{ 'm-bump': bumped }">{{ shownAbnormal }}</strong><em>個</em>
                        </span>
                        <span class="tmp-kpi-foot">{{ fields.length }} 個場域合計</span>
                    </div>
                    <button v-for="(f, fi) in fields" :key="f.meta.key"
                            class="tmp-kpi-cell is-clickable m-rise" :style="{ '--i': fi + 1 }"
                            :class="f.abnormal > 0 ? 'is-critical' : 'is-normal'"
                            @click="pick(f)">
                        <span class="tmp-kpi-label">
                            <i :data-lucide="f.meta.icon"></i>{{ f.meta.label }}
                        </span>
                        <span class="tmp-kpi-val">
                            <strong>{{ f.abnormal }}</strong><em>/ {{ f.total }} {{ f.meta.unit }}</em>
                        </span>
                        <span class="tmp-kpi-foot">合規率 {{ f.rate }}%</span>
                    </button>
                </div>
            </div>
        `
    };

    /* ---------------------------------------------------------------------
       溫控最佳與預警（W）
       V7 第 13 頁第 2、3 點：兩個獨立指標，不是排名的頭尾。
       因此獨立成模組並帶上異常負擔數值與公式說明 —— 客戶明確寫了公式，
       讀者需要知道這個數字是怎麼來的。
       --------------------------------------------------------------------- */
    const TempBest = {
        name: 'TempBest',
        props: { filters: { type: Object, required: true }, size: { type: String, default: 'W' } },
        emits: ['pick'],
        setup(props, { emit }) {
            const data = computed(() => buildBest(props.filters));
            const shownBest = M.useTween(() => (data.value.best ? data.value.best.minutes : 0), { decimals: 1 });
            const shownWorst = M.useTween(() => (data.value.worst ? data.value.worst.minutes : 0), { decimals: 1 });
            function pick(r) {
                if (r) emit('pick', { type: 'temp-station', name: r.name, objectLabel: '分公司' });
            }
            return { data, shownBest, shownWorst, pick };
        },
        template: `
            <div class="ds-panel tmp-best">
                <div class="tmp-best-row">
                    <button v-if="data.best" class="tmp-best-cell is-normal" @click="pick(data.best)">
                        <span class="tmp-best-label"><i data-lucide="award"></i>溫控最佳</span>
                        <span class="tmp-best-obj">{{ data.best.name }}</span>
                        <span class="tmp-best-val">
                            <strong>{{ shownBest }}</strong><em>分／對象</em>
                        </span>
                        <span class="tmp-best-foot">異常負擔越低越好</span>
                    </button>
                    <button v-if="data.worst" class="tmp-best-cell is-critical" @click="pick(data.worst)">
                        <span class="tmp-best-label"><i data-lucide="triangle-alert"></i>溫控預警</span>
                        <span class="tmp-best-obj">{{ data.worst.name }}</span>
                        <span class="tmp-best-val">
                            <strong>{{ shownWorst }}</strong><em>分／對象</em>
                        </span>
                        <span class="tmp-best-foot">異常負擔越高越差</span>
                    </button>
                    <div class="tmp-best-formula">
                        <span class="tmp-best-label"><i data-lucide="function-square"></i>異常負擔公式</span>
                        <code>總異常分鐘數 ÷ 總車輛數</code>
                        <span class="tmp-best-foot">
                            {{ data.scopeLabel }} · 統計期間內平均每一台車的異常負擔
                        </span>
                    </div>
                </div>
            </div>
        `
    };

    /* ---------------------------------------------------------------------
       場域狀態環圖（S）× 3
       同一個元件，三個場域各註冊一次。V7 要求用圓餅圖呈現正常與異常比例
       並顯示數字看板，三個場域各自獨立。
       --------------------------------------------------------------------- */
    function makeStatus(field) {
        return {
            name: 'TempStatus_' + field,
            props: { filters: { type: Object, required: true }, size: { type: String, default: 'S' } },
            setup(props) {
                const data = computed(() => buildStatus(field, props.filters));
                const shown = M.useTween(() => data.value.abnormal);

                const option = computed(() => {
                    const t = KCD.theme.tokens();
                    const d = data.value;
                    return Object.assign(KCD.charts.base(), {
                        tooltip: Object.assign(KCD.charts.base().tooltip, {
                            trigger: 'item',
                            formatter: p => '<b>' + p.name + '</b><br>' + p.value + ' '
                                + d.meta.unit + '（' + p.percent + '%）'
                        }),
                        series: [{
                            type: 'pie',
                            radius: ['60%', '85%'],
                            center: ['50%', '50%'],
                            label: { show: false },
                            labelLine: { show: false },
                            itemStyle: { borderColor: t['sf-card'], borderWidth: 2 },
                            emphasis: { scaleSize: 4 },
                            data: [
                                { name: '溫度正常', value: d.normal, itemStyle: { color: t['st-normal'] } },
                                { name: '溫度異常', value: d.abnormal, itemStyle: { color: t['st-critical'] } }
                            ]
                        }]
                    });
                });

                return { data, option, shown };
            },
            template: `
                <div class="ds-panel tmp-status">
                    <div class="ds-panel-head">
                        <h4>{{ data.meta.label }}溫度狀態</h4>
                        <b>{{ data.scopeLabel }}</b>
                    </div>
                    <!-- 未開通與無資料是不同狀態：未開通給明確說明，不畫空圖表 -->
                    <div v-if="!data.installed" class="ds-empty">
                        <i data-lucide="plug-zap"></i>尚未安裝{{ data.meta.label }}溫度設備
                    </div>
                    <div v-else class="tmp-status-body">
                        <div class="tmp-status-chart">
                            <kcd-chart :option="option" height="100%" />
                            <div class="tmp-status-center m-breathe">
                                <span>合規率</span>
                                <strong>{{ data.rate }}<em>%</em></strong>
                            </div>
                        </div>
                        <ul class="tmp-status-list">
                            <li class="is-normal">
                                <i class="tmp-dot"></i>
                                <span>溫度正常</span>
                                <b>{{ data.normal }}</b>
                                <em>{{ data.meta.unit }}</em>
                            </li>
                            <li class="is-critical">
                                <i class="tmp-dot"></i>
                                <span>溫度異常</span>
                                <b>{{ shown }}</b>
                                <em>{{ data.meta.unit }}</em>
                            </li>
                        </ul>
                        <p class="tmp-status-note">
                            任一溫度計異常即列為異常{{ data.meta.label }}
                        </p>
                    </div>
                </div>
            `
        };
    }

    /* ---------------------------------------------------------------------
       溫控負擔排名（S）
       V7：溫控負擔 = 總異常分鐘數 ÷ 總車輛數，越低越好。
       因此排序方向與其他排行相反 —— 條短的在上面。用文字明講，
       避免讀者按「長條＝好」的直覺誤讀。
       --------------------------------------------------------------------- */
    const TempBurden = {
        name: 'TempBurden',
        props: { filters: { type: Object, required: true }, size: { type: String, default: 'S' } },
        emits: ['pick'],
        setup(props, { emit }) {
            const rows = computed(() => {
                const tick = M.pulse.value;
                const scope = D.getBranchScope(props.filters);
                let list = D.TEMP_BURDEN.map(r => ({
                    name: r.name,
                    minutes: Math.max(0, Math.round(M.jitter(r.minutes, r.name + 'b', .1) * 10) / 10)
                }));
                if (scope) {
                    const hit = list.filter(r => r.name === scope);
                    if (hit.length) list = hit;
                }
                return list.sort((a, b) => a.minutes - b.minutes);
            });

            const option = computed(() => {
                const t = KCD.theme.tokens();
                // y 軸自下而上，因此反轉後負擔最低的在最上面
                const rev = rows.value.slice().reverse();
                const max = Math.max(1, ...rows.value.map(r => r.minutes));
                return Object.assign(KCD.charts.base(), {
                    grid: { left: 2, right: 52, top: 2, bottom: 2, containLabel: true },
                    tooltip: Object.assign(KCD.charts.base().tooltip, {
                        trigger: 'item',
                        formatter(p) {
                            const r = rev[p.dataIndex];
                            return '<b>' + r.name + '</b><br>溫控負擔 ' + r.minutes + ' 分／對象<br>'
                                + '<span style="opacity:.7">總異常分鐘 ÷ 總對象數，越低越好</span>';
                        }
                    }),
                    xAxis: { type: 'value', show: false },
                    yAxis: Object.assign(KCD.charts.axis(t), {
                        type: 'category',
                        data: rev.map(r => r.name),
                        axisLabel: { color: t['ink-2'], fontSize: t['fs-chart-name'], fontFamily: t['fx-font-ui'] }
                    }),
                    series: [{
                        type: 'bar',
                        barWidth: 9,
                        itemStyle: { borderRadius: [0, 5, 5, 0] },
                        label: {
                            show: true, position: 'right', distance: 6,
                            color: t['ink-1'], fontSize: t['fs-chart-label'], fontWeight: 600, fontFamily: t['fx-font-num'],
                            formatter: p => rev[p.dataIndex].minutes + ' 分'
                        },
                        data: rev.map(r => ({
                            value: r.minutes,
                            // 負擔越高越接近嚴重色；門檻由後端配置時改讀回傳值
                            itemStyle: {
                                color: r.minutes <= 5 ? t['st-normal']
                                    : (r.minutes <= 10 ? t['st-notice']
                                        : (r.minutes <= 20 ? t['st-warn'] : t['st-critical']))
                            }
                        }))
                    }]
                });
            });

            const chartHeight = computed(() => Math.max(110, rows.value.length * 26));

            function onPick(p) {
                const r = rows.value.slice().reverse()[p.dataIndex];
                if (r) emit('pick', { type: 'temp-station', name: r.name, objectLabel: '分公司' });
            }

            return { rows, option, chartHeight, onPick };
        },
        template: `
            <div class="ds-panel tmp-burden">
                <div class="ds-panel-head">
                    <h4>溫控負擔排名</h4>
                    <b>越低越好</b>
                </div>
                <p class="ds-panel-sub">總異常分鐘 ÷ 總對象數；條越短代表溫控表現越好</p>
                <kcd-chart v-if="rows.length" :option="option" :height="chartHeight" @pick="onPick" />
                <div v-else class="ds-empty"><i data-lucide="inbox"></i>當前條件下沒有溫控資料</div>
            </div>
        `
    };

    /* ---------------------------------------------------------------------
       異常累計分析（L）× 3
       本看板最重的模組。V7 要求一次呈現：對象、安裝設備、各溫度計異常累計
       時間佔比（堆疊）、異常累計／壓縮機累計、當日壓縮機起訖時間。

       堆疊條回答「異常由哪支溫度計貢獻」；右側的壓縮機區間條回答「異常落在
       冷鏈運行的哪一段」。兩者並排，因此一眼能看出「這台車的異常是不是集中在
       壓縮機沒開的時段」。
       --------------------------------------------------------------------- */
    function makeTop(field) {
        return {
            name: 'TempTop_' + field,
            props: { filters: { type: Object, required: true }, size: { type: String, default: 'L' } },
            emits: ['pick'],
            setup(props, { emit }) {
                const meta = D.TEMP_FIELDS[field];
                const data = computed(() => buildTop(field, props.filters));
                const spot = M.useSpotlight(() => data.value.rows.length, 3400);

                const option = computed(() => {
                    const t = KCD.theme.tokens();
                    const rows = data.value.rows;
                    const rev = rows.slice().reverse();
                    const keys = data.value.sensorKeys;

                    const series = keys.map((k, i) => ({
                        name: k,
                        type: 'bar',
                        stack: 'sensor',
                        barWidth: 12,
                        itemStyle: {
                            // 類別色固定槽位：同一支溫度計在資料變化時顏色不變
                            color: t['cat-' + ((i % 8) + 1)],
                            borderRadius: i === 0 ? [4, 0, 0, 4]
                                : (i === keys.length - 1 ? [0, 4, 4, 0] : 0)
                        },
                        data: rev.map(r => r.sensors[k] || 0)
                    }));

                    // 右側掛異常累計總數
                    series.push({
                        type: 'bar', stack: 'sensor', barWidth: 12, silent: true,
                        data: rev.map(() => 0),
                        label: {
                            show: true, position: 'right', distance: 8,
                            color: t['ink-1'], fontSize: t['fs-chart-label'], fontWeight: 600, fontFamily: t['fx-font-num'],
                            formatter: p => rev[p.dataIndex].abnormal + ' 分'
                        },
                        tooltip: { show: false }
                    });

                    return Object.assign(KCD.charts.base(), {
                        grid: { left: 2, right: 56, top: 4, bottom: 2, containLabel: true },
                        tooltip: Object.assign(KCD.charts.base().tooltip, {
                            trigger: 'axis',
                            axisPointer: { type: 'shadow', shadowStyle: { color: t['sf-hover'] } },
                            formatter(ps) {
                                const r = rev[ps[0].dataIndex];
                                const lines = keys.filter(k => r.sensors[k]).map(k =>
                                    '<div style="display:flex;gap:10px;justify-content:space-between">'
                                    + '<span>' + k + '累計</span><b>' + r.sensors[k] + ' 分</b></div>').join('');
                                /* V7 明列 hover 要顯示：總車輛數、各溫度計累計異常時間、
                                   平均每車異常時間、冷鏈運行時間。四項齊備。 */
                                return '<b>' + r.name + '</b><br>'
                                    + '<span style="opacity:.7">' + r.station + ' · 安裝 '
                                    + r.devices + ' 支溫度計 · 總車輛數 ' + r.fleet + '</span>'
                                    + lines
                                    + '<div style="margin-top:4px;padding-top:4px;border-top:1px solid rgba(255,255,255,.12)">'
                                    + '<div style="display:flex;gap:10px;justify-content:space-between">'
                                    + '<span>異常累計</span><b>' + r.abnormal + ' 分</b></div>'
                                    + '<div style="display:flex;gap:10px;justify-content:space-between">'
                                    + '<span>平均每車異常</span><b>' + r.perUnit + ' 分</b></div>'
                                    + '<div style="display:flex;gap:10px;justify-content:space-between">'
                                    + '<span>冷鏈運行時間</span><b>' + r.comp + ' 分</b></div>'
                                    + '<div style="display:flex;gap:10px;justify-content:space-between">'
                                    + '<span>異常佔冷鏈</span><b>' + r.ratio + '%</b></div></div>';
                            }
                        }),
                        xAxis: { type: 'value', show: false },
                        yAxis: Object.assign(KCD.charts.axis(t), {
                            type: 'category',
                            data: rev.map(r => r.name),
                            axisLabel: { color: t['ink-1'], fontSize: t['fs-chart-name'], fontFamily: t['fx-font-ui'] }
                        }),
                        series
                    });
                });

                const chartHeight = computed(() => Math.max(130, data.value.rows.length * 30));

                /* 壓縮機區間條：把起訖時間換成一天 24 小時上的百分比位置。
                   庫房多為全天運行，因此會是滿條 —— 那本身就是資訊。 */
                function bar(row) {
                    const toMin = s => {
                        const [h, m] = s.split(':').map(Number);
                        return h * 60 + m;
                    };
                    const from = toMin(row.from), to = toMin(row.to);
                    return {
                        left: (from / 1440) * 100,
                        width: Math.max(1, ((to - from) / 1440) * 100)
                    };
                }

                function pick(r) {
                    emit('pick', { type: 'temp-object', name: r.name, objectLabel: meta.label });
                }

                return { meta, data, option, chartHeight, spot, bar, pick, fmtMin };
            },
            template: `
                <div class="ds-panel tmp-top">
                    <div class="ds-panel-head">
                        <h4>{{ meta.label }}異常累計分析</h4>
                        <b>{{ data.scopeLabel }} · 前 {{ data.rows.length }} 名 · 更多 ›</b>
                    </div>
                    <div v-if="!meta.installed" class="ds-empty">
                        <i data-lucide="plug-zap"></i>尚未安裝{{ meta.label }}溫度設備
                    </div>
                    <div v-else-if="!data.rows.length" class="ds-empty">
                        <i data-lucide="inbox"></i>當前條件下沒有{{ meta.label }}異常
                    </div>
                    <div v-else class="tmp-top-body">
                        <div class="tmp-top-chart">
                            <div class="tmp-top-cap">
                                各溫度計異常累計佔比
                                <span class="ds-legend tmp-sensor-legend">
                                    <span v-for="(k, i) in data.sensorKeys" :key="k"
                                          :style="{ '--lv': 'var(--cat-' + ((i % 8) + 1) + ')' }">{{ k }}</span>
                                </span>
                            </div>
                            <kcd-chart :option="option" :height="chartHeight" />
                        </div>
                        <div class="tmp-top-rail">
                            <div class="tmp-top-cap">當日壓縮機運行區間與異常佔比</div>
                            <ul class="tmp-rail-list">
                                <li v-for="(r, i) in data.rows" :key="r.name" class="m-rise" :style="{ '--i': i }"
                                    :class="{ 'is-spot': i === spot }">
                                    <button @click="pick(r)">
                                        <span class="tmp-rail-head">
                                            <strong>{{ r.name }}</strong>
                                            <span class="tmp-rail-dev">{{ r.devices }} 支</span>
                                        </span>
                                        <span class="tmp-rail-track">
                                            <i class="tmp-rail-comp"
                                               :style="{ left: bar(r).left + '%', width: bar(r).width + '%' }"
                                               :title="'壓縮機 ' + r.from + ' ~ ' + r.to"></i>
                                        </span>
                                        <span class="tmp-rail-meta">
                                            <span>{{ r.from }} ~ {{ r.to }}</span>
                                            <b>異常 {{ r.ratio }}%</b>
                                        </span>
                                    </button>
                                </li>
                            </ul>
                        </div>
                    </div>
                    <p class="tmp-top-note">
                        備註：異常累計時間與壓縮機累計時間由後端統計；比例 = 異常累計 ÷ 壓縮機累計。
                    </p>
                </div>
            `
        };
    }

    /* ---------------------------------------------------------------------
       M08-2 無線溫度設備健康（M）
       V7：車輛／庫房門市／移動設備偵測到的低電壓與停訊次數。
       設備矩陣：對象類型 × 狀態交叉，一眼看出哪個場域的設備在掉。
       --------------------------------------------------------------------- */
    const TempDevices = {
        name: 'TempDevices',
        props: { filters: { type: Object, required: true }, size: { type: String, default: 'M' } },
        emits: ['pick'],
        setup(props, { emit }) {
            const rows = computed(() => {
                const tick = M.pulse.value;
                return D.TEMP_DEVICES.map(r => {
                    const lowBattery = Math.max(0, Math.round(M.jitter(r.lowBattery, r.field + 'l', .3)));
                    const offline = Math.max(0, Math.round(M.jitter(r.offline, r.field + 'o', .3)));
                    return Object.assign({}, r, {
                        lowBattery, offline,
                        healthy: Math.max(0, r.total - lowBattery - offline)
                    });
                });
            });
            const totals = computed(() => ({
                lowBattery: rows.value.reduce((s, r) => s + r.lowBattery, 0),
                offline: rows.value.reduce((s, r) => s + r.offline, 0)
            }));
            const shownLow = M.useTween(() => totals.value.lowBattery);
            const shownOff = M.useTween(() => totals.value.offline);
            function pick(r) {
                emit('pick', { type: 'temp-device', name: r.field, objectLabel: '設備場域' });
            }
            return { rows, totals, shownLow, shownOff, pick, installed: D.TEMP_FIELDS.mobile.installed };
        },
        template: `
            <div class="ds-panel tmp-devices">
                <div class="ds-panel-head">
                    <h4>無線溫度設備健康</h4>
                    <span class="tmp-dev-tally">
                        <span class="ds-flag is-notice">低電壓 {{ shownLow }}</span>
                        <span class="ds-flag is-offline">停訊 {{ shownOff }}</span>
                    </span>
                </div>
                <div v-if="!installed" class="ds-empty">
                    <i data-lucide="plug-zap"></i>尚未安裝無線溫度設備
                </div>
                <table v-else class="ds-table tmp-dev-table">
                    <thead>
                        <tr>
                            <th class="is-text">對象類型</th>
                            <th>設備總數</th>
                            <th>低電壓</th>
                            <th>停訊</th>
                            <th class="is-text">狀態構成</th>
                            <th>最後通信</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="r in rows" :key="r.field" @click="pick(r)" class="is-clickable">
                            <td class="is-text"><strong>{{ r.field }}</strong></td>
                            <td>{{ r.total }}</td>
                            <td :class="r.lowBattery ? 'is-notice-text' : ''">{{ r.lowBattery }}</td>
                            <td :class="r.offline ? 'is-offline-text' : ''">{{ r.offline }}</td>
                            <td class="is-text">
                                <span class="ds-band tmp-dev-band">
                                    <i :style="{ width: (r.healthy / r.total) * 100 + '%', '--seg': 'var(--st-normal)' }"
                                       :title="'正常 ' + r.healthy"></i>
                                    <i :style="{ width: (r.lowBattery / r.total) * 100 + '%', '--seg': 'var(--st-notice)' }"
                                       :title="'低電壓 ' + r.lowBattery"></i>
                                    <i :style="{ width: (r.offline / r.total) * 100 + '%', '--seg': 'var(--st-offline)' }"
                                       :title="'停訊 ' + r.offline"></i>
                                </span>
                            </td>
                            <td>{{ r.lastSeen }}</td>
                        </tr>
                    </tbody>
                </table>
                <p class="tmp-top-note">沿用第二套 DM04 看板欄位；未安裝無線溫度設備時本模組不呈現。</p>
            </div>
        `
    };

    /* ---------------------------------------------------------------------
       溫度合規率趨勢（S）
       --------------------------------------------------------------------- */
    const TempTrend = {
        name: 'TempTrend',
        props: { filters: { type: Object, required: true }, size: { type: String, default: 'S' } },
        setup() {
            const seed = D.TEMP_TREND;
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
                        formatter: ps => '<b>' + seed[ps[0].dataIndex].at + '</b><br>合規率 '
                            + seed[ps[0].dataIndex].rate + '%'
                    }),
                    xAxis: Object.assign(KCD.charts.axis(t), {
                        type: 'category', boundaryGap: false, data: seed.map(d => d.at)
                    }),
                    yAxis: Object.assign(KCD.charts.axis(t, { grid: true, numeric: true }), {
                        type: 'value', min: 88, max: 100,
                        axisLabel: { color: t['ink-3'], fontSize: t['fs-chart-axis'], formatter: '{value}%' }
                    }),
                    series: [{
                        type: 'line',
                        smooth: true,
                        symbolSize: 5,
                        lineStyle: KCD.charts.flowLine(t['st-info']),
                        itemStyle: { color: t['st-info'] },
                        areaStyle: {
                            color: {
                                type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                                colorStops: [
                                    { offset: 0, color: fade(t['st-info'], .22) },
                                    { offset: 1, color: fade(t['st-info'], 0) }
                                ]
                            }
                        },
                        data: seed.map(d => d.rate)
                    }, {
                        type: 'effectScatter',
                        symbolSize: 7,
                        rippleEffect: { scale: 3.2, brushType: 'stroke', number: 2 },
                        showEffectOn: 'render',
                        silent: true,
                        itemStyle: { color: t['st-info'] },
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
            <div class="ds-panel tmp-trend">
                <div class="ds-panel-head">
                    <h4>溫度合規率趨勢</h4>
                    <b>近 24 小時</b>
                </div>
                <p class="ds-panel-sub">
                    最新 {{ latest.rate }}%
                    <span :class="delta >= 0 ? 'is-up' : 'is-down'">
                        {{ delta >= 0 ? '▲' : '▼' }} {{ Math.abs(delta) }}%
                    </span>
                    較前一時段
                </p>
                <kcd-chart :option="option" height="100%" />
            </div>
        `
    };

    KCD.modules = KCD.modules || {};
    const reg = (id, title, desc, sizes, icon, component) => {
        KCD.modules[id] = { id, title, desc, sizes, icon, component, board: 'std_temperature' };
    };

    reg('tmp-overview', '溫度總覽',
        '三個場域的異常對象數與合規率，未安裝的場域不呈現。',
        ['W'], 'thermometer', TempOverview);
    reg('tmp-best', '溫控最佳與預警',
        '溫控最佳與預警分公司及其異常負擔（總異常分鐘 ÷ 總車輛數）。',
        ['W'], 'award', TempBest);
    reg('tmp-vehicle-status', '車輛溫度狀態',
        '車輛正常／異常環圖與合規率；任一溫度計異常即列為異常車輛。',
        ['S', 'M'], 'truck', makeStatus('vehicle'));
    reg('tmp-warehouse-status', '庫房溫度狀態',
        '庫房正常／異常環圖與合規率；未安裝庫溫設備時不呈現。',
        ['S', 'M'], 'warehouse', makeStatus('warehouse'));
    reg('tmp-mobile-status', '移動資源溫度狀態',
        '籠車、冰箱等移動資源的正常／異常環圖；未啟用時不呈現。',
        ['S', 'M'], 'container', makeStatus('mobile'));
    reg('tmp-burden', '溫控負擔排名',
        '各分公司的平均異常負擔（總異常分鐘 ÷ 總對象數），越低越好。',
        ['S', 'M'], 'trending-down', TempBurden);
    reg('tmp-vehicle-top', '車輛異常累計分析',
        '車輛 Top 5：各溫度計異常累計堆疊、壓縮機運行區間與異常佔比。',
        ['L'], 'layers', makeTop('vehicle'));
    reg('tmp-warehouse-top', '庫房異常累計分析',
        '庫房 Top 5，欄位同車輛；未安裝庫溫設備時不呈現。',
        ['L'], 'layers', makeTop('warehouse'));
    reg('tmp-mobile-top', '移動資源異常累計分析',
        '移動資源 Top 5，欄位同車輛；未啟用時不呈現。',
        ['L'], 'layers', makeTop('mobile'));
    reg('tmp-devices', '無線溫度設備健康',
        '車輛／庫房門市／移動設備的低電壓與停訊次數及最後通信時間。',
        ['M', 'L'], 'radio', TempDevices);
    reg('tmp-trend', '溫度合規率趨勢',
        '近 24 小時的溫度合規率折線。',
        ['S', 'M'], 'chart-line', TempTrend);
})(window.KCD);
