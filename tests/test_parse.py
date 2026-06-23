"""Golden-match style unit test for the Cricsheet parser."""
import json, tempfile, os
from cil_etl.parse import parse_match

GOLDEN = {
  "meta": {"data_version": "1.1.0"},
  "info": {"match_type": "T20", "gender": "male", "dates": ["2024-04-01"],
           "registry": {"people": {"A Striker": "abc12345", "B Bowler": "def67890",
                                     "C Partner": "11112222"}}},
  "innings": [{"team": "X", "overs": [
     {"over": 0, "deliveries": [
        {"batter": "A Striker", "bowler": "B Bowler", "non_striker": "C Partner",
         "runs": {"batter": 4, "extras": 0, "total": 4}},
        {"batter": "A Striker", "bowler": "B Bowler", "non_striker": "C Partner",
         "runs": {"batter": 0, "extras": 0, "total": 0},
         "wickets": [{"kind": "bowled", "player_out": "A Striker"}]},
     ]},
     {"over": 18, "deliveries": [
        {"batter": "C Partner", "bowler": "B Bowler", "non_striker": "A Striker",
         "runs": {"batter": 6, "extras": 0, "total": 6}},
     ]},
  ]}],
}

def test_parse_basic():
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "1234567.json")
        json.dump(GOLDEN, open(p, "w"))
        info, rows = parse_match(p)
    assert len(rows) == 3
    assert rows[0].batter_id == "abc12345"          # resolved via registry, not name
    assert rows[0].phase == "powerplay"             # over 0 in T20
    assert rows[2].phase == "death"                 # over 18 in T20
    assert rows[1].wicket_kind == "bowled"
    assert rows[1].player_out_id == "abc12345"
