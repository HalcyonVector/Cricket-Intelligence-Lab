# Cricket Intelligence Lab

Ball-by-ball cricket analytics & intelligence on open **Cricsheet** data.
StatsBomb / Bloomberg-Terminal / Moneyball — for cricket.

See `docs/Cricket_Intelligence_Lab_Design_Spec.docx` for the full design.

## Layout
```
apps/web         Next.js (App Router, TS, Tailwind, shadcn) frontend
services/api     FastAPI read-mostly API
packages/etl     Cricsheet ingestion: fetch -> parse -> load -> transform
packages/analytics  metrics, percentiles, similarity, clustering, outliers
db               raw / core / marts / meta schema (SQL)
infra            docker-compose, deploy configs
tests            unit + golden-match fixtures
```

## Quickstart (local)
```bash
docker compose -f infra/docker-compose.yml up -d        # Postgres
psql "$DATABASE_URL" -f db/schema/000_schemas.sql
psql "$DATABASE_URL" -f db/schema/010_core.sql
psql "$DATABASE_URL" -f db/schema/020_marts.sql

python -m pip install -e packages/etl -e packages/analytics
python -m cil_etl.cli ingest --format ipl --src ./data/ipl_json
python -m cil_analytics.build_marts                      # materialize marts

uvicorn app.main:app --app-dir services/api --reload     # API :8000
cd apps/web && npm install && npm run dev                # web :3000
```

Data: https://cricsheet.org/downloads/  (ODbL / CC BY-SA — attribution required).
