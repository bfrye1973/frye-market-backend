name: dashboard-10min

on:
  workflow_dispatch: {}
  schedule:
    - cron: "*/7 12 * * 1-5"
    - cron: "*/7 13-20 * * 1-5"

jobs:
  tenmin:
    name: Build and Publish Intraday
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      contents: write
    concurrency:
      group: dashboard-10min
      cancel-in-progress: true
    env:
      TZ: America/Phoenix
      LIVE_BRANCH: data-live-10min
      PYTHONUNBUFFERED: "1"

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 1

      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - name: Install deps
        run: |
          python -m pip install --upgrade pip
          pip install requests python-dateutil

      - name: Build intraday payload
        env:
          POLYGON_API_KEY: ${{ secrets.POLYGON_API_KEY }}
        run: |
          mkdir -p data
          python -u scripts/make_dashboard.py --mode intraday --out data/outlook_intraday.json

      - name: Alias intraday metrics
        run: |
          python -u scripts/alias_intraday_metrics.py --in data/outlook_intraday.json --out data/outlook_intraday.json

      - name: Repair intraday neutrals and add display fields
        env:
          POLYGON_API_KEY: ${{ secrets.POLYGON_API_KEY }}
        run: |
          if [ -n "${POLYGON_API_KEY:-}" ]; then
            python -u scripts/repair_intraday_metrics_10m.py --in data/outlook_intraday.json --out data/outlook_intraday.json
          else
            echo "POLYGON_API_KEY missing, skipping neutral repair"
          fi

      - name: Repair meter from counts
        run: |
          python -u scripts/repair_meter_from_counts.py --in data/outlook_intraday.json --out data/outlook_intraday.json

      # ---- NEW: restore 60/40 breadth blend after all repairs ----
      - name: Finalize breadth (restore 60/40 blend)
        run: |
          python -u scripts/finalize_intraday_breadth.py --in data/outlook_intraday.json --out data/outlook_intraday.json

      # ---- NEW: log a concise snapshot for QA ----
      - name: Print meter snapshot
        run: |
          python - <<'PY'
          import json
          with open("data/outlook_intraday.json","r",encoding="utf-8") as f:
              j = json.load(f)
          m  = j.get("metrics",{}) or {}
          it = j.get("intraday",{}) or {}
          ov = (it.get("overall10m") or {})
          snap = {
              "updated_at": j.get("updated_at"),
              "breadth_final": m.get("breadth_pct"),
              "align_raw": m.get("breadth_align_pct"), "align_fast": m.get("breadth_align_pct_fast"),
              "bar_raw": m.get("breadth_bar_pct"),     "bar_fast":   m.get("breadth_bar_pct_fast"),
              "breadth_slow": m.get("breadth_slow_pct"),
              "momentum_combo": m.get("momentum_combo_pct"),
              "volatility_pct": m.get("volatility_pct"),
              "overall": {"state": ov.get("state"), "score": ov.get("score")}
          }
          print("🔎 snapshot:", snap)
          PY

      - name: Write heartbeat
        run: |
          date -u +'%Y-%m-%dT%H:%M:%SZ' > data/heartbeat_10min.txt

      - name: Stage artifacts
        run: |
          mkdir -p /tmp/live10
          cp -f data/outlook_intraday.json /tmp/live10/outlook_intraday.json
          cp -f data/heartbeat_10min.txt   /tmp/live10/heartbeat_10min.txt

      - name: Prepare live branch
        run: |
          git config user.name "actions-bot"
          git config user.email "bot@users.noreply.github.com"
          git reset --hard
          git clean -fdx
          if git ls-remote --exit-code --heads origin "${LIVE_BRANCH}" >/dev/null 2>&1; then
            git fetch origin "${LIVE_BRANCH}"
            git checkout -B "${LIVE_BRANCH}" "origin/${LIVE_BRANCH}"
          else
            git checkout --orphan "${LIVE_BRANCH}"
          fi
          find . -mindepth 1 -maxdepth 1 ! -name ".git" -exec rm -rf {} +
          mkdir -p data
          cp -f /tmp/live10/outlook_intraday.json data/outlook_intraday.json
          cp -f /tmp/live10/heartbeat_10min.txt data/heartbeat_10min.txt

      - name: Commit and push live branch
        run: |
          git add data
          git commit -m "10m live $(date -u +'%Y-%m-%dT%H:%M:%SZ')" || echo "nothing to commit"
          git push origin "${LIVE_BRANCH}" --force

      - name: Trigger Render deploy
        if: ${{ success() }}
        env:
          RENDER_DEPLOY_HOOK: ${{ secrets.RENDER_DEPLOY_HOOK_BACKEND1 }}
        run: |
          if [ -n "${RENDER_DEPLOY_HOOK:-}" ]; then
            curl -fsS -X POST "${RENDER_DEPLOY_HOOK}"
          else
            echo "No Render deploy hook secret found. Skipping deploy."
          fi
