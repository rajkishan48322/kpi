-- ============================================================================
-- KPI Prototype — PostgreSQL Schema
-- United India Insurance Co. Ltd. — KPI Approach
--
-- Mirrors the data model used by the browser prototype (index.html), with
-- the business rules we agreed on enforced properly at the database level
-- instead of just in the UI:
--   - Role–KPA Matrix: a (role, kpa) pair can only appear once, and all of
--     one role's weightages must sum to 100.
--   - Employees: fully flattened (one row per person + role + KPA); all of
--     one person's weightages (emp_code), across every role, must sum to 100.
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

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. DEPARTMENTS — controlled list, not free text
-- ----------------------------------------------------------------------------
CREATE TABLE departments (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        text NOT NULL UNIQUE
);
COMMENT ON TABLE departments IS 'Controlled department list, referenced by employees.department_id instead of free-text.';

-- ----------------------------------------------------------------------------
-- 2. ROLES — job types
-- ----------------------------------------------------------------------------
CREATE TABLE roles (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        text NOT NULL,
    type        text NOT NULL CHECK (type IN ('Fixed', 'Tailor-made')),
    description text
);
COMMENT ON TABLE roles IS 'Job types. A role''s actual KPAs and weights are defined in role_kpa_matrix, not here.';

-- ----------------------------------------------------------------------------
-- 3. KPAS — parameters
-- ----------------------------------------------------------------------------
CREATE TABLE kpas (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code        text NOT NULL UNIQUE,
    name        text NOT NULL,
    definition  text,
    unit        text,
    direction   text NOT NULL CHECK (direction IN ('higher-better', 'lower-better')),
    source      text NOT NULL CHECK (source IN ('GC', 'WB', 'Manual'))
);
COMMENT ON COLUMN kpas.direction IS 'higher-better: exceeding target is good (e.g. Premium Growth). lower-better: undershooting target is good (e.g. Claims TAT).';
COMMENT ON COLUMN kpas.source IS 'Where the actual performance figure originates: GC = Core Insurance Solution, WB = Workbench, Manual = entered directly.';

-- ----------------------------------------------------------------------------
-- 4. KPA_BANDS — marking-scale bands, one KPA has many bands
-- ----------------------------------------------------------------------------
CREATE TABLE kpa_bands (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kpa_id      bigint NOT NULL REFERENCES kpas(id) ON DELETE CASCADE,
    label       text NOT NULL,
    min_delta   numeric,          -- NULL = open-ended (floor)
    max_delta   numeric,          -- NULL = open-ended (ceiling)
    mark        numeric NOT NULL,
    sort_order  int NOT NULL DEFAULT 0
);
COMMENT ON TABLE kpa_bands IS 'Reference-only marking scale. min_delta/max_delta are offsets from target in "goodness" terms (positive = better than target) — direction-agnostic, see fn_suggested_mark().';
CREATE INDEX idx_kpa_bands_kpa ON kpa_bands(kpa_id, sort_order);

-- ----------------------------------------------------------------------------
-- 5. ROLE_KPA_MATRIX — the template: which KPAs belong to a role, and weight
-- ----------------------------------------------------------------------------
CREATE TABLE role_kpa_matrix (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    role_id         bigint NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    kpa_id          bigint NOT NULL REFERENCES kpas(id) ON DELETE CASCADE,
    weightage_pct   numeric NOT NULL CHECK (weightage_pct >= 0 AND weightage_pct <= 100),
    UNIQUE (role_id, kpa_id)   -- a KPA can only appear once per role (no ambiguous duplicates)
);
COMMENT ON TABLE role_kpa_matrix IS 'Template only — defines what a role is measured on. Employees copy their own weightage default from here, but can be edited per person.';

-- Enforce "all of one role's weights sum to 100" at commit time (deferred, so
-- you can add/edit rows one at a time within a transaction and only the final
-- state at COMMIT has to be valid).
CREATE OR REPLACE FUNCTION fn_check_matrix_weightage_sum() RETURNS trigger AS $$
DECLARE
    v_role_id bigint;
    v_total   numeric;
