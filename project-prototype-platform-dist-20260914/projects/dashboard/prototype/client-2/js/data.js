/* ==========================================================================
   資料層（Mock）
   --------------------------------------------------------------------------
   PRD 9.3 明列使用率、評分、異常率、排名、狀態等級全部由後端回傳，前端不做
   業務計算。因此本檔的欄位名即建議的接口欄位名，值為 Mock。

   getBranchScope() 決定「總公司視角」還是「分公司視角」：
   同一業務看板的兩個權限視圖，不為每間分公司建立獨立看板（已確認原則）。
   ========================================================================== */

(function (KCD) {
    'use strict';

    /* 公共篩選的四層。V7 第 3 頁：
         第一層 分公司或記憶群組（類別）
         第二層 具體分公司／群組
         第三層 車型
         第四層 車號
       第一層決定第二層的內容；記憶群組是否納入一期仍待確認，因此選項先備齊。 */
    const FILTER_FIELDS = {
        scopeType: {
            label: '分公司或記憶群組',
            options: [
                { value: 'all', label: '全部' },
                { value: 'branch', label: '分公司' },
                { value: 'group', label: '記憶群組' }
            ]
        },
        branch: {
            label: '分公司 / 群組',
            options: [
                { value: 'all', label: '全部' },
                { value: 'taipei', label: '臺北分公司' },
                { value: 'hsinchu', label: '新竹分公司' }
            ]
        },
        vehicleType: {
            label: '車型',
            options: [
                { value: 'all', label: '全部' },
                { value: 'truck', label: '貨車' },
                { value: 'van', label: '廂型車' },
                { value: 'car', label: '小客車' }
            ]
        },
        vehicle: {
            label: '車號',
            options: [
                { value: 'all', label: '全部' },
                { value: 'kla-1234', label: 'KLA-1234' },
                { value: 'klb-5678', label: 'KLB-5678' },
                { value: 'klc-9012', label: 'KLC-9012' }
            ]
        },
        // short 給展示模式的分段控制用：日／週／月比本日／本週／本月更省寬度
        time: {
            label: '期間',
            options: [
                { value: 'day', label: '本日', short: '日' },
                { value: 'week', label: '本週', short: '週' },
                { value: 'month', label: '本月', short: '月' }
            ]
        }
    };

    // 展示模式篩選條裡四個下拉的順序（time 由分段控制單獨呈現）
    const FILTER_ORDER = ['scopeType', 'branch', 'vehicleType', 'vehicle'];

    const DEFAULT_FILTERS = { scopeType: 'all', branch: 'all', vehicleType: 'all', vehicle: 'all', time: 'day' };

    const BRANCH_LABEL = { taipei: '臺北站', hsinchu: '新竹站' };

    function getBranchScope(filters) {
        return BRANCH_LABEL[filters.branch] || '';
    }

    /** 筛選對資料量的縮放。純為 Mock 服務，真實資料由後端按條件回傳。 */
    function scopeMultiplier(filters) {
        const byType = { all: 1, truck: 1, van: 0.76, car: 0.58 }[filters.vehicleType] || 1;
        const byVehicle = filters.vehicle !== 'all' ? 0.18 : 1;
        const byTime = { day: 1, week: 1.08, month: 1.16 }[filters.time] || 1;
        return byType * byVehicle * byTime;
    }

    /** 零值必須留零：接口要求區分零值、無資料與未開通，不能把 0 進位成 1。 */
    function scale(value, multiplier) {
        if (!value) return 0;
        return Math.max(1, Math.round(value * multiplier));
    }

    const pct = (value, base) => (base > 0 ? Math.round((value / base) * 1000) / 10 : 0);

    /* ----------------------------------------------------------------------
       站所與車輛的共用種子資料
       ----------------------------------------------------------------------
       放在這裡而不是各模組內：運行狀態環圖、站所分布條、地理分布圖三個模組
       讀的是同一批站所，若各自存一份，改動時必然分岔，同一張看板會出現互相
       矛盾的數字。

       行進率刻意跨滿五個色檔（90+ / 70-90 / 50-70 / 30-50 / 30-）——
       客戶參考圖的圖例有五檔，資料若全擠在一檔，圖例就失去意義。
       ---------------------------------------------------------------------- */
    const STATIONS = [
        { name: '臺北站', geo: [121.56, 25.03], run: 34, idle: 5, off: 6 },   // 75.6%
        { name: '桃園站', geo: [121.30, 24.99], run: 28, idle: 3, off: 2 },   // 84.8%
        { name: '新竹站', geo: [120.97, 24.80], run: 23, idle: 2, off: 1 },   // 88.5%
        { name: '臺中站', geo: [120.68, 24.14], run: 29, idle: 2, off: 1 },   // 90.6%
        { name: '嘉義站', geo: [120.45, 23.48], run: 8, idle: 4, off: 6 },    // 44.4%
        { name: '臺南站', geo: [120.20, 22.99], run: 12, idle: 5, off: 7 },   // 50.0%
        { name: '高雄站', geo: [120.36, 22.65], run: 5, idle: 4, off: 13 },   // 22.7%
        { name: '花蓮站', geo: [121.56, 23.99], run: 4, idle: 2, off: 6 }     // 33.3%
    ];

    // 分公司視角的車輛。三態為當日累計分鐘數（一日 1440 分）。
    const VEHICLES = [
        { name: 'KLA-1234', run: 486, idle: 92, off: 862 },
        { name: 'KLB-5678', run: 402, idle: 168, off: 870 },
        { name: 'KLC-9012', run: 351, idle: 74, off: 1015 },
        { name: 'KLD-3456', run: 298, idle: 210, off: 932 },
        { name: 'KLE-7890', run: 264, idle: 58, off: 1118 },
        { name: 'KLF-2468', run: 197, idle: 143, off: 1100 },
        { name: 'KLG-1357', run: 132, idle: 46, off: 1262 }
    ];

    /* ----------------------------------------------------------------------
       使用率（M02）
       ----------------------------------------------------------------------
       V7 第 6 頁：使用率 = 有效出車數 ÷ 總車輛數，因此不會超過 100%。
       目標值預設 70%，由看板級條件調整（需求文檔 5.2）。

       欄位對應參考圖「分公司使用率明細」：使用率、較上月變化、較目標差異、
       目標使用率、有效工時、行駛工時、怠速工時、熄火工時、近 7 日趨勢。
       全部由後端回傳，前端不計算「有效出車」的業務口徑。
       ---------------------------------------------------------------------- */
    const UTIL_TARGET = 70;

    const UTILIZATION = [
        { name: '高雄站', rate: 92, delta: 6.2, effective: 5420, drive: 4986, idle: 321, off: 113, spark: [86, 88, 87, 90, 89, 91, 92] },
        { name: '桃園站', rate: 92, delta: 5.1, effective: 4980, drive: 4582, idle: 286, off: 112, spark: [85, 87, 89, 88, 90, 91, 92] },
        { name: '臺北站', rate: 86, delta: 4.3, effective: 5310, drive: 4579, idle: 512, off: 219, spark: [80, 82, 81, 84, 85, 85, 86] },
        { name: '臺南站', rate: 86, delta: 3.7, effective: 4620, drive: 3987, idle: 411, off: 222, spark: [81, 82, 84, 83, 85, 86, 86] },
        { name: '臺中站', rate: 81, delta: 2.9, effective: 4860, drive: 3955, idle: 528, off: 377, spark: [76, 78, 77, 79, 80, 80, 81] },
        { name: '新竹站', rate: 74, delta: 1.4, effective: 4120, drive: 3210, idle: 496, off: 414, spark: [71, 72, 71, 73, 73, 74, 74] },
        { name: '嘉義站', rate: 64, delta: -3.1, effective: 3180, drive: 2290, idle: 512, off: 378, spark: [69, 68, 67, 66, 65, 64, 64] },
        { name: '花蓮站', rate: 46, delta: -4.3, effective: 2140, drive: 1420, idle: 398, off: 322, spark: [52, 51, 50, 48, 47, 46, 46] },
        { name: '屏東站', rate: 31, delta: -8.5, effective: 1460, drive: 890, idle: 312, off: 258, spark: [40, 38, 36, 35, 33, 32, 31] }
    ];

    /* 使用率區間分布的五檔。與地圖圖例同一組界線，讀者不必換算。 */
    const UTIL_BANDS = [
        { min: 90, label: '90% 以上', token: 'st-normal' },
        { min: 70, label: '70% ~ 90%', token: 'st-info' },
        { min: 50, label: '50% ~ 70%', token: 'st-notice' },
        { min: 30, label: '30% ~ 50%', token: 'st-warn' },
        { min: 0, label: '30% 以下', token: 'st-critical' }
    ];

    /** 依數值取所屬色檔。共用於使用率、行進率等百分比類指標。 */
    function bandOf(bands, value) {
        return bands.find(b => value >= b.min) || bands[bands.length - 1];
    }

    // 站所座標查詢：使用率、溫度等模組的地圖都用同一份座標
    const GEO_BY_NAME = STATIONS.reduce((acc, s) => { acc[s.name] = s.geo; return acc; }, {});
    // 參考圖出現但不在運行狀態站所清單裡的站，補上座標
    GEO_BY_NAME['屏東站'] = [120.49, 22.67];

    /* ----------------------------------------------------------------------
       駕駛行為評分（M03）
       ----------------------------------------------------------------------
       V7 第 7、8 頁：本週分數、上週分數、排名與名次升降都由後端回傳，
       前端不重新推斷排名。rankPrev 是上週名次，用來算升降幾名。

       總公司看分公司（站所），分公司看駕駛員 —— 同一模組的兩個權限視角。
       ---------------------------------------------------------------------- */
    const SCORE_STATIONS = [
        { name: '新竹站', score: 94, prev: 92, rank: 1, rankPrev: 2, harsh: 4, speed: 2, fatigue: 0 },
        { name: '桃園站', score: 91, prev: 90, rank: 2, rankPrev: 1, harsh: 6, speed: 3, fatigue: 1 },
        { name: '臺北站', score: 88, prev: 84, rank: 3, rankPrev: 5, harsh: 9, speed: 5, fatigue: 1 },
        { name: '臺中站', score: 84, prev: 85, rank: 4, rankPrev: 3, harsh: 12, speed: 7, fatigue: 2 },
        { name: '臺南站', score: 79, prev: 78, rank: 5, rankPrev: 6, harsh: 16, speed: 9, fatigue: 3 },
        { name: '嘉義站', score: 74, prev: 77, rank: 6, rankPrev: 4, harsh: 21, speed: 12, fatigue: 4 },
        { name: '高雄站', score: 68, prev: 72, rank: 7, rankPrev: 7, harsh: 27, speed: 16, fatigue: 6 },
        { name: '花蓮站', score: 61, prev: 66, rank: 8, rankPrev: 8, harsh: 34, speed: 21, fatigue: 8 }
    ];

    const SCORE_DRIVERS = [
        { name: '陳大明', score: 95, prev: 93, rank: 1, rankPrev: 2, harsh: 2, speed: 1, fatigue: 0 },
        { name: '王志文', score: 92, prev: 84, rank: 2, rankPrev: 6, harsh: 4, speed: 1, fatigue: 0 },
        { name: '李信宏', score: 88, prev: 87, rank: 3, rankPrev: 3, harsh: 5, speed: 2, fatigue: 0 },
        { name: '黃建國', score: 83, prev: 85, rank: 4, rankPrev: 1, harsh: 7, speed: 3, fatigue: 1 },
        { name: '林重豪', score: 77, prev: 77, rank: 5, rankPrev: 5, harsh: 11, speed: 4, fatigue: 1 },
        { name: '張世忠', score: 72, prev: 76, rank: 6, rankPrev: 4, harsh: 14, speed: 6, fatigue: 2 },
        { name: '趙子謙', score: 65, prev: 70, rank: 7, rankPrev: 7, harsh: 19, speed: 9, fatigue: 3 }
    ];

    /* 評分等級。V7 要求明確評分區間與風險等級，因此界線集中在此。 */
    const SCORE_BANDS = [
        { min: 90, label: '優良', token: 'st-normal' },
        { min: 80, label: '良好', token: 'st-info' },
        { min: 70, label: '注意', token: 'st-notice' },
        { min: 60, label: '警示', token: 'st-warn' },
        { min: 0, label: '高風險', token: 'st-critical' }
    ];

    /* 風險行為類別。cat-* 是類別色，固定槽位，不按數值大小上色。 */
    const SCORE_FACTORS = [
        { key: 'harsh', label: '急加減速', cat: 1 },
        { key: 'speed', label: '超速', cat: 2 },
        { key: 'fatigue', label: '疲勞駕駛', cat: 3 }
    ];

    // 近 7 日車隊平均分
    const SCORE_TREND = [
        { date: '08-17', score: 78.4 },
        { date: '08-18', score: 79.1 },
        { date: '08-19', score: 78.8 },
        { date: '08-20', score: 80.2 },
        { date: '08-21', score: 81.0 },
        { date: '08-22', score: 80.4 },
        { date: '08-23', score: 81.6 }
    ];

    /* ----------------------------------------------------------------------
       酒測管理（M05）
       ----------------------------------------------------------------------
       V7 第 11、12 頁：
         通過率 =（酒測通過人數 ÷ 應酒測人數）× 100%
         總公司  各站所通過／不通過／未吹的構成與通過率排名
         分公司  酒測異常駕駛與未酒測駕駛排行，含酒測值與連續天數

       V7 註明本看板「點擊開啟既有功能分頁」。
       ---------------------------------------------------------------------- */
    const ALCOHOL_STATIONS = [
        { name: '新竹站', due: 42, pass: 42, fail: 0, miss: 0 },
        { name: '桃園站', due: 38, pass: 37, fail: 1, miss: 0 },
        { name: '臺北站', due: 56, pass: 53, fail: 2, miss: 1 },
        { name: '臺中站', due: 47, pass: 43, fail: 2, miss: 2 },
        { name: '臺南站', due: 35, pass: 31, fail: 2, miss: 2 },
        { name: '嘉義站', due: 24, pass: 20, fail: 2, miss: 2 },
        { name: '高雄站', due: 31, pass: 25, fail: 4, miss: 2 },
        { name: '花蓮站', due: 18, pass: 13, fail: 3, miss: 2 }
    ];

    /* 酒測異常駕駛。value 是酒測值（mg/L），法定標準 0.15；
       連續異常天數由後端累計。 */
    const ALCOHOL_FAIL_DRIVERS = [
        { name: '趙子謙', station: '高雄站', plate: 'KLG-1357', value: 0.42, days: 3 },
        { name: '張世忠', station: '花蓮站', plate: 'KLB-5678', value: 0.31, days: 2 },
        { name: '林重豪', station: '嘉義站', plate: 'KLE-7890', value: 0.26, days: 2 },
        { name: '黃建國', station: '臺南站', plate: 'KLD-3456', value: 0.19, days: 1 },
        { name: '李信宏', station: '臺北站', plate: 'KLC-9012', value: 0.17, days: 1 }
    ];

    /* 未吹酒測即出車。連續漏測天數由後端累計。 */
    const ALCOHOL_MISS_DRIVERS = [
        { name: '吳明德', station: '高雄站', plate: 'KLF-2468', days: 4 },
        { name: '許文彬', station: '花蓮站', plate: 'KLA-1234', days: 3 },
        { name: '蔡宗翰', station: '臺中站', plate: 'KLC-9012', days: 2 },
        { name: '鄭伯倫', station: '嘉義站', plate: 'KLD-3456', days: 2 },
        { name: '周建豪', station: '臺南站', plate: 'KLE-7890', days: 1 }
    ];

    // 酒測值法定標準（mg/L）。由後端配置回傳，前端只做門檻標記。
    const ALCOHOL_LIMIT = 0.15;

    /* 酒測三態。與運行三態一樣是「域內狀態」而非嚴重度階梯，
       但方向一致（通過＝好、未吹＝最該追），因此沿用狀態標尺。 */
    const ALCOHOL_STATES = [
        { key: 'pass', label: '通過', token: 'st-normal', icon: 'circle-check' },
        { key: 'fail', label: '不通過', token: 'st-critical', icon: 'circle-x' },
        { key: 'miss', label: '未吹即出車', token: 'st-warn', icon: 'circle-help' }
    ];

    // 近 7 日通過率
    const ALCOHOL_TREND = [
        { date: '08-17', rate: 93.1 },
        { date: '08-18', rate: 94.0 },
        { date: '08-19', rate: 93.6 },
        { date: '08-20', rate: 95.2 },
        { date: '08-21', rate: 94.4 },
        { date: '08-22', rate: 95.8 },
        { date: '08-23', rate: 94.9 }
    ];

    /* ----------------------------------------------------------------------
       溫度管理（M06 / M07 / M08）
       ----------------------------------------------------------------------
       V7 第 13、14 頁。三個場域各自獨立：

         車輛    以車輛為單位，一台車裝多個溫度計，任一異常則該車列為異常
         庫房    以庫房為單位，同上規則。沒有安裝庫房設備就不呈現
         移動資源 籠車、冰箱等。沒有啟用就不呈現

       溫控負擔 = 總異常分鐘數 ÷ 總車輛數（V7 明確公式，數值越低越好）。

       installed 對應「未安裝就不呈現此看板」——這是後端回傳的開通狀態，
       前端只依此決定模組顯示或給出說明，不自行判斷。
       ---------------------------------------------------------------------- */

    // 各場域的開通狀態。實際值由後端回傳；此處三個都開通以便演示完整看板。
    const TEMP_FIELDS = {
        vehicle: { key: 'vehicle', label: '車輛', unit: '台', installed: true, icon: 'truck' },
        warehouse: { key: 'warehouse', label: '庫房', unit: '間', installed: true, icon: 'warehouse' },
        mobile: { key: 'mobile', label: '移動資源', unit: '台', installed: true, icon: 'container' }
    };

    /* 各場域的狀態彙總。normal / abnormal 是「對象數」而非溫度計數 ——
       V7 定義任一溫度計異常則整個對象列為異常。 */
    const TEMP_STATUS = {
        vehicle: { normal: 196, abnormal: 12 },
        warehouse: { normal: 14, abnormal: 2 },
        mobile: { normal: 38, abnormal: 4 }
    };

    /* 異常累計 Top 5。V7 要求欄位：
       對象、安裝設備、各溫度計異常累計時間佔比（堆疊）、
       異常累計時間／壓縮機累計時間、當日壓縮機起訖時間。
       sensors 是各溫度計的異常分鐘數，鍵即溫度計名稱。 */
    const TEMP_TOP = {
        vehicle: [
            { name: 'KLD-3456', station: '高雄站', devices: 3, fleet: 25, sensors: { 前門: 148, 後門: 96, 側門: 42 }, comp: 512, from: '05:12', to: '19:48' },
            { name: 'KLG-1357', station: '花蓮站', devices: 2, fleet: 18, sensors: { 前門: 132, 後門: 74 }, comp: 468, from: '05:40', to: '18:26' },
            { name: 'KLB-5678', station: '嘉義站', devices: 3, fleet: 22, sensors: { 前門: 88, 後門: 64, 側門: 31 }, comp: 496, from: '04:58', to: '20:04' },
            { name: 'KLE-7890', station: '臺南站', devices: 2, fleet: 20, sensors: { 前門: 76, 後門: 38 }, comp: 442, from: '06:10', to: '18:52' },
            { name: 'KLC-9012', station: '臺中站', devices: 3, fleet: 31, sensors: { 前門: 54, 後門: 26, 側門: 18 }, comp: 480, from: '05:26', to: '19:12' }
        ],
        warehouse: [
            { name: '高雄冷藏庫 A', station: '高雄站', devices: 4, fleet: 4, sensors: { 冷藏區: 186, 冷凍區: 124, 理貨區: 58 }, comp: 1380, from: '00:00', to: '23:59' },
            { name: '花蓮冷藏庫', station: '花蓮站', devices: 3, fleet: 3, sensors: { 冷藏區: 142, 冷凍區: 88 }, comp: 1320, from: '00:00', to: '23:59' },
            { name: '臺南理貨庫', station: '臺南站', devices: 3, fleet: 3, sensors: { 冷藏區: 96, 理貨區: 62 }, comp: 1260, from: '00:00', to: '23:59' },
            { name: '嘉義冷凍庫', station: '嘉義站', devices: 2, fleet: 2, sensors: { 冷凍區: 74 }, comp: 1400, from: '00:00', to: '23:59' },
            { name: '臺中冷藏庫 B', station: '臺中站', devices: 4, fleet: 4, sensors: { 冷藏區: 48, 冷凍區: 32, 理貨區: 14 }, comp: 1340, from: '00:00', to: '23:59' }
        ],
        mobile: [
            { name: '籠車 CG-204', station: '高雄站', devices: 1, fleet: 12, sensors: { 車體: 124 }, comp: 386, from: '06:30', to: '17:40' },
            { name: '冰箱 RF-118', station: '臺北站', devices: 1, fleet: 8, sensors: { 內艙: 98 }, comp: 720, from: '00:00', to: '23:59' },
            { name: '籠車 CG-176', station: '花蓮站', devices: 1, fleet: 10, sensors: { 車體: 82 }, comp: 342, from: '07:10', to: '16:58' },
            { name: '冰箱 RF-092', station: '臺中站', devices: 1, fleet: 6, sensors: { 內艙: 56 }, comp: 690, from: '00:00', to: '23:59' },
            { name: '籠車 CG-231', station: '嘉義站', devices: 1, fleet: 6, sensors: { 車體: 38 }, comp: 318, from: '06:52', to: '17:24' }
        ]
    };

    /* 溫控負擔排名（分鐘／對象）。V7：數值越低越好。 */
    const TEMP_BURDEN = [
        { name: '新竹站', minutes: 2.4 },
        { name: '桃園站', minutes: 3.1 },
        { name: '臺北站', minutes: 4.8 },
        { name: '臺中站', minutes: 6.2 },
        { name: '臺南站', minutes: 9.4 },
        { name: '嘉義站', minutes: 12.8 },
        { name: '花蓮站', minutes: 18.6 },
        { name: '高雄站', minutes: 24.2 }
    ];

    /* 無線溫度設備健康。V7：車輛／庫房門市／移動設備偵測到的
       低電壓與停訊次數。沿用第二套 DM04 看板的欄位。 */
    const TEMP_DEVICES = [
        { field: '車輛', total: 208, lowBattery: 6, offline: 3, lastSeen: '17:42' },
        { field: '庫房 / 門市', total: 16, lowBattery: 2, offline: 1, lastSeen: '17:44' },
        { field: '移動設備', total: 42, lowBattery: 4, offline: 2, lastSeen: '17:38' }
    ];

    // 近 24 小時的合規率（每 3 小時一點）
    const TEMP_TREND = [
        { at: '00:00', rate: 96.2 },
        { at: '03:00', rate: 96.8 },
        { at: '06:00', rate: 95.1 },
        { at: '09:00', rate: 93.4 },
        { at: '12:00', rate: 92.1 },
        { at: '15:00', rate: 93.8 },
        { at: '18:00', rate: 94.6 },
        { at: '21:00', rate: 95.4 }
    ];


    KCD.data = {
        FILTER_FIELDS,
        FILTER_ORDER,
        DEFAULT_FILTERS,
        STATIONS,
        VEHICLES,
        UTILIZATION,
        UTIL_BANDS,
        UTIL_TARGET,
        SCORE_STATIONS,
        SCORE_DRIVERS,
        SCORE_BANDS,
        SCORE_FACTORS,
        SCORE_TREND,
        ALCOHOL_STATIONS,
        ALCOHOL_FAIL_DRIVERS,
        ALCOHOL_MISS_DRIVERS,
        ALCOHOL_STATES,
        ALCOHOL_TREND,
        ALCOHOL_LIMIT,
        TEMP_FIELDS,
        TEMP_STATUS,
        TEMP_TOP,
        TEMP_BURDEN,
        TEMP_DEVICES,
        TEMP_TREND,
        GEO_BY_NAME,
        bandOf,
        getBranchScope,
        scopeMultiplier,
        scale,
        pct,
        /** 期間對應的日期範圍字串。真實值應由後端隨統計資料一併回傳，
            此處按今日回推，只為讓展示模式的篩選條有內容可讀。 */
        periodRange(period) {
            const end = new Date();
            const start = new Date(end);
            if (period === 'week') start.setDate(end.getDate() - 6);
            else if (period === 'month') start.setDate(end.getDate() - 29);
            const f = d => d.getFullYear() + '-'
                + String(d.getMonth() + 1).padStart(2, '0') + '-'
                + String(d.getDate()).padStart(2, '0');
            return period === 'day' ? f(end) : f(start) + ' ~ ' + f(end);
        },
        filterLabel(field, value) {
            const meta = FILTER_FIELDS[field];
            const hit = meta && meta.options.find(o => o.value === value);
            return hit ? hit.label : '';
        }
    };
})(window.KCD);
