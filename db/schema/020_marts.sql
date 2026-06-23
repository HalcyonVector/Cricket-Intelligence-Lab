-- Read-optimized, pre-aggregated tables served by the API.
CREATE TABLE IF NOT EXISTS marts.player_batting (
  player_id TEXT, format TEXT, split TEXT,        -- 'overall'|'phase:death'|'ctx:win'...
  innings INT, balls INT, runs INT, dismissals INT,
  avg REAL, strike_rate REAL, boundary_pct REAL, dot_pct REAL,
  conversion_rate REAL, boundary_dependency REAL, consistency REAL,
  impact_per_innings REAL,
  PRIMARY KEY (player_id, format, split)
);
CREATE TABLE IF NOT EXISTS marts.player_bowling (
  player_id TEXT, format TEXT, split TEXT,
  balls INT, runs_conceded INT, wickets INT,
  economy REAL, bowling_avg REAL, bowling_sr REAL,
  dot_pct REAL, boundary_pct REAL, true_economy REAL,
  PRIMARY KEY (player_id, format, split)
);
CREATE TABLE IF NOT EXISTS marts.matchup (
  batter_id TEXT, bowler_id TEXT, format TEXT,
  balls INT, runs INT, dismissals INT,
  strike_rate REAL, average REAL, control_pct REAL,
  dominance REAL,                                 -- 0..1
  PRIMARY KEY (batter_id, bowler_id, format)
);
CREATE TABLE IF NOT EXISTS marts.venue (
  venue_id INT, format TEXT,
  avg_first_innings REAL, avg_second_innings REAL,
  bat_first_win_pct REAL, chase_win_pct REAL,
  pace_wicket_pct REAL, spin_wicket_pct REAL,
  PRIMARY KEY (venue_id, format)
);
CREATE TABLE IF NOT EXISTS marts.percentiles (
  metric TEXT, cohort TEXT, player_id TEXT,
  value REAL, percentile REAL, zscore REAL,
  PRIMARY KEY (metric, cohort, player_id)
);
CREATE TABLE IF NOT EXISTS marts.similarity (
  player_id TEXT, neighbour_id TEXT, format TEXT,
  score REAL, rank INT,
  PRIMARY KEY (player_id, neighbour_id, format)
);
CREATE TABLE IF NOT EXISTS marts.outliers (
  metric_x TEXT, metric_y TEXT, cohort TEXT, player_id TEXT,
  x REAL, y REAL, residual_z REAL, is_outlier BOOLEAN,
  PRIMARY KEY (metric_x, metric_y, cohort, player_id)
);
