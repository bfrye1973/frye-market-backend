name: dashboard-hourly

on:
  schedule:
    - cron: "0 * * * 1-5"   # every hour on weekdays (UTC)
  workflow_dispatch: {}

jobs:
  build:
    runs-on: ubuntu-latest
    env:
      TZ: America/New_York

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - name: Install deps
        run: |
          python -m pip install --upgrade pip
          if [ -f requirements.txt ]; then pip install -r requirements.txt; fi

      - name: Skip if outside market hours
        id: gate
        run: |
          hour=$(date +%H)     # ET due to TZ above
          dow=$(date +%u)      # 1=Mon .. 7=Sun
          if [ "$dow" -ge 6 ]; then echo "skip=true" >> $GITHUB_OUTPUT; exit 0; fi
          if [ "$hour" -lt 9 ] || [ "$hour" -gt 16 ]; then echo "skip=true" >> $GITHUB_OUTPUT; fi

      - name: Build outlook source (intraday)
        if: steps.gate.outputs.skip != 'true'
        env:
          POLYGON_API_KEY: ${{ secrets.POLYGON_API_KEY }}
        run: |
          python scripts/build_outlook_source_from_polygon.py --mode intraday

      - name: Make dashboard payload
        if: steps.gate.outputs.skip != 'true'
        run: |
          python scripts/make_dashboard.py --source data/outlook_source.json --out data/outlook.json

      - name: Archive last snapshot (15-day rolling)
        if: steps.gate.outputs.skip != 'true'
        run: |
          set -e
          TS=$(date -u +'%Y-%m-%dT%H-%M-%SZ')
          mkdir -p data/archive/source data/archive/dashboard
          cp data/outlook_source.json "data/archive/source/outlook_source_${TS}.json"
          cp data/outlook.json        "data/archive/dashboard/outlook_${TS}.json"
          # prune local files older than 15 days
          find data/archive/source    -type f -name 'outlook_source_*.json' -mtime +15 -delete || true
          find data/archive/dashboard -type f -name 'outlook_*.json'        -mtime +15 -delete || true

      - name: Commit latest + archive (if changed)
        if: steps.gate.outputs.skip != 'true'
        run: |
          git config user.name  "github-actions"
          git config user.email "actions@github.com"
          git add data/outlook.json data/outlook_source.json data/archive || true
          git diff --staged --quiet && echo "No changes" || git commit -m "Hourly refresh & archive: $(date -u +'%Y-%m-%dT%H:%M:%SZ')"
          git push || true

      # Optional: if you still want the container to redeploy on each run.
      - name: Trigger Render backend deploy
        if: steps.gate.outputs.skip != 'true'
        env:
          RENDER_DEPLOY_HOOK_URL: ${{ secrets.RENDER_DEPLOY_HOOK_URL }}
        run: |
          [ -n "$RENDER_DEPLOY_HOOK_URL" ] && curl -s -X POST "$RENDER_DEPLOY_HOOK_URL" >/dev/null || echo "No deploy hook set"
