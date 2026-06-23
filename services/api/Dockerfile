FROM python:3.11-slim
WORKDIR /app
RUN pip install --no-cache-dir fastapi "uvicorn[standard]" psycopg[binary] orjson
COPY services/api /app/services/api
COPY web/data /app/web/data
EXPOSE 8000
# Zero-DB mode: serve the computed JSON bundles. Swap to app.main:app for the
# Postgres-backed production API once marts are loaded into Postgres.
CMD ["uvicorn", "app.local_api:app", "--app-dir", "services/api", "--host", "0.0.0.0", "--port", "8000"]
