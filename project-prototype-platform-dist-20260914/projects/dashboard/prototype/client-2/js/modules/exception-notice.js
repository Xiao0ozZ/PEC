/* ==========================================================================
   異常通報 — M04-1 車輛通報狀況總覽 / M04-2 異常表現對象 / M04-3 各項異常通報監測
   --------------------------------------------------------------------------
   依據 V7 第 9 / 10 頁（總公司與分公司兩個視角）。

   主視覺刻意不用環形圖。舊原型 8 個核心模組有 7 個是「環 + KPI + 列表 + 三小卡」
   同一骨架，那是客戶說「同質化」的根因。本模組要回答的是「異常出在哪些項目、
   要處理誰」，所以主視覺是依通報件數排序的警示燈陣列（annunciator panel）——
   卡車儀表台上那排警告燈，既是業務語義本身，也是題材世界裡的真實器物。

   需求文檔 4.2 已把本模組拆成三個呈現單元。此處先保留單一模組實作，
   拆分待該看板整體重做時一併處理（拆分後 M04-1 為 W、M04-2 為 M、M04-3 為 L）。
   ========================================================================== */

(function (KCD) {
    'use strict';

    const { computed } = Vue;
    const D = KCD.data;

    const BRANCH_OBJECTS = [
        { name: '臺北總部', reports: 2, rate: 0.8 },
        { name: '新竹研發中心', reports: 5, rate: 1.2 },
        { name: '臺中站', reports: 7, rate: 3.4 },
        { name: '苗栗維修站', reports: 9, rate: 6.2 },
        { name: '宜蘭配送點', reports: 12, rate: 8.5 }
    ];

    const VEHICLE_OBJECTS = {
        '臺北站': [
            { name: 'KCD-101', reports: 1, rate: 1.8 },
            { name: 'KCD-620', reports: 2, rate: 3.1 },
            { name: 'KCD-205', reports: 5, rate: 8.4 },
            { name: 'KCD-318', reports: 7, rate: 12.6 },
            { name: 'KCD-522', reports: 9, rate: 18.2 }
        ],
        '新竹站': [
            { name: 'HSZ-019', reports: 1, rate: 2.2 },
            { name: 'HSZ-266', reports: 2, rate: 4.0 },
            { name: 'HSZ-076', reports: 4, rate: 7.5 },
            { name: 'HSZ-118', reports: 6, rate: 11.3 },
            { name: 'HSZ-205', reports: 8, rate: 16.4 }
        ]
    };

    // enabled 對應 V7「有設定異常通報才顯示有設定的項目」。
    // forceLevel 對應「動效強度由後端狀態等級驅動，不由前端按數值判斷」——
    // 求救[SOS] 只要 1 件就是嚴重，與件數門檻無關。
    const ITEM_SEED = [
        { key: 'temp', label: '溫度分級', icon: 'thermometer', reports: 0, vehicles: 0, top: '—', enabled: true },
        { key: 'dispatch', label: '調度過線', icon: 'zap', reports: 15, vehicles: 7, top: '新竹研發中心', enabled: true },
        { key: 'humidity', label: '濕度過線', icon: 'droplets', reports: 0, vehicles: 0, top: '—', enabled: false },
        { key: 'sos', label: '求救[SOS]', icon: 'bell-ring', reports: 1, vehicles: 1, top: '宜蘭配送點', enabled: true, forceLevel: 'critical' },
        { key: 'detect', label: '偵測異常', icon: 'radio', reports: 8, vehicles: 3, top: '苗栗維修站', enabled: true },
        { key: 'speed', label: '超速過線', icon: 'gauge', reports: 42, vehicles: 12, top: '苗栗維修站', enabled: true },
        { key: 'idle', label: '怠速過久', icon: 'clock-3', reports: 5, vehicles: 3, top: '臺中站', enabled: true },
        { key: 'ignition', label: '發動過線', icon: 'power', reports: 23, vehicles: 8, top: '高雄站', enabled: true },
        { key: 'offline', label: '車輛停訊', icon: 'plug-zap', reports: 3, vehicles: 2, top: '臺北站', enabled: true, forceLevel: 'offline' },
        { key: 'voltage', label: '電壓異常', icon: 'battery-warning', reports: 2, vehicles: 2, top: '高雄站', enabled: true },
        { key: 'battery', label: '電瓶水位', icon: 'circle-gauge', reports: 0, vehicles: 0, top: '—', enabled: true },
        { key: 'ibutton', label: 'iButton', icon: 'user-round', reports: 1, vehicles: 1, top: '新竹站', enabled: true }
    ];

    // 程度化色彩的兩個分界。V7 要求可調；已升級為看板級條件（需求文檔 5.2）。
    const MID_THRESHOLD = 5;
    const HOT_THRESHOLD = 15;

    function levelOf(item) {
        if (item.forceLevel) return item.forceLevel;
        if (item.reports === 0) return 'void';
        if (item.reports >= HOT_THRESHOLD) return 'critical';
        if (item.reports >= MID_THRESHOLD) return 'warn';
        return 'low';
    }

    const LEVEL_TEXT = {
        void: '無通報', low: '低頻', warn: '中度', critical: '嚴重', offline: '停訊'
    };
    const LEVEL_ICON = {
        void: 'minus', low: 'info', warn: 'triangle-alert', critical: 'siren', offline: 'wifi-off'
    };

    function buildData(filters) {
        const scope = D.getBranchScope(filters);
        const isBranch = Boolean(scope);
        const mult = D.scopeMultiplier(filters);

        let objects = isBranch ? (VEHICLE_OBJECTS[scope] || VEHICLE_OBJECTS['臺北站']) : BRANCH_OBJECTS;
        if (isBranch && filters.vehicle !== 'all') {
            const picked = objects.filter(o => o.name.toLowerCase() === filters.vehicle);
            if (picked.length) objects = picked;
        }

        // 已排序序列由後端回傳，前端不重新推斷排名。
        const byRateAsc = objects.slice().sort((a, b) => a.rate - b.rate);
        const branchScale = isBranch ? 0.42 : 1;

        const items = ITEM_SEED
            .filter(item => item.enabled)
            .map(item => {
                const reports = D.scale(Math.round(item.reports * branchScale), mult);
                const out = Object.assign({}, item, {
                    reports,
                    vehicles: D.scale(Math.round(item.vehicles * branchScale), mult),
                    top: isBranch && item.top !== '—' ? objects[objects.length - 1].name : item.top,
                    // 未結數與結案率：V7 要求點擊後在第二層呈現。
                    unresolved: Math.max(0, Math.round(reports * 0.35)),
                    closeRate: reports === 0 ? null : Math.min(100, 62 + (item.key.length * 4) % 34)
                });
                out.level = levelOf(out);
                return out;
            })
            .sort((a, b) => b.reports - a.reports);

        const monitored = D.scale(isBranch ? 52 : 225, mult);
        const abnormal = D.scale(isBranch ? 3 : 7, mult);

        return {
            calculatedAt: '14:03',
            isBranch,
            scopeLabel: isBranch ? scope : '全公司',
            objectLabel: isBranch ? '車輛' : '分公司',
            totals: {
                monitored,
                abnormal,
                // 正常數 = 結案 + 未觸發任何異常警報（V7 第 9 頁定義）
                normal: Math.max(0, monitored - abnormal)
            },
            // 異常率最低者為最佳；預警區固定保留 Top 5 的資訊密度。
            best: byRateAsc.slice(0, 2),
            worst: byRateAsc.slice().reverse().slice(0, 5),
            items
        };
    }

    /* ---------------------------------------------------------------------
       M04-1 車輛通報狀況總覽（帶狀 W）
       V7 第 9 頁：全台總數、正常數、異常數。
       --------------------------------------------------------------------- */
    const ExceptionOverview = {
        name: 'ExceptionOverview',
        props: { filters: { type: Object, required: true }, size: { type: String, default: 'W' } },
        setup(props) {
            const data = computed(() => buildData(props.filters));
            const normalPct = computed(() => D.pct(data.value.totals.normal, data.value.totals.monitored));
            const abnormalPct = computed(() => D.pct(data.value.totals.abnormal, data.value.totals.monitored));
            const severe = computed(() => data.value.items.filter(i => i.level === 'critical').length);
            return { data, normalPct, abnormalPct, severe };
        },
        template: `
            <div class="exn-command ds-panel">
                <div class="exn-command-head">
                    <h4>異常總覽<span class="ds-info" tabindex="0"
                        data-tip="狀態、數量與嚴重程度均由後端回傳"><i data-lucide="info"></i></span></h4>
                    <b>{{ data.scopeLabel }} · 資料 {{ data.calculatedAt }}</b>
                </div>
                <div class="exn-command-grid">
                    <div class="exn-command-kpi is-info">
                        <span>監測車輛</span><strong>{{ data.totals.monitored }}<em>台</em></strong><small>目前監測範圍</small>
                    </div>
                    <div class="exn-command-kpi is-normal">
                        <span>正常車輛</span><strong>{{ data.totals.normal }}<em>台</em></strong><small>占比 {{ normalPct }}%</small>
                    </div>
                    <div class="exn-command-kpi is-critical">
                        <span>異常未排除</span><strong>{{ data.totals.abnormal }}<em>台</em></strong><small>占比 {{ abnormalPct }}%</small>
                        <i v-if="data.totals.abnormal" class="ds-ping"></i>
                    </div>
                    <div class="exn-command-kpi is-warn">
                        <span>嚴重異常項目</span><strong>{{ severe }}<em>項</em></strong><small>需優先關注</small>
                    </div>
                </div>
            </div>
        `
    };

    /* ---------------------------------------------------------------------
       M04-2 異常表現對象（M / S）
       V7 第 9 / 10 頁：異常率最低者為最佳；分公司視角預警列 Top 5。
       --------------------------------------------------------------------- */
    const ExceptionObjects = {
        name: 'ExceptionObjects',
        props: { filters: { type: Object, required: true }, size: { type: String, default: 'M' } },
        emits: ['pick'],
        setup(props, { emit }) {
            const data = computed(() => buildData(props.filters));
            // 條長歸一到當前最大異常率，否則低異常率的條短到看不見。
            const maxRate = computed(() => Math.max(1, ...data.value.worst.map(o => o.rate)));
            function pick(o) {
                emit('pick', { type: 'exception-object', name: o.name, objectLabel: data.value.objectLabel });
            }
            return { data, maxRate, pick };
        },
        template: `
            <div class="exn-objects ds-panel" :class="{ 'is-compact': size === 'S' }">
                <div class="ds-panel-head">
                    <h4>高風險{{ data.objectLabel }}（未解除）</h4>
                    <b>更多 ›</b>
                </div>
                <div class="exn-best-strip">
                    <span><i data-lucide="award"></i>表現最佳</span>
                    <button v-for="o in data.best" :key="o.name" @click="pick(o)">
                        <strong>{{ o.name }}</strong><em>{{ o.reports }} 件 · {{ o.rate }}%</em>
                    </button>
                </div>
                <div class="exn-risk-list">
                    <button v-for="(o, i) in data.worst" :key="o.name" class="exn-risk-row" @click="pick(o)">
                        <span class="ds-flag is-critical">高風險</span>
                        <span class="exn-risk-name"><strong>{{ o.name }}</strong><small>{{ data.objectLabel }}排名 {{ i + 1 }}</small></span>
                        <span class="exn-risk-bar"><i :style="{ width: (o.rate / maxRate) * 100 + '%' }"></i></span>
                        <span class="exn-risk-value"><strong>{{ o.reports }}</strong> 件</span>
                        <span class="exn-risk-rate">{{ o.rate }}%</span>
                    </button>
                </div>
            </div>
        `
    };

    /* ---------------------------------------------------------------------
       M04-3 各項異常通報監測（L / M）
       主視覺是警示燈陣列（annunciator panel）—— 卡車儀表台上那排警告燈。
       舊原型 8 個模組有 7 個是「環 + KPI + 列表」同一骨架，客戶說同質化，
       所以這裡不用環圖：本模組要回答「異常出在哪些項目、要處理誰」。
       L 規格右側附件數排序條，判斷主要異常來源。
       --------------------------------------------------------------------- */
    const ExceptionMatrix = {
        name: 'ExceptionMatrix',
        props: { filters: { type: Object, required: true }, size: { type: String, default: 'L' } },
        emits: ['pick'],
        setup(props, { emit }) {
            const data = computed(() => buildData(props.filters));

            const pareto = computed(() => {
                const items = data.value.items;
                const total = items.reduce((s, i) => s + i.reports, 0);
                const top3 = items.slice(0, 3).reduce((s, i) => s + i.reports, 0);
                return { total, pct: D.pct(top3, total) };
            });

            const ranked = computed(() => data.value.items.filter(i => i.reports > 0));

            const option = computed(() => {
                const t = KCD.theme.tokens();
                const rev = ranked.value.slice().reverse();
                const levelColor = {
                    critical: t['st-critical'], warn: t['st-warn'], low: t['st-info'],
                    offline: t['st-offline'], void: t['ink-3']
                };
                return Object.assign(KCD.charts.base(), {
                    grid: { left: 2, right: 44, top: 4, bottom: 2, containLabel: true },
                    tooltip: Object.assign(KCD.charts.base().tooltip, {
                        trigger: 'item',
                        formatter(p) {
                            const it = rev[p.dataIndex];
                            return '<b>' + it.label + '</b><br>通報 ' + it.reports + ' 件<br>'
                                + '涉及車輛 ' + it.vehicles + ' 台<br>'
                                + '<span style="opacity:.7">未結 ' + it.unresolved + ' 件'
                                + (it.closeRate == null ? '' : '，結案率 ' + it.closeRate + '%') + '</span>';
                        }
                    }),
                    xAxis: { type: 'value', show: false },
                    yAxis: Object.assign(KCD.charts.axis(t), {
                        type: 'category',
                        data: rev.map(i => i.label),
                        axisLabel: { color: t['ink-1'], fontSize: t['fs-chart-name'], fontFamily: t['fx-font-ui'] }
                    }),
                    series: [{
                        type: 'bar',
                        barWidth: 11,
                        itemStyle: {
                            borderRadius: [0, 6, 6, 0],
                            color: p => levelColor[rev[p.dataIndex].level] || t['seq-hue']
                        },
                        label: {
                            show: true, position: 'right', distance: 6,
                            color: t['ink-2'], fontFamily: t['fx-font-num'], fontSize: t['fs-chart-label'],
                            formatter: p => rev[p.dataIndex].reports + ' 件'
                        },
                        data: rev.map(i => i.reports)
                    }]
                });
            });

            function pick(item) {
                // V7：點擊先開第二層（未結數、結案率），再進異常通報查詢分頁。
                emit('pick', { type: 'exception-item', name: item.label, objectLabel: '異常項目' });
            }

            return { data, pareto, ranked, option, pick, LEVEL_TEXT, LEVEL_ICON };
        },
        template: `
            <div class="exn-matrix ds-panel">
                <div class="ds-panel-head">
                    <h4>各項異常通報監測<span class="ds-info" tabindex="0"
                        data-tip="依通報件數由多至少排序，未啟用項目不顯示；點擊項目查看未結數與結案率"><i data-lucide="info"></i></span></h4>
                    <div class="exn-pareto">
                        <span>前 3 項占全部通報 {{ pareto.pct }}%</span>
                        <span class="ds-band">
                            <i :style="{ width: pareto.pct + '%', '--seg': 'var(--seq-hue)' }"></i>
                            <i :style="{ width: (100 - pareto.pct) + '%', '--seg': 'var(--st-void)' }"></i>
                        </span>
                    </div>
                </div>

                <div v-if="data.items.length" class="exn-matrix-body" :class="{ 'is-wide': size === 'L' }">
                    <div class="exn-grid">
                        <button v-for="item in data.items" :key="item.key"
                                class="exn-lamp" :class="'is-' + item.level" @click="pick(item)">
                            <span class="exn-lamp-top">
                                <span class="exn-lamp-icon">
                                    <i :data-lucide="item.icon"></i>
                                    <span v-if="item.level === 'critical'" class="ds-ping"></span>
                                </span>
                                <span class="ds-flag">
                                    <i :data-lucide="LEVEL_ICON[item.level]"></i>{{ LEVEL_TEXT[item.level] }}
                                </span>
                            </span>
                            <span class="exn-lamp-label">{{ item.label }}</span>
                            <span class="exn-lamp-val"><strong>{{ item.reports }}</strong><em>件通報</em></span>
                            <span class="exn-lamp-foot"><span>通報車輛</span><b>{{ item.vehicles }} 台</b></span>
                            <span class="exn-lamp-foot"><span>高發對象</span><b :title="item.top">{{ item.top }}</b></span>
                        </button>
                    </div>
                    <div v-if="size === 'L' && ranked.length" class="exn-matrix-chart">
                        <div class="exn-chart-cap">通報件數排序</div>
                        <kcd-chart :option="option" height="100%" />
                    </div>
                </div>
                <div v-else class="ds-empty"><i data-lucide="inbox"></i>當前條件下沒有已啟用的異常通報項目</div>
            </div>
        `
    };

    KCD.modules = KCD.modules || {};
    KCD.modules['exception-overview'] = {
        id: 'exception-overview',
        title: '車輛通報狀況總覽',
        desc: '監測中車輛總數、正常數與異常未排除數及其佔比，帶狀規格置頂。',
        board: 'std_exception_notice',
        sizes: ['W', 'S'],
        icon: 'shield-check',
        component: ExceptionOverview
    };
    KCD.modules['exception-objects'] = {
        id: 'exception-objects',
        title: '異常表現對象',
        desc: '異常率最佳與風險預警對象排名，總公司看分公司、分公司看車輛。',
        board: 'std_exception_notice',
        sizes: ['M', 'S'],
        icon: 'award',
        component: ExceptionObjects
    };
    KCD.modules['exception-matrix'] = {
        id: 'exception-matrix',
        title: '各項異常通報監測',
        desc: '警示燈陣列：依通報件數排序的異常項目，含程度化色彩與動態預警。',
        board: 'std_exception_notice',
        sizes: ['L', 'M'],
        icon: 'triangle-alert',
        component: ExceptionMatrix
    };
})(window.KCD);
