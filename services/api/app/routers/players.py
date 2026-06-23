from fastapi import APIRouter, HTTPException, Query
from ..db import query

router = APIRouter(prefix="/v1/players", tags=["players"])

@router.get("")
def search(q: str = Query("", min_length=0), limit: int = 20):
    rows = query(
        "SELECT player_id, name, bowling_type FROM core.dim_player "
        "WHERE name ILIKE %s ORDER BY name LIMIT %s", (f"%{q}%", limit))
    return {"data": rows, "meta": {"count": len(rows)}}

@router.get("/{player_id}")
def player(player_id: str, format: str = "ipl"):
    bat = query("SELECT * FROM marts.player_batting WHERE player_id=%s AND format=%s",
                (player_id, format))
    bowl = query("SELECT * FROM marts.player_bowling WHERE player_id=%s AND format=%s",
                 (player_id, format))
    if not bat and not bowl:
        raise HTTPException(404, "no data for player/format")
    overall = next((r for r in bat if r["split"] == "overall"), None)
    return {
        "data": {"batting": bat, "bowling": bowl},
        "meta": {"sample": {"balls": overall["balls"] if overall else None},
                 "format": format, "low_confidence": bool(overall and overall["balls"] < 200)},
    }

@router.get("/{player_id}/similar")
def similar(player_id: str, format: str = "ipl", n: int = 10):
    rows = query("SELECT neighbour_id, score, rank FROM marts.similarity "
                 "WHERE player_id=%s AND format=%s ORDER BY rank LIMIT %s",
                 (player_id, format, n))
    return {"data": rows, "meta": {"format": format}}
