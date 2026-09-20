/* ==========================================================================
   動效工具 — 數字滾動、變化提示、模擬即時更新
   --------------------------------------------------------------------------
   CSS 能做循環與進場，但三件事必須由 JS 承擔：

     1. 數字滾動   從舊值補間到新值。大屏上數字直接跳字看不出「變了」，
                   滾動才有量級變化的體感。
     2. 變化提示   偵測到值變了，短暫加一個 class 讓它閃一下。
     3. 模擬即時   原型沒有後端推送，用計時器小幅擾動資料，讓看板看起來
                   真的在收數。正式接入後改為訂閱後端推送即可，模組不必改。

   關於「模擬即時」的邊界（重要，交接時請注意）：
   這是原型的演示手段，不是業務邏輯。真實數值一律由後端回傳；此處只是把
   Mock 值做小幅波動，讓動效有東西可動。正式前端不得保留這個擾動。
   ========================================================================== */

(function (KCD) {
    'use strict';

    const { ref, watch, onBeforeUnmount, onMounted } = Vue;

    const reduce = () =>
        window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ----------------------------------------------------------------------
       數字滾動
       ----------------------------------------------------------------------
       用法：const shown = KCD.motion.useTween(() => props.value)
       回傳一個 ref，值會從舊數補間到新數。整數保持整數，小數保留一位 ——
       補間過程中小數位數跳動會非常刺眼。
       ---------------------------------------------------------------------- */
    function useTween(getter, opts) {
        opts = opts || {};
        const duration = opts.duration || 620;
        const decimals = opts.decimals != null ? opts.decimals : null;
        const out = ref(0);
        let raf = null;
        let guard = null;

        const round = (v, to) => {
            const d = decimals != null ? decimals : (Number.isInteger(to) ? 0 : 1);
            return Number(v.toFixed(d));
        };

        function run(from, to) {
            cancelAnimationFrame(raf);
            clearTimeout(guard);

            /* rAF 在背景頁籤與未合成的視窗裡不會觸發，補間會永遠走不完，
               數字就卡在起始值 0。因此這兩種情況直接落到終值：
                 - 減少動態效果偏好
                 - 文件處於隱藏狀態 */
            if (reduce() || document.hidden) { out.value = round(to, to); return; }

            const t0 = performance.now();
            const step = now => {
                const p = Math.min(1, (now - t0) / duration);
                // easeOutCubic：起步快、收尾穩，讀數不會在末尾拖太久
                const e = 1 - Math.pow(1 - p, 3);
                out.value = round(from + (to - from) * e, to);
                if (p < 1) raf = requestAnimationFrame(step);
            };
            raf = requestAnimationFrame(step);

            /* 安全網：若 rAF 中途被凍結（切到背景、視窗被遮蔽），
               到期後直接補上終值，畫面不會停在半途的數字。 */
            guard = setTimeout(() => {
                cancelAnimationFrame(raf);
                out.value = round(to, to);
            }, duration + 120);
        }

        // immediate: 首次也從 0 滾上來，看板載入時整屏數字一起長起來
        watch(getter, (to, from) => {
            const start = from == null ? 0 : Number(from);
            run(Number.isFinite(start) ? start : 0, Number(to) || 0);
        }, { immediate: true });

        onBeforeUnmount(() => { cancelAnimationFrame(raf); clearTimeout(guard); });
        return out;
    }

    /* ----------------------------------------------------------------------
       變化提示
       ----------------------------------------------------------------------
       用法：<span :class="{ 'm-bump': bumped }">
       值一變就把 bumped 拉起，動畫時長後自動落下。
       ---------------------------------------------------------------------- */
    function useBump(getter, ms) {
        const on = ref(false);
        let timer = null;
        watch(getter, () => {
            if (reduce()) return;
            on.value = false;
            // 強制斷幀，否則同一幀內 class 沒被移除過，動畫不會重播
            requestAnimationFrame(() => {
                on.value = true;
                clearTimeout(timer);
                timer = setTimeout(() => { on.value = false; }, ms || 800);
            });
        });
        onBeforeUnmount(() => clearTimeout(timer));
        return on;
    }

    /* ----------------------------------------------------------------------
       模擬即時更新
       ----------------------------------------------------------------------
       每 tick 回傳一個遞增的版本號；模組把它加進 computed 的依賴，
       資料就會週期性重算。擾動幅度由各模組自己決定（見 KCD.motion.jitter）。

       頁面在背景頁籤時不跳動：requestAnimationFrame 在背景不執行，
       但 setInterval 會，因此額外檢查 document.hidden，避免回到前景時
       一次補上大量變化。
       ---------------------------------------------------------------------- */
    const pulse = ref(0);
    let pulseTimer = null;

    function startPulse(ms) {
        stopPulse();
        if (reduce()) return;
        pulseTimer = setInterval(() => {
            if (document.hidden) return;
            pulse.value++;
        }, ms || 5000);
    }

    function stopPulse() {
        clearInterval(pulseTimer);
        pulseTimer = null;
    }

    document.addEventListener('visibilitychange', () => {
        // 切回前景時立刻更新一次，畫面不會停在離開前的舊值
        if (!document.hidden && pulseTimer) pulse.value++;
    });

    /** 依 pulse 對數值做小幅擾動。同一個 key 在同一輪 pulse 下結果穩定，
        因此同一個對象在不同模組裡看到的是同一個值，不會互相矛盾。 */
    function jitter(base, key, amplitude) {
        const amp = amplitude == null ? 0.04 : amplitude;
        if (!pulse.value) return base;
        // 以 key 與 pulse 產生確定性偽隨機，避免用 Math.random 造成
        // 同一輪內多次呼叫得到不同值
        let h = pulse.value * 2654435761;
        for (let i = 0; i < key.length; i++) h = (h ^ key.charCodeAt(i)) * 16777619;
        const unit = ((h >>> 0) % 2000) / 1000 - 1;   // -1 ~ 1
        const delta = base * amp * unit;
        const next = base + delta;
        return next < 0 ? 0 : Math.round(next * 10) / 10;
    }

    /* ----------------------------------------------------------------------
       輪播高亮
       ----------------------------------------------------------------------
       清單類模組用：每隔幾秒把焦點移到下一列，讓長清單自己「走一遍」。
       不做自動滾動 —— 大屏上跳動的清單會讓人抓不住剛看到的那一行；
       只移動高亮，位置不動。
       ---------------------------------------------------------------------- */
    function useSpotlight(countGetter, ms) {
        const idx = ref(-1);
        let timer = null;
        onMounted(() => {
            if (reduce()) return;
            timer = setInterval(() => {
                if (document.hidden) return;
                const n = countGetter();
                idx.value = n > 0 ? (idx.value + 1) % n : -1;
            }, ms || 2600);
        });
        onBeforeUnmount(() => clearInterval(timer));
        return idx;
    }

    KCD.motion = {
        useTween,
        useBump,
        useSpotlight,
        pulse,
        jitter,
        startPulse,
        stopPulse,
        reduce
    };
})(window.KCD);
