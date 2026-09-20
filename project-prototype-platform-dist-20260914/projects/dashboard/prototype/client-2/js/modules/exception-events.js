/* ==========================================================================
   異常通報 — M04-4 近期異常事件
   --------------------------------------------------------------------------
   依據客戶參考圖 2 的「近期異常事件」：時間、對象、事件描述、嚴重度標籤。

   為什麼需要這一塊：M04-3 的警示燈陣列回答「哪些項目在告警」，是彙總視角；
   值班的人還需要「剛剛發生了什麼」的時序視角。兩者資料任務不同，因此是
   兩個模組而不是同一塊的兩種排序。

   事件流刻意不做自動滾動：大屏上跳動的列表會讓人抓不住剛看到的那一行。
   ========================================================================== */

(function (KCD) {
    'use strict';

    const { computed } = Vue;
    const D = KCD.data;

    // 事件序列由後端按時間倒序回傳，前端不重新排序。
    // level 對應狀態標尺，與警示燈陣列同一套語義。
    const EVENT_SEED = [
        { at: '17:42', object: '臺北站', plate: 'KCD-318', text: '車輛溫度異常（5°C，超出上限）', level: 'critical', icon: 'thermometer' },
        { at: '17:31', object: '新竹站', plate: 'HSZ-118', text: '超速過線 92 km/h', level: 'critical', icon: 'gauge' },
        { at: '17:20', object: '臺南站', plate: 'KCD-205', text: '車輛進入禁行區域', level: 'warn', icon: 'map-pin-off' },
        { at: '16:58', object: '苗栗維修站', plate: 'KCD-522', text: '怠速過久 38 分鐘', level: 'warn', icon: 'clock-3' },
        { at: '16:44', object: '高雄站', plate: 'KLE-7890', text: '電壓異常 11.2V', level: 'low', icon: 'battery-warning' },
        { at: '16:12', object: '臺北站', plate: 'KLA-1234', text: '車輛停訊，最後通信 22 分鐘前', level: 'offline', icon: 'plug-zap' },
        { at: '15:50', object: '宜蘭配送點', plate: 'KCD-101', text: '求救[SOS] 已由值班人員接手', level: 'critical', icon: 'bell-ring' },
        { at: '15:26', object: '臺中站', plate: 'KLC-9012', text: '發動過線（非排班時段）', level: 'low', icon: 'power' }
    ];

    const LEVEL_TEXT = { low: '一般', warn: '重要', critical: '緊急', offline: '停訊' };

    function buildEvents(filters) {
        const scope = D.getBranchScope(filters);
        const isBranch = Boolean(scope);
        let rows = EVENT_SEED;
        // 分公司視角只看自己的事件
        if (isBranch) rows = rows.filter(e => e.object === scope);
        if (isBranch && filters.vehicle !== 'all') {
            const picked = rows.filter(e => e.plate.toLowerCase() === filters.vehicle);
            if (picked.length) rows = picked;
        }
        // 依嚴重度統計，供標頭的分級計數使用
        const byLevel = ['critical', 'warn', 'low', 'offline'].map(level => ({
            level,
            label: LEVEL_TEXT[level],
            count: rows.filter(e => e.level === level).length
        })).filter(x => x.count > 0);

        return {
            isBranch,
            scopeLabel: isBranch ? scope : '全公司',
            rows,
            byLevel,
            total: rows.length
        };
    }

    const ExceptionEvents = {
        name: 'ExceptionEvents',
        props: { filters: { type: Object, required: true }, size: { type: String, default: 'M' } },
        emits: ['pick'],
        setup(props, { emit }) {
            const data = computed(() => buildEvents(props.filters));
            const visible = computed(() =>
                (props.size === 'S' ? data.value.rows.slice(0, 4) : data.value.rows));
            function pick(e) {
                emit('pick', { type: 'exception-event', name: e.plate + '　' + e.text, objectLabel: '異常事件' });
            }
            return { data, visible, pick, LEVEL_TEXT };
        },
        template: `
            <div class="exn-events ds-panel">
                <div class="ds-panel-head">
                    <h4>近期異常事件</h4>
                    <b>{{ data.scopeLabel }} · 更多 ›</b>
                </div>
                <div v-if="data.total" class="exn-events-tally">
                    <span v-for="l in data.byLevel" :key="l.level" class="ds-flag" :class="'is-' + l.level">
                        {{ l.label }} {{ l.count }}
                    </span>
                    <span class="exn-events-total">共 {{ data.total }} 筆</span>
                </div>
                <div v-if="visible.length" class="exn-events-list">
                    <button v-for="(e, i) in visible" :key="e.at + e.plate"
                            class="exn-event" :class="'is-' + e.level" @click="pick(e)">
                        <span class="exn-event-time">{{ e.at }}</span>
                        <span class="exn-event-rail"><i></i></span>
                        <span class="exn-event-body">
                            <span class="exn-event-head">
                                <span class="exn-event-icon"><i :data-lucide="e.icon"></i></span>
                                <strong>{{ e.plate }}</strong>
                                <span class="exn-event-obj">{{ e.object }}</span>
                            </span>
                            <span class="exn-event-text">{{ e.text }}</span>
                        </span>
                        <span class="ds-flag">{{ LEVEL_TEXT[e.level] }}</span>
                    </button>
                </div>
                <div v-else class="ds-empty"><i data-lucide="inbox"></i>當前條件下沒有異常事件</div>
            </div>
        `
    };

    KCD.modules = KCD.modules || {};
    KCD.modules['exception-events'] = {
        id: 'exception-events',
        title: '近期異常事件',
        desc: '依時間倒序的異常事件流，含車號、站所、事件描述與嚴重度。',
        board: 'std_exception_notice',
        sizes: ['M', 'S'],
        icon: 'list',
        component: ExceptionEvents
    };
})(window.KCD);
