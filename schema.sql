-- ============================================================================
-- KPI Prototype — PostgreSQL Schema
-- United India Insurance Co. Ltd. — KPI Approach
--
-- Mirrors the data model used by the browser prototype (index.html), with
-- the business rules we agreed on enforced properly at the database level
-- instead of just in the UI:
--   - Employees: fully flattened (one row per person + role + KPA); weightage
--     is allocated directly on each row — there is no separate role template —
--     and all of one person's weightages (emp_code), across every role, must
--     sum to 100.
--   - Targets: no acceptance workflow — inserting a target immediately
--     spawns its Work Allocation Order via trigger.
--   - Work Allocation Orders: actual_value is entered by the employee,
--     mark is always a manual entry by the Accepting Authority — the
--     marking-scale bands are exposed only as a reference (fn_suggested_mark),
--     never auto-applied.
--
-- Run with:  psql -U <user> -d <database> -f schema.sql
-- Requires PostgreSQL 13+ (uses built-in gen_random_uuid()).
-- ============================================================================

-- ============================================================================
-- IN PLAIN WORDS — what this file sets up
-- ============================================================================
-- This file creates the 7 tables (think: spreadsheets, each row is one record)
-- that this application's data lives in, inside a PostgreSQL database.
--   departments            — the list of departments (e.g. "Underwriting")
--   roles                  — the list of job types (e.g. "Branch Manager")
--   kpas                   — the list of performance metrics being tracked
--   kpa_bands              — the scoring scale for each kpa (reference only)
--   employees              — one row per person per role per metric they're
--                             scored on, and how much that metric is worth
--   targets                — the goal set for one person for one month
--   work_allocation_orders — the paperwork that tracks that month's actual
--                             result, from "waiting on the employee" through
--                             to "manager accepted it"
-- A line like "department_id bigint REFERENCES departments(id)" means that
-- column is a pointer/label to a specific row in another table — e.g. every
-- employees row points at exactly one row in departments, rather than typing
-- the department name out freely each time.
-- "Trigger" functions further down (the CREATE TRIGGER blocks) are rules the
-- database runs automatically whenever certain rows are added or changed —
-- for example, the instant a target is saved, a matching work order is
-- created for it with no extra step from the application's code.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. DEPARTMENTS — controlled list, not free text
-- ----------------------------------------------------------------------------
CREATE TABLE departments (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, -- a number the database assigns automatically to each new row
    name        text NOT NULL UNIQUE -- the department's name; "NOT NULL" = required, "UNIQUE" = no two departments can share a name
);
COMMENT ON TABLE departments IS 'Controlled department list, referenced by employees.department_id instead of free-text.';

-- ----------------------------------------------------------------------------
-- 2. ROLES — job types
-- ----------------------------------------------------------------------------
CREATE TABLE roles (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, -- auto-assigned row number
    name        text NOT NULL, -- the role's name, e.g. "Branch Manager"
    type        text NOT NULL CHECK (type IN ('Fixed', 'Tailor-made')), -- must be exactly one of these two words — the database refuses anything else
    description text -- free-text notes on what this role does; allowed to be left blank
);
COMMENT ON TABLE roles IS 'Job types. A role''s actual KPAs and weights are defined in role_kpa_matrix, not here.';

-- ----------------------------------------------------------------------------
-- 3. KPAS — parameters
-- ----------------------------------------------------------------------------
CREATE TABLE kpas (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, -- auto-assigned row number
    code        text NOT NULL UNIQUE, -- a short unique code for this metric, e.g. "KPI-003"
    name        text NOT NULL, -- the metric's display name, e.g. "New Policy Count"
    definition  text, -- free-text notes on how this metric is measured/calculated
    unit        text, -- what unit the numbers are in, e.g. "%", "days", "count"
    direction   text NOT NULL CHECK (direction IN ('higher-better', 'lower-better')), -- does a bigger number mean better performance, or a smaller one?
    source      text NOT NULL CHECK (source IN ('GC', 'WB', 'Manual')) -- where the real-world figure for this metric comes from
);
COMMENT ON COLUMN kpas.direction IS 'higher-better: exceeding target is good (e.g. Premium Growth). lower-better: undershooting target is good (e.g. Claims TAT).';
COMMENT ON COLUMN kpas.source IS 'Where the actual performance figure originates: GC = Core Insurance Solution, WB = Workbench, Manual = entered directly.';

