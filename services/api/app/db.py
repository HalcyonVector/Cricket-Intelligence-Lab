import os
import psycopg
from psycopg.rows import dict_row

DB = os.environ.get("DATABASE_URL", "postgresql://cil:cil@localhost:5432/cil")

def query(sql: str, params: tuple = ()):
    with psycopg.connect(DB, row_factory=dict_row) as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()
