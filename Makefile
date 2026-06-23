.PHONY: deps build dashboard api web stack fix clean

deps:        ## install Python build deps
	pip install orjson polars numpy fastapi uvicorn

build:       ## zip -> SQLite -> marts -> dashboard data.js
	python build_all.py --zip all_json.zip

dashboard:   ## print where to open the dashboard
	@echo "Open web/dashboard/index.html in your browser."

api:         ## run the zero-DB local API on :8000
	uvicorn app.local_api:app --app-dir services/api --reload

web:         ## run the Next.js frontend on :3000
	cd apps/web && npm install && npm run dev

stack:       ## full docker stack (Postgres + API + web)
	docker compose -f infra/docker-compose.full.yml up --build

fix:         ## strip stray NUL bytes from source files
	python fix_nulls.py

clean:
	rm -f cil.db web/data/*.json web/dashboard/data.js