-- ----------------------------------------------------------------------------
-- 4. KPA_BANDS — marking-scale bands, one KPA has many bands
-- ----------------------------------------------------------------------------
CREATE TABLE kpa_bands (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, -- auto-assigned row number
    kpa_id      bigint NOT NULL REFERENCES kpas(id) ON DELETE CASCADE, -- points at which metric this scoring row belongs to; "ON DELETE CASCADE" means if that metric is deleted, its bands are automatically deleted too
    label       text NOT NULL, -- the band's display name, e.g. "At Target"
    min_delta   numeric,          -- NULL = open-ended (floor)
    max_delta   numeric,          -- NULL = open-ended (ceiling)
    mark        numeric NOT NULL, -- the mark this band suggests, out of 100
    sort_order  int NOT NULL DEFAULT 0 -- which position this band is checked in, top to bottom
);
COMMENT ON TABLE kpa_bands IS 'Reference-only marking scale. min_delta/max_delta are offsets from target in "goodness" terms (positive = better than target) — direction-agnostic, see fn_suggested_mark().';
CREATE INDEX idx_kpa_bands_kpa ON kpa_bands(kpa_id, sort_order);

-- ----------------------------------------------------------------------------
-- 5. EMPLOYEES — fully flattened: one row per person + role + KPA
-- ----------------------------------------------------------------------------
CREATE TABLE employees (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, -- auto-assigned row number
    emp_code        text NOT NULL, -- the person's employee code, e.g. "EMP1001" — the same code repeats across all of one person's rows
    name            text NOT NULL, -- the person's full name
    department_id   bigint REFERENCES departments(id), -- which department row this person belongs to (optional — can be left unset)
    office_code     text, -- a free-text office code, e.g. "RO-CHN"
    role_id         bigint NOT NULL REFERENCES roles(id), -- which role row this one metric is being scored under
    kpa_id          bigint NOT NULL REFERENCES kpas(id), -- which metric this row scores the person on
    weightage_pct   numeric NOT NULL CHECK (weightage_pct >= 0 AND weightage_pct <= 100), -- how much this one metric counts for, as a percentage — must be between 0 and 100
    start_date      date NOT NULL, -- when this person started being scored on this metric
    end_date        date, -- when (if ever) this stopped applying; left blank while still active
    UNIQUE (emp_code, role_id, kpa_id) -- the same person can't have two rows for the exact same role+metric combination
);
COMMENT ON TABLE employees IS 'One row per person per role per KPA. role_id is just the mapping (where the row''s KPA came from) — it carries no weight of its own. All rows sharing one emp_code, across every role, must sum to 100.';
CREATE INDEX idx_employees_emp_code ON employees(emp_code);

-- This function is the actual "must add up to 100%" rule-checker. It runs
-- automatically (see the trigger below) after any employees row is added,
-- changed, or removed.
CREATE OR REPLACE FUNCTION fn_check_employee_weightage_sum() RETURNS trigger AS $$
DECLARE
    v_emp_code text;  -- a holding spot for the employee code just affected
    v_total    numeric; -- a holding spot for that person's weightage total
BEGIN
    -- Figure out which person's rows just changed (works for an insert, an
    -- update, or a delete — exactly one of NEW/OLD will have the code).
    v_emp_code := COALESCE(NEW.emp_code, OLD.emp_code);
    -- Add up every weightage_pct across all of that person's rows right now.
    SELECT COALESCE(SUM(weightage_pct), 0) INTO v_total
    FROM employees WHERE emp_code = v_emp_code;
    -- If that total isn't exactly 100, stop the whole save with an error
    -- message — this is what makes the rule actually enforced, not just advisory.
    IF v_total <> 100 THEN
        RAISE EXCEPTION 'Employee % KPA weightages must sum to 100 across all roles (currently %)', v_emp_code, v_total;
    END IF;
    RETURN NULL; -- this kind of trigger doesn't change the row, it only ever allows or blocks the save
END;
$$ LANGUAGE plpgsql;

-- Attach the checker above so it runs after every insert/update/delete on
-- employees. "DEFERRABLE INITIALLY DEFERRED" means the check waits until the
-- very end of the save (not after every single row), so adding several rows
-- for one new person in one go is allowed even though the total isn't 100%
-- until the last one is in.
CREATE CONSTRAINT TRIGGER trg_employee_weightage_sum
    AFTER INSERT OR UPDATE OR DELETE ON employees
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION fn_check_employee_weightage_sum();