BEGIN
    v_role_id := COALESCE(NEW.role_id, OLD.role_id);
    SELECT COALESCE(SUM(weightage_pct), 0) INTO v_total
    FROM role_kpa_matrix WHERE role_id = v_role_id;
    IF v_total <> 100 THEN
        RAISE EXCEPTION 'Role % KPA weightages must sum to 100 (currently %)', v_role_id, v_total;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_matrix_weightage_sum
    AFTER INSERT OR UPDATE OR DELETE ON role_kpa_matrix
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION fn_check_matrix_weightage_sum();

-- ----------------------------------------------------------------------------
-- 6. EMPLOYEES — fully flattened: one row per person + role + KPA
-- ----------------------------------------------------------------------------
CREATE TABLE employees (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    emp_code        text NOT NULL,
    name            text NOT NULL,
    department_id   bigint REFERENCES departments(id),
    office_code     text,
    role_id         bigint NOT NULL REFERENCES roles(id),
    kpa_id          bigint NOT NULL REFERENCES kpas(id),
    weightage_pct   numeric NOT NULL CHECK (weightage_pct >= 0 AND weightage_pct <= 100),
    start_date      date NOT NULL,
    end_date        date,
    UNIQUE (emp_code, role_id, kpa_id)
);
COMMENT ON TABLE employees IS 'One row per person per role per KPA. role_id is just the mapping (where the row''s KPA came from) — it carries no weight of its own. All rows sharing one emp_code, across every role, must sum to 100.';
CREATE INDEX idx_employees_emp_code ON employees(emp_code);

CREATE OR REPLACE FUNCTION fn_check_employee_weightage_sum() RETURNS trigger AS $$
DECLARE
    v_emp_code text;
    v_total    numeric;
BEGIN
    v_emp_code := COALESCE(NEW.emp_code, OLD.emp_code);
    SELECT COALESCE(SUM(weightage_pct), 0) INTO v_total
    FROM employees WHERE emp_code = v_emp_code;
    IF v_total <> 100 THEN
        RAISE EXCEPTION 'Employee % KPA weightages must sum to 100 across all roles (currently %)', v_emp_code, v_total;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_employee_weightage_sum
    AFTER INSERT OR UPDATE OR DELETE ON employees
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION fn_check_employee_weightage_sum();

-- ----------------------------------------------------------------------------
-- 7. TARGETS — no acceptance workflow; live the instant they're inserted
-- ----------------------------------------------------------------------------
CREATE TABLE targets (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id     bigint NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    period          char(7) NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),  -- 'YYYY-MM'
    target_value    numeric NOT NULL,
    set_by          text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (employee_id, period)
);
COMMENT ON TABLE targets IS 'No kpa_id here — implied by which employees row (person+role+KPA) this points to. No status column — a row existing means it is live.';

-- ----------------------------------------------------------------------------
-- 8. WORK_ALLOCATION_ORDERS
-- ----------------------------------------------------------------------------
CREATE TABLE work_allocation_orders (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    employee_id     bigint NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    target_id       bigint NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
    period          char(7) NOT NULL,
    target_value    numeric NOT NULL,
    weightage_pct   numeric NOT NULL,
    actual_value    numeric,             -- entered by the employee, in the Workbench
    submitted_date  date,
    mark            numeric,             -- entered manually by the Accepting Authority — never auto-calculated
    accepted_by     text,
    accepted_date   date,
    status          text NOT NULL DEFAULT 'Pending Entry'
                        CHECK (status IN ('Pending Entry', 'Submitted', 'Accepted', 'Rejected')),
    UNIQUE (employee_id, period)
);
COMMENT ON TABLE work_allocation_orders IS 'Auto-created the instant a target is inserted (see trg_target_creates_wao). actual_value is self-entered by the employee; mark is always a manual entry by the Accepting Authority, never derived from kpa_bands automatically.';
CREATE INDEX idx_wao_employee_period ON work_allocation_orders(employee_id, period);
CREATE INDEX idx_wao_status ON work_allocation_orders(status);

