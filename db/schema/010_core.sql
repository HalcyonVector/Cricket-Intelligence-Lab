-- ---------- raw landing ----------
CREATE TABLE IF NOT EXISTS raw.matches (
  match_id TEXT PRIMARY KEY,
  file_rev INT,
  info     JSONB NOT NULL,
  meta     JSONB
);
CREATE TABLE IF NOT EXISTS raw.deliveries (
  match_id     TEXT NOT NULL,
  innings_no   SMALLINT NOT NULL,
  over_no      SMALLINT NOT NULL,
  ball_seq     SMALLINT NOT NULL,
  payload      JSONB NOT NULL
);

-- ---------- dimensions ----------
CREATE TABLE IF NOT EXISTS core.dim_player (
  player_id     TEXT PRIMARY KEY,           -- cricsheet 8-hex registry id
  name          TEXT NOT NULL,
  batting_hand  TEXT,                        -- RHB | LHB | NULL
  bowling_style TEXT,
  bowling_type  TEXT                         -- LF|RF|LM|RM|off|leg|SLA|mystery
);
CREATE TABLE IF NOT EXISTS core.dim_team (
  team_id   SERIAL PRIMARY KEY,
  name      TEXT UNIQUE NOT NULL,
  gender    TEXT,
  is_international BOOLEAN DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS core.dim_venue (
  venue_id  SERIAL PRIMARY KEY,
  name      TEXT UNIQUE NOT NULL,
  city      TEXT,
  country   TEXT
);
CREATE TABLE IF NOT EXISTS core.dim_match (
  match_id      TEXT PRIMARY KEY,
  format        TEXT NOT NULL,               -- test|odi|t20i|ipl|...
  gender        TEXT,
  league        TEXT,
  match_date    DATE,
  venue_id      INT REFERENCES core.dim_venue(venue_id),
  team_a        INT REFERENCES core.dim_team(team_id),
  team_b        INT REFERENCES core.dim_team(team_id),
  toss_winner   INT,
  toss_decision TEXT,
  winner        INT,
  result_type   TEXT,                        -- win|tie|draw|no result
  is_dl         BOOLEAN DEFAULT FALSE
);

-- ---------- facts ----------
CREATE TABLE IF NOT EXISTS core.fact_delivery (
  delivery_id     BIGSERIAL PRIMARY KEY,
  match_id        TEXT NOT NULL REFERENCES core.dim_match(match_id),
  innings_no      SMALLINT NOT NULL,
  over_no         SMALLINT NOT NULL,
  ball_in_over    SMALLINT NOT NULL,
  batter_id       TEXT NOT NULL REFERENCES core.dim_player(player_id),
  non_striker_id  TEXT REFERENCES core.dim_player(player_id),
  bowler_id       TEXT NOT NULL REFERENCES core.dim_player(player_id),
  runs_batter     SMALLINT NOT NULL DEFAULT 0,
  runs_extras     SMALLINT NOT NULL DEFAULT 0,
  extra_type      TEXT,
  wicket_kind     TEXT,
  player_out_id   TEXT,
  phase           TEXT NOT NULL,             -- powerplay|middle|death
  is_powerplay    BOOLEAN DEFAULT FALSE,
  batting_team_id INT,
  bowling_team_id INT,
  balls_remaining SMALLINT,
  runs_required   SMALLINT,
  req_rate        REAL
);
CREATE INDEX IF NOT EXISTS ix_fd_batter ON core.fact_delivery(batter_id);
CREATE INDEX IF NOT EXISTS ix_fd_bowler ON core.fact_delivery(bowler_id);
CREATE INDEX IF NOT EXISTS ix_fd_pair   ON core.fact_delivery(batter_id, bowler_id);

CREATE TABLE IF NOT EXISTS core.fact_innings (
  match_id    TEXT NOT NULL,
  innings_no  SMALLINT NOT NULL,
  batting_team_id INT,
  runs        SMALLINT,
  wickets     SMALLINT,
  balls       SMALLINT,
  target      SMALLINT,
  PRIMARY KEY (match_id, innings_no)
);
CREATE TABLE IF NOT EXISTS core.fact_partnership (
  match_id    TEXT NOT NULL,
  innings_no  SMALLINT NOT NULL,
  wicket_no   SMALLINT NOT NULL,
  batter1_id  TEXT, batter2_id TEXT,
  runs SMALLINT, balls SMALLINT,
  PRIMARY KEY (match_id, innings_no, wicket_no)
);