-- ----------------------------------------------------------------------------
-- 6. TARGETS — no acceptance workflow; live the instant they're inserted
-- ----------------------------------------------------------------------------
CREATE TABLE targets (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, -- auto-assigned row number
    employee_id     bigint NOT NULL REFERENCES employees(id) ON DELETE CASCADE, -- which person+role+metric row this target is for
    period          char(7) NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),  -- which month, written as 'YYYY-MM'; the CHECK rejects anything not in that exact shape
    target_value    numeric NOT NULL, -- the goal number itself
    set_by          text NOT NULL, -- the name/title of whoever set this target
    created_at      timestamptz NOT NULL DEFAULT now(), -- exactly when this target was saved, filled in automatically
    UNIQUE (employee_id, period) -- only one target allowed per person-row per month
);
COMMENT ON TABLE targets IS 'No kpa_id here — implied by which employees row (person+role+KPA) this points to. No status column — a row existing means it is live.';

-- ----------------------------------------------------------------------------
-- 7. WORK_ALLOCATION_ORDERS
-- ----------------------------------------------------------------------------
CREATE TABLE work_allocation_orders (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, -- auto-assigned row number
    employee_id     bigint NOT NULL REFERENCES employees(id) ON DELETE CASCADE, -- which person+role+metric row this order tracks
    target_id       bigint NOT NULL REFERENCES targets(id) ON DELETE CASCADE, -- which target row this order was created from
    period          char(7) NOT NULL, -- which month, copied from the target so it doesn't need a lookup every time
    target_value    numeric NOT NULL, -- the goal figure, copied from the target at the moment this order was created
    weightage_pct   numeric NOT NULL, -- how much this metric counts for, copied from the employee row at that same moment
    actual_value    numeric,             -- entered by the employee, in the Workbench
    submitted_date  date, -- when the employee entered their actual value
    mark            numeric,             -- entered manually by the Accepting Authority — never auto-calculated
    accepted_by     text, -- the name/title of whoever accepted it
    accepted_date   date, -- when it was accepted
    status          text NOT NULL DEFAULT 'Pending Entry' -- starts here automatically when created, and moves forward from there
                        CHECK (status IN ('Pending Entry', 'Submitted', 'Accepted', 'Rejected')), -- only these four values are ever allowed
    UNIQUE (employee_id, period) -- only one order allowed per person-row per month
);
COMMENT ON TABLE work_allocation_orders IS 'Auto-created the instant a target is inserted (see trg_target_creates_wao). actual_value is self-entered by the employee; mark is always a manual entry by the Accepting Authority, never derived from kpa_bands automatically.';
CREATE INDEX idx_wao_employee_period ON work_allocation_orders(employee_id, period);
CREATE INDEX idx_wao_status ON work_allocation_orders(status);

-- Auto-create the Work Allocation Order the moment a Target is inserted —
-- this is what "no acceptance gate, live immediately" means in practice.
CREATE OR REPLACE FUNCTION fn_target_creates_wao() RETURNS trigger AS $$
DECLARE
    v_weightage numeric; -- a holding spot for this person's weightage on this metric
BEGIN
    -- Look up how much this metric is worth for this person right now.
    SELECT weightage_pct INTO v_weightage FROM employees WHERE id = NEW.employee_id;
    -- Create the matching order, copying over the target's details, starting
    -- it off in the very first stage ("Pending Entry").
    INSERT INTO work_allocation_orders (employee_id, target_id, period, target_value, weightage_pct, status)
    VALUES (NEW.employee_id, NEW.id, NEW.period, NEW.target_value, v_weightage, 'Pending Entry');
    RETURN NEW; -- hand back the target row unchanged; this trigger's whole job is the INSERT above
END;
$$ LANGUAGE plpgsql;

-- Attach the function above so it runs automatically right after every new target is saved.
CREATE TRIGGER trg_target_creates_wao
    AFTER INSERT ON targets
    FOR EACH ROW EXECUTE FUNCTION fn_target_creates_wao();

-- When the employee re-submits after a Rejected order, any previous mark
-- must be cleared and the status put back to Submitted for re-review.
CREATE OR REPLACE FUNCTION fn_wao_resubmit_clears_mark() RETURNS trigger AS $$
BEGIN
    -- Only step in if the actual value just changed AND the save is setting
    -- status to "Submitted" — i.e. this is a genuine re-entry, not some other edit.
    IF NEW.actual_value IS DISTINCT FROM OLD.actual_value AND NEW.status = 'Submitted' THEN
        -- Wipe out whatever mark/acceptance was recorded before, so it goes
        -- through a completely fresh review rather than keeping a stale mark.
        NEW.mark := NULL;
        NEW.accepted_by := NULL;
        NEW.accepted_date := NULL;
    END IF;
    RETURN NEW; -- hand back the (possibly just-cleared) row to actually be saved
END;
$$ LANGUAGE plpgsql;

