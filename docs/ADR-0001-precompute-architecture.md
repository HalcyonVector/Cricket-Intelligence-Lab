# ADR-0001: Offline pre-compute with thin read API

## Status
Superseded. The project moved to a stdlib + SQLite build (`scripts/build_all.py`)
that writes static per-cohort JS bundles; there is no Postgres, Polars or FastAPI.
The core idea below (precompute everything offline, serve static reads, swap atomically) still holds.

## Context
Cricket data is largely static once a match concludes, but the analytics
(percentiles, clustering, similarity, outliers) are expensive. Pages must feel instant.

## Decision
Run all heavy aggregation in an offline batch (Polars + scikit-learn) that materializes
`marts.*` tables. FastAPI serves these tables read-mostly; the web app reads the API.
Mart rebuilds write to `_new` tables and atomically RENAME to avoid partial reads.

## Consequences
+ Sub-300ms page data; simple, cheap serving; reproducible by data_version.
- Data is as fresh as the last batch; metric changes require re-aggregation.

## Alternatives
- On-request compute (DuckDB/Trino): simpler infra, slower pages.
- Streaming ingestion: unnecessary for v1; cricket is not real-time here.