-- Auto-create the Work Allocation Order the moment a Target is inserted —
-- this is what "no acceptance gate, live immediately" means in practice.
CREATE OR REPLACE FUNCTION fn_target_creates_wao() RETURNS trigger AS $$
DECLARE
    v_weightage numeric;
BEGIN
    SELECT weightage_pct INTO v_weightage FROM employees WHERE id = NEW.employee_id;
    INSERT INTO work_allocation_orders (employee_id, target_id, period, target_value, weightage_pct, status)
    VALUES (NEW.employee_id, NEW.id, NEW.period, NEW.target_value, v_weightage, 'Pending Entry');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_target_creates_wao
    AFTER INSERT ON targets
    FOR EACH ROW EXECUTE FUNCTION fn_target_creates_wao();

-- When the employee re-submits after a Rejected order, any previous mark
-- must be cleared and the status put back to Submitted for re-review.
CREATE OR REPLACE FUNCTION fn_wao_resubmit_clears_mark() RETURNS trigger AS $$
BEGIN
    IF NEW.actual_value IS DISTINCT FROM OLD.actual_value AND NEW.status = 'Submitted' THEN
        NEW.mark := NULL;
        NEW.accepted_by := NULL;
        NEW.accepted_date := NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_wao_resubmit_clears_mark
    BEFORE UPDATE ON work_allocation_orders
    FOR EACH ROW EXECUTE FUNCTION fn_wao_resubmit_clears_mark();

-- ----------------------------------------------------------------------------
-- MARKING SCALE — reference/preview only, mirrors MarkingScale.suggestedMark()
-- from the browser prototype. Never called by any trigger; it is only ever
-- surfaced to the Accepting Authority as a suggestion.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_suggested_mark(p_kpa_id bigint, p_target numeric, p_actual numeric)
RETURNS numeric AS $$
DECLARE
    v_direction text;
    v_delta     numeric;
    v_mark      numeric;
BEGIN
    IF p_actual IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT direction INTO v_direction FROM kpas WHERE id = p_kpa_id;

    v_delta := CASE WHEN v_direction = 'higher-better'
                    THEN p_actual - p_target
                    ELSE p_target - p_actual
               END;

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
        CASE WHEN w.status = 'Accepted' THEN ROUND((w.mark * e.weightage_pct) / 100.0, 2) ELSE NULL END,
        w.status
    FROM employees e
    JOIN roles r ON r.id = e.role_id
    JOIN kpas  k ON k.id = e.kpa_id
    LEFT JOIN work_allocation_orders w
           ON w.employee_id = e.id AND w.period = p_period
    WHERE e.emp_code = p_emp_code;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION fn_kpi_score_final(p_emp_code text, p_period char(7))
RETURNS TABLE (
    final_score  numeric,
    kpas_scored  int,
    kpas_total   int
) AS $$
    SELECT
        COALESCE(SUM(weighted_score), 0),
        COUNT(*) FILTER (WHERE weighted_score IS NOT NULL)::int,
        COUNT(*)::int
    FROM fn_kpi_score_lines(p_emp_code, p_period);
$$ LANGUAGE sql STABLE;

COMMIT;

-- ============================================================================
-- SEED DATA — same worked example used in the plan and the browser prototype
-- (A. Sharma single-role, R. Iyer single-role, P. Nair multi-role) so results
-- can be cross-checked against it directly. Expected fn_kpi_score_final:
--   EMP1001 A. Sharma / 2026-07 -> 57.0  (partial, 1 of 2 KPAs scored)
--   EMP1002 R. Iyer   / 2026-07 -> 95.0
--   EMP1003 P. Nair   / 2026-07 -> 73.5  (partial, 2 of 3 KPAs scored)
-- ============================================================================

BEGIN;