-- Attach the function above so it runs automatically right before every update to an order.
CREATE TRIGGER trg_wao_resubmit_clears_mark
    BEFORE UPDATE ON work_allocation_orders
    FOR EACH ROW EXECUTE FUNCTION fn_wao_resubmit_clears_mark();

-- ----------------------------------------------------------------------------
-- MARKING SCALE — reference/preview only, mirrors MarkingScale.suggestedMark()
-- from the browser prototype. Never called by any trigger; it is only ever
-- surfaced to the Accepting Authority as a suggestion.
-- ----------------------------------------------------------------------------
-- Given a metric, its target, and an actual figure, work out which scoring
-- band that falls into and return the mark it suggests.
CREATE OR REPLACE FUNCTION fn_suggested_mark(p_kpa_id bigint, p_target numeric, p_actual numeric)
RETURNS numeric AS $$
DECLARE
    v_direction text;  -- holds whether higher or lower is better for this metric
    v_delta     numeric; -- holds "how much better than target" the actual figure is
    v_mark      numeric; -- holds the matching band's mark, once found
BEGIN
    -- Nothing to suggest if no actual figure has been entered yet.
    IF p_actual IS NULL THEN
        RETURN NULL;
    END IF;

    -- Look up whether this metric counts a bigger number as better or worse.
    SELECT direction INTO v_direction FROM kpas WHERE id = p_kpa_id;

    -- Turn target vs. actual into one "goodness" number: positive means
    -- better than target, negative means worse — regardless of whether this
    -- metric is "higher is better" or "lower is better".
    v_delta := CASE WHEN v_direction = 'higher-better'
                    THEN p_actual - p_target
                    ELSE p_target - p_actual
               END;

    -- Find the first band (in order) whose min/max range includes this delta.
    SELECT mark INTO v_mark
    FROM kpa_bands
    WHERE kpa_id = p_kpa_id
      AND (min_delta IS NULL OR v_delta >= min_delta)
      AND (max_delta IS NULL OR v_delta <= max_delta)
    ORDER BY sort_order
    LIMIT 1;

    RETURN v_mark;  -- NULL if no band matches (misconfigured scale)
END;
$$ LANGUAGE plpgsql STABLE;

-- ----------------------------------------------------------------------------
-- KPI SCORE — computed, not stored. Mirrors renderDashboard() in the app:
-- flat weighted sum of mark x weightage across a person's Accepted rows.
-- ----------------------------------------------------------------------------
-- One row per metric a person is scored on, for one month, with its weighted
-- contribution already calculated (mark x weight, only once Accepted).
CREATE OR REPLACE FUNCTION fn_kpi_score_lines(p_emp_code text, p_period char(7))
RETURNS TABLE (
    role_name       text,
    kpa_name        text,
    weightage_pct   numeric,
    actual_value    numeric,
    mark            numeric,
    weighted_score  numeric,
    wao_status      text
) AS $$
    SELECT
        r.name,
        k.name,
        e.weightage_pct,
        w.actual_value,
        w.mark,
        -- Only count this metric toward the score if its order has reached
        -- "Accepted" — otherwise leave it blank (NULL) rather than guessing.
        CASE WHEN w.status = 'Accepted' THEN ROUND((w.mark * e.weightage_pct) / 100.0, 2) ELSE NULL END,
        w.status
    FROM employees e
    JOIN roles r ON r.id = e.role_id
    JOIN kpas  k ON k.id = e.kpa_id
    -- LEFT JOIN so a metric with no order yet for this month still shows up (with blanks),
    -- instead of silently disappearing from the list.
    LEFT JOIN work_allocation_orders w
           ON w.employee_id = e.id AND w.period = p_period
    WHERE e.emp_code = p_emp_code;
$$ LANGUAGE sql STABLE;

-- Adds up every line from the function above into the one final score the
-- Dashboard screen shows, plus how many of the metrics have actually been scored.
CREATE OR REPLACE FUNCTION fn_kpi_score_final(p_emp_code text, p_period char(7))
RETURNS TABLE (
    final_score  numeric,
    kpas_scored  int,
    kpas_total   int
) AS $$
    SELECT
        COALESCE(SUM(weighted_score), 0), -- add up every line's weighted contribution (0 if there are none yet)
        COUNT(*) FILTER (WHERE weighted_score IS NOT NULL)::int, -- how many metrics have actually been scored so far
        COUNT(*)::int -- how many metrics this person has in total
    FROM fn_kpi_score_lines(p_emp_code, p_period);
$$ LANGUAGE sql STABLE;

COMMIT;

-- No seed/sample data is inserted by this file. All departments, roles, KPAs,
-- employees, targets, and work allocation orders are created by users through
-- the application — this schema only establishes structure and business rules.
