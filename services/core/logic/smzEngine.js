// /services/core/logic/smzEngine.js
// Smart Money Institutional Zone Engine – Combined 30m + 1h + 4h scoring
//---------------------------------------------------------------------

export function computeSmartMoneyLevels(allBars) {
    if (!Array.isArray(allBars) || allBars.length === 0) {
        return [];
    }

    //-------------------------------------------------------------------
    // 1. NORMALIZE INPUT
    //-------------------------------------------------------------------
    const bars = allBars
        .filter(b => Number.isFinite(b.high) && Number.isFinite(b.low) && Number.isFinite(b.close))
        .sort((a, b) => a.time - b.time);

    //-------------------------------------------------------------------
    // 2. BUILD RAW PRICE TOUCH MAP
    //-------------------------------------------------------------------
    const touchMap = {};   // price → score

    function addScore(price, amount) {
        const key = Math.round(price * 100) / 100; // two decimals
        touchMap[key] = (touchMap[key] || 0) + amount;
    }

    bars.forEach((b, i) => {
        const bodyMid = (b.open + b.close) / 2;

        // Wick scoring = liquidity event
        addScore(b.high, 5);
        addScore(b.low, 5);

        // Consolidation scoring
        if (i > 3) {
            const prev = bars[i - 1];
            const range = b.high - b.low;
            const prevRange = prev.high - prev.low;

            if (range < prevRange * 0.6) {
                addScore(bodyMid, 3);
            }
        }

        // Reversal scoring
        if (i > 5) {
            const p3 = bars[i - 3];
            if (p3.close > b.open && b.close > p3.open) {
                addScore(bodyMid, 4);
            }
        }
    });

    //-------------------------------------------------------------------
    // 3. CONVERT TOUCH MAP INTO PRICE LEVEL ARRAY
    //-------------------------------------------------------------------
    const rawLevels = Object.keys(touchMap).map(p => ({
        price: Number(p),
        score: touchMap[p]
    }));

    rawLevels.sort((a, b) => b.score - a.score);

    //-------------------------------------------------------------------
    // 4. CLUSTER LEVELS INTO ZONES
    //-------------------------------------------------------------------
    const zones = [];
    const MAX_INST_WIDTH = 5.0;  // institutional max width
    const MAX_MINOR_WIDTH = 2.0; // small accum/dist max width

    rawLevels.forEach(level => {
        let placed = false;

        for (let z of zones) {
            const within =
                level.price >= z.min - 1 &&
                level.price <= z.max + 1;

            if (within) {
                // Add to cluster
                z.levels.push(level);
                z.min = Math.min(z.min, level.price);
                z.max = Math.max(z.max, level.price);
                z.score += level.score;
                placed = true;
                break;
            }
        }

        if (!placed) {
        zones.push({
                levels: [level],
                min: level.price,
                max: level.price,
                score: level.score
            });
        }
    });

    //-------------------------------------------------------------------
    // 5. CLASSIFY EACH ZONE
    //-------------------------------------------------------------------
    zones.forEach(z => {
        const width = z.max - z.min;

        if (width >= 3.5) {
            // Institutional zone
            if (width > MAX_INST_WIDTH) {
                const mid = (z.min + z.max) / 2;
                z.min = mid - MAX_INST_WIDTH / 2;
                z.max = mid + MAX_INST_WIDTH / 2;
            }
            z.type = "institutional";
        } else {
            // Minor accum / distribution
            if (width > MAX_MINOR_WIDTH) {
                const mid = (z.min + z.max) / 2;
                z.min = mid - MAX_MINOR_WIDTH / 2;
                z.max = mid + MAX_MINOR_WIDTH / 2;
            }
            z.type = "minor";
        }
    });

    //-------------------------------------------------------------------
    // 6. RANK ZONES BY SCORE + RETURN TOP 9
    //-------------------------------------------------------------------
    zones.sort((a, b) => b.score - a.score);

    const top = zones.slice(0, 9).map(z => ({
        type: z.type === "institutional" ? "institutional" : "distribution",
        price: Math.round(((z.min + z.max) / 2) * 100) / 100,
        priceRange: [Number(z.min.toFixed(2)), Number(z.max.toFixed(2))],
        strength: Math.round(z.score)
    }));

    return top;
}

//---------------------------------------------------------------------
// END OF FILE
//---------------------------------------------------------------------
