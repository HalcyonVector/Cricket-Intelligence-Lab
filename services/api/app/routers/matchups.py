from fastapi import APIRouter
from ..db import query
router = APIRouter(prefix="/v1/matchups", tags=["matchups"])

@router.get("")
def matchup(batter: str, bowler: str, format: str = "ipl"):
    rows = query("SELECT * FROM marts.matchup WHERE batter_id=%s AND bowler_id=%s AND format=%s",
                 (batter, bowler, format))
    m = rows[0] if rows else None
    return {"data": m, "meta": {"low_confidence": bool(m and m["balls"] < 30)}}
