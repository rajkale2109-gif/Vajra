export const CREATE_VIEWS_SQL = `
-- 1. Median time to investigate an issue (time from issue_detected to issue_opened)
CREATE OR REPLACE VIEW view_time_to_investigate AS
WITH detected AS (
  SELECT 
    issue_id, 
    account_id, 
    MIN(ts::timestamp) AS detected_ts
  FROM analytics_events
  WHERE event = 'issue_detected' AND issue_id IS NOT NULL
  GROUP BY issue_id, account_id
),
opened AS (
  SELECT 
    issue_id, 
    account_id, 
    MIN(ts::timestamp) AS opened_ts
  FROM analytics_events
  WHERE event = 'issue_opened' AND issue_id IS NOT NULL
  GROUP BY issue_id, account_id
)
SELECT 
  d.account_id,
  d.issue_id,
  d.detected_ts,
  o.opened_ts,
  ROUND(EXTRACT(EPOCH FROM (o.opened_ts - d.detected_ts))) AS seconds_to_investigate
FROM detected d
LEFT JOIN opened o ON d.issue_id = o.issue_id AND d.account_id = o.account_id;

-- 2. Weekly action rate (proportion of issues reviewed or resolved)
CREATE OR REPLACE VIEW view_weekly_action_rate AS
SELECT 
  account_id,
  COUNT(*) AS total_issues,
  COUNT(CASE WHEN state IN ('reviewed', 'resolved', 'dismissed') THEN 1 END) AS acted_issues,
  ROUND(
    COUNT(CASE WHEN state IN ('reviewed', 'resolved', 'dismissed') THEN 1 END)::numeric / 
    NULLIF(COUNT(*), 0) * 100, 
    2
  ) AS action_rate_pct
FROM issues
GROUP BY account_id;

-- 3. Group adoption (number of groups and % of active campaigns grouped)
CREATE OR REPLACE VIEW view_group_adoption AS
WITH grouped_camps AS (
  SELECT DISTINCT campaign_id, g.account_id
  FROM group_members gm
  JOIN groups g ON gm.group_id = g.id
),
total_active AS (
  SELECT account_id, COUNT(*) AS active_count
  FROM campaigns
  WHERE status = 'Active'
  GROUP BY account_id
)
SELECT 
  ta.account_id,
  (SELECT COUNT(*) FROM groups g WHERE g.account_id = ta.account_id) AS total_groups,
  COUNT(gc.campaign_id) AS grouped_campaigns,
  ta.active_count AS total_active_campaigns,
  ROUND(
    COUNT(gc.campaign_id)::numeric / NULLIF(ta.active_count, 0) * 100,
    2
  ) AS adoption_pct
FROM total_active ta
LEFT JOIN grouped_camps gc ON ta.account_id = gc.account_id
GROUP BY ta.account_id, ta.active_count;

-- 4. Alert action rate & false-positive guardrail (triggers with feedback or actions vs total triggers)
CREATE OR REPLACE VIEW view_alert_action_rate AS
SELECT 
  ar.account_id,
  ar.id AS rule_id,
  ar.name AS rule_name,
  COUNT(at.id) AS total_triggers,
  COUNT(CASE WHEN at.feedback = 'not_actionable' THEN 1 END) AS not_actionable_count,
  ROUND(
    COUNT(CASE WHEN at.feedback = 'not_actionable' THEN 1 END)::numeric / 
    NULLIF(COUNT(at.id), 0) * 100, 
    2
  ) AS false_positive_pct
FROM alert_rules ar
LEFT JOIN alert_triggers at ON ar.id = at.rule_id
GROUP BY ar.account_id, ar.id, ar.name;
`;
