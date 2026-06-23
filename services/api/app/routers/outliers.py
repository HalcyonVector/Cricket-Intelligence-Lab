from fastapi import APIRouter
from ..db import query
router = APIRouter(prefix="/v1/outliers", tags=["outliers"])

@router.get("")
def outliers(x: str, y: str, cohort: str = "ipl:overall"):
    rows = query("SELECT player_id, x, y, residual_z, is_outlier FROM marts.outliers "
                 "WHERE metric_x=%s AND metric_y=%s AND cohort=%s", (x, y, cohort))
    return {"data": rows, "meta": {"flagged": sum(r["is_outlier"] for r in rows)}}