INSERT INTO departments (name) VALUES ('Marketing'), ('Claims');

INSERT INTO roles (name, type, description) VALUES
    ('Marketing Officer', 'Fixed', 'Handles business development, premium growth targets.'),
    ('Claims Officer', 'Fixed', 'Handles claim settlement and turnaround time.');

INSERT INTO kpas (code, name, definition, unit, direction, source) VALUES
    ('KPI-001', 'Premium Growth %', 'Growth in premium booked vs. same period last year.', '%', 'higher-better', 'GC'),
    ('KPI-002', 'Average OD Claims TAT', 'Average turnaround time to settle Own Damage claims.', 'days', 'lower-better', 'WB');

-- identical band template on both KPAs, proving the scale is direction-agnostic
INSERT INTO kpa_bands (kpa_id, label, min_delta, max_delta, mark, sort_order)
SELECT k.id, b.label, b.min_delta, b.max_delta, b.mark, b.sort_order
FROM kpas k
CROSS JOIN (VALUES
    ('At Target',            0::numeric,     0::numeric,   90, 1),
    ('Slightly below',      -1,             -0.01,         80, 2),
    ('Further below',       -2,             -1.01,         70, 3),
    ('Well below (floor)',  NULL::numeric,  -2.01,         50, 4),
    ('Slightly above',       0.01,           1,             95, 5),
    ('Well above (ceiling)', 1.01,           NULL::numeric, 100, 6)
) AS b(label, min_delta, max_delta, mark, sort_order);

INSERT INTO role_kpa_matrix (role_id, kpa_id, weightage_pct) VALUES
    ((SELECT id FROM roles WHERE name = 'Marketing Officer'), (SELECT id FROM kpas WHERE code = 'KPI-001'), 60),
    ((SELECT id FROM roles WHERE name = 'Marketing Officer'), (SELECT id FROM kpas WHERE code = 'KPI-002'), 40),
    ((SELECT id FROM roles WHERE name = 'Claims Officer'),    (SELECT id FROM kpas WHERE code = 'KPI-002'), 100);

INSERT INTO employees (emp_code, name, department_id, office_code, role_id, kpa_id, weightage_pct, start_date) VALUES
    ('EMP1001', 'A. Sharma', (SELECT id FROM departments WHERE name = 'Marketing'), 'RO-CHN',
        (SELECT id FROM roles WHERE name = 'Marketing Officer'), (SELECT id FROM kpas WHERE code = 'KPI-001'), 60, '2026-04-01'),
    ('EMP1001', 'A. Sharma', (SELECT id FROM departments WHERE name = 'Marketing'), 'RO-CHN',
        (SELECT id FROM roles WHERE name = 'Marketing Officer'), (SELECT id FROM kpas WHERE code = 'KPI-002'), 40, '2026-04-01'),
    ('EMP1002', 'R. Iyer', (SELECT id FROM departments WHERE name = 'Claims'), 'BO-CBE',
        (SELECT id FROM roles WHERE name = 'Claims Officer'), (SELECT id FROM kpas WHERE code = 'KPI-002'), 100, '2026-04-01'),
    ('EMP1003', 'P. Nair', (SELECT id FROM departments WHERE name = 'Claims'), 'BO-CBE',
        (SELECT id FROM roles WHERE name = 'Claims Officer'), (SELECT id FROM kpas WHERE code = 'KPI-002'), 50, '2026-04-01'),
    ('EMP1003', 'P. Nair', (SELECT id FROM departments WHERE name = 'Marketing'), 'BO-CBE',
        (SELECT id FROM roles WHERE name = 'Marketing Officer'), (SELECT id FROM kpas WHERE code = 'KPI-001'), 30, '2026-04-01'),
    ('EMP1003', 'P. Nair', (SELECT id FROM departments WHERE name = 'Marketing'), 'BO-CBE',
        (SELECT id FROM roles WHERE name = 'Marketing Officer'), (SELECT id FROM kpas WHERE code = 'KPI-002'), 20, '2026-04-01');

-- Targets: inserting these auto-creates their Work Allocation Orders via trigger.
-- Note: P. Nair's Marketing-role Claims TAT (weightage 20) has NO target this
-- period — left un-targeted on purpose, to demonstrate the partial score.
INSERT INTO targets (employee_id, period, target_value, set_by) VALUES
    ((SELECT id FROM employees WHERE emp_code = 'EMP1001' AND kpa_id = (SELECT id FROM kpas WHERE code = 'KPI-001')), '2026-07', 10, 'RO Marketing Head'),
    ((SELECT id FROM employees WHERE emp_code = 'EMP1001' AND kpa_id = (SELECT id FROM kpas WHERE code = 'KPI-002')), '2026-07', 7,  'RO Marketing Head'),
    ((SELECT id FROM employees WHERE emp_code = 'EMP1002'), '2026-07', 7, 'RO Claims Head'),
    ((SELECT id FROM employees WHERE emp_code = 'EMP1003' AND role_id = (SELECT id FROM roles WHERE name = 'Claims Officer')), '2026-07', 6, 'RO Claims Head'),
    ((SELECT id FROM employees WHERE emp_code = 'EMP1003' AND kpa_id = (SELECT id FROM kpas WHERE code = 'KPI-001')), '2026-07', 12, 'RO Marketing Head');

-- Now simulate the Workbench: employees enter actuals, Accepting Authorities mark them.
-- A. Sharma's Claims TAT (KPI-002) order is deliberately left at 'Pending Entry'
-- to demonstrate a partial score, same as the browser prototype's seed data.
UPDATE work_allocation_orders w SET
    actual_value = 11, submitted_date = '2026-07-28', mark = 95,
    accepted_by = 'RO Marketing Head', accepted_date = '2026-07-30', status = 'Accepted'
WHERE employee_id = (SELECT id FROM employees WHERE emp_code = 'EMP1001' AND kpa_id = (SELECT id FROM kpas WHERE code = 'KPI-001'))
  AND period = '2026-07';

UPDATE work_allocation_orders w SET
    actual_value = 6.5, submitted_date = '2026-07-27', mark = 95,
    accepted_by = 'RO Claims Head', accepted_date = '2026-07-29', status = 'Accepted'
WHERE employee_id = (SELECT id FROM employees WHERE emp_code = 'EMP1002')
  AND period = '2026-07';

UPDATE work_allocation_orders w SET
    actual_value = 6, submitted_date = '2026-07-26', mark = 90,
    accepted_by = 'RO Claims Head', accepted_date = '2026-07-29', status = 'Accepted'
WHERE employee_id = (SELECT id FROM employees WHERE emp_code = 'EMP1003' AND role_id = (SELECT id FROM roles WHERE name = 'Claims Officer'))
  AND period = '2026-07';

UPDATE work_allocation_orders w SET
    actual_value = 13, submitted_date = '2026-07-28', mark = 95,
    accepted_by = 'RO Marketing Head', accepted_date = '2026-07-30', status = 'Accepted'
WHERE employee_id = (SELECT id FROM employees WHERE emp_code = 'EMP1003' AND kpa_id = (SELECT id FROM kpas WHERE code = 'KPI-001'))
  AND period = '2026-07';

COMMIT;

-- ============================================================================
-- SANITY CHECK — run this after loading the file to confirm it matches the
-- plan's worked example exactly (57.0 / 95.0 / 73.5):
--
--   SELECT 'EMP1001' emp_code, * FROM fn_kpi_score_final('EMP1001', '2026-07')
--   UNION ALL
--   SELECT 'EMP1002', * FROM fn_kpi_score_final('EMP1002', '2026-07')
--   UNION ALL
--   SELECT 'EMP1003', * FROM fn_kpi_score_final('EMP1003', '2026-07');
--
-- To see the line-by-line breakdown for one person:
--   SELECT * FROM fn_kpi_score_lines('EMP1003', '2026-07');
-- ============================================================================
