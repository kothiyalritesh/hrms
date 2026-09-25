-- ============================================================================
-- setup_biometric_smartoffice_integration.sql
-- Complete SmartOffice Biometric Sync & Attendance Setup for RealtyHRM
--
-- Machine Configuration:
--   URL:          http://122.176.140.154:81
--   API Key:      240916062617
--   Account Name: smart
--   Supabase URL: https://jidbrwpzfpbursihtvpg.supabase.co
--
-- How to run:
--   1. Open Supabase Dashboard -> SQL Editor -> New Query
--   2. Paste and run this complete script
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 1: SCHEMA SETUP (Profiles & Device Logs Columns)
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS smartoffice_employee_code VARCHAR(50),
  ADD COLUMN IF NOT EXISTS smartoffice_department VARCHAR(100),
  ADD COLUMN IF NOT EXISTS smartoffice_designation VARCHAR(100),
  ADD COLUMN IF NOT EXISTS smartoffice_grade VARCHAR(50),
  ADD COLUMN IF NOT EXISTS smartoffice_location VARCHAR(100),
  ADD COLUMN IF NOT EXISTS smartoffice_company VARCHAR(100),
  ADD COLUMN IF NOT EXISTS smartoffice_team VARCHAR(100),
  ADD COLUMN IF NOT EXISTS smartoffice_synced_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_profiles_smartoffice_code 
  ON public.profiles(smartoffice_employee_code) 
  WHERE smartoffice_employee_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_smartoffice_sync 
  ON public.profiles(smartoffice_synced_at) 
  WHERE smartoffice_synced_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.smartoffice_device_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  employee_code VARCHAR(50) NOT NULL,
  log_datetime TEXT,
  log_date_only DATE,
  log_time TIME,
  punch_direction VARCHAR(20),
  serial_number VARCHAR(100),
  temperature NUMERIC,
  temperature_state VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.smartoffice_device_logs
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS log_datetime TEXT,
  ADD COLUMN IF NOT EXISTS log_date_only DATE,
  ADD COLUMN IF NOT EXISTS log_time TIME;

CREATE INDEX IF NOT EXISTS idx_smartoffice_device_logs_user 
  ON public.smartoffice_device_logs(user_id);

CREATE INDEX IF NOT EXISTS idx_smartoffice_device_logs_emp 
  ON public.smartoffice_device_logs(employee_code);

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 2: VAULT & PROXY CONFIGURATION (Machine IP & API Key)
-- ────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vault') THEN
    DELETE FROM vault.secrets WHERE name IN (
      'SMARTOFFICE_URL',
      'SMARTOFFICE_API_KEY',
      'SMARTOFFICE_API_ACCOUNT_NAME',
      'SUPABASE_ANON_KEY_FOR_BIOMETRIC_CRON'
    );

    PERFORM vault.create_secret('http://122.176.140.154:81', 'SMARTOFFICE_URL', 'SmartOffice machine endpoint');
    PERFORM vault.create_secret('240916062617', 'SMARTOFFICE_API_KEY', 'SmartOffice API Key');
    PERFORM vault.create_secret('smart', 'SMARTOFFICE_API_ACCOUNT_NAME', 'SmartOffice Account Name');
    PERFORM vault.create_secret(
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImppZGJyd3B6ZnBidXJzaWh0dnBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0MTg3OTgsImV4cCI6MjA4OTk5NDc5OH0.P-j0skFmSd-WtqV5-wi51ArxAwE4ZBt3ctYBtY-mj-0',
      'SUPABASE_ANON_KEY_FOR_BIOMETRIC_CRON',
      'Anon key for scheduled biometric cron'
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_get_smartoffice_proxy_config()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
DECLARE
  v_url text;
  v_api_key text;
  v_account_name text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'FORBIDDEN' USING errcode = '42501';
  END IF;

  BEGIN
    SELECT
      max(decrypted_secret) FILTER (WHERE name = 'SMARTOFFICE_URL'),
      max(decrypted_secret) FILTER (WHERE name = 'SMARTOFFICE_API_KEY'),
      max(decrypted_secret) FILTER (WHERE name = 'SMARTOFFICE_API_ACCOUNT_NAME')
    INTO v_url, v_api_key, v_account_name
    FROM vault.decrypted_secrets
    WHERE name IN (
      'SMARTOFFICE_URL',
      'SMARTOFFICE_API_KEY',
      'SMARTOFFICE_API_ACCOUNT_NAME'
    );
  EXCEPTION WHEN OTHERS THEN
    v_url := NULL;
    v_api_key := NULL;
    v_account_name := NULL;
  END;

  -- Default fallback values for the biometric machine
  v_url := coalesce(nullif(trim(v_url), ''), 'http://122.176.140.154:81');
  v_api_key := coalesce(nullif(trim(v_api_key), ''), '240916062617');
  v_account_name := coalesce(nullif(trim(v_account_name), ''), 'smart');

  RETURN jsonb_build_object(
    'url', trim(v_url),
    'api_key', trim(v_api_key),
    'account_name', nullif(trim(v_account_name), '')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_get_smartoffice_proxy_config() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_get_smartoffice_proxy_config() TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 3: SAFE EMPLOYEE BIOMETRIC CODE MAPPING (200+ Employees)
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  r RECORD;
  v_target_profile_id UUID;
BEGIN
  FOR r IN (
    SELECT emp_number, bio_code, ref_name FROM (VALUES
      -- ── ACCOUNTS COMMERCIAL ──────────────────────────────────
      ('8414',    '8414',    'abhishek tripathi'),
      ('8241',    '8241',    'aditya kaushik'),
      ('AA224',   'AA224',   'jp'),
      ('AA020',   'AA020',   'kailash chand'),
      ('8229',    '8229',    'manoj madan'),
      ('248208',  '248208',  'mithilesh kumar jha'),
      ('8381',    '8381',    'nishu kumar'),
      ('260101',  '260101',  'prateek sharma'),
      ('AA012',   'AA012',   'rajpoot p'),
      ('AA017',   'AA017',   'sanjay kumar bhati'),
      ('8135',    '8135',    'sanjeev kr thakur'),
      ('AA014',   'AA014',   'sumit bansal'),
      ('AA019',   'AA019',   'vikas bhati'),
      -- ── ADMIN & BACKOFFICE ───────────────────────────────────
      ('AA193',   'AA193',   'kamesh badana'),
      ('AA227',   'AA227',   'krishna kumar'),
      ('AA018',   'AA018',   'manish tomar'),
      -- ── CASUAL ───────────────────────────────────────────────
      ('8347',    '8347',    'aditya'),
      ('AA023',   'AA023',   'basant'),
      ('8235',    '8235',    'brijesh basement'),
      ('260118',  '260118',  'harish'),
      ('779',     '779',     'jeet'),
      ('800045',  '800045',  'kamal singh'),
      ('260148',  '260148',  'minam'),
      ('AA411',   'AA411',   'pankaj kumar'),
      ('AA024',   'AA024',   'sajid'),
      ('AA025',   'AA025',   'santosh'),
      ('905',     '905',     'shivam'),
      ('AA122',   'AA122',   'sonu'),
      ('AA026',   'AA026',   'uttam'),
      ('AA022',   'AA022',   'veeresh yadav'),
      ('8327',    '8327',    'vikash'),
      ('8543',    '8543',    'vikash gn'),
      -- ── HR ───────────────────────────────────────────────────
      ('AA006',   'AA006',   'ankur'),
      ('8485',    '8485',    'anshul sharma'),
      ('40902',   '40902',   'deepti'),
      ('248360',  '248360',  'isha pandey'),
      ('119',     '119',     'ishika'),
      ('AA145',   'AA145',   'navneet kumar'),
      ('8479',    '8479',    'nishita atras'),
      ('1809',    '1809',    'vaishali'),
      ('AA004',   'AA004',   'vinita yadav'),
      -- ── MANAGEMENT ───────────────────────────────────────────
      ('AA002',   'AA002',   'ankush kadyan'),
      ('AA001',   'AA001',   'gaurav mavi'),
      ('AA110',   'AA110',   'sachin mavi'),
      ('1111',    '1111',    'uv'),
      -- ── MARKETING ────────────────────────────────────────────
      ('8519',    '8519',    'anant'),
      ('260189',  '260189',  'ayesha tomar'),
      ('8374',    '8374',    'balraj singh'),
      ('248335',  '248335',  'deepti dhingra'),
      ('8540',    '8540',    'devansh bansal'),
      ('260188',  '260188',  'devanshi rathi'),
      ('AA016',   'AA016',   'komal sharma'),
      ('8356',    '8356',    'madhav vij'),
      ('8464',    '8464',    'megha chanden'),
      ('8441',    '8441',    'ritesh'),
      ('8138',    '8138',    'sagar singh'),
      ('8475',    '8475',    'satrajeet neogi'),
      ('8561',    '8561',    'shashank kumar'),
      ('260128',  '260128',  'suraj'),
      ('8346',    '8346',    'vishal joshi'),
      -- ── ROMIL TM ─────────────────────────────────────────────
      ('248326',  '248326',  'abhishek chaudhary'),
      ('93450',   '93450',   'anjali'),
      ('248343',  '248343',  'ankur gupta'),
      ('248248',  '248248',  'devendra joshi'),
      ('248231',  '248231',  'dolly'),
      ('36008',   '36008',   'gulshan'),
      ('248245',  '248245',  'kapil sarreen'),
      ('248347',  '248347',  'krishna kumar'),
      ('248361',  '248361',  'krishna pathak'),
      ('90278',   '90278',   'lalita'),
      ('248237',  '248237',  'pavan kumar'),
      ('248345',  '248345',  'piyush'),
      ('248350',  '248350',  'priya pandey'),
      ('248240',  '248240',  'priyanka kochar'),
      ('248265',  '248265',  'rahul sharma'),
      ('248241',  '248241',  'romil saxena'),
      ('248293',  '248293',  'saksham'),
      ('248346',  '248346',  'satya prakash'),
      ('248306',  '248306',  'shabina'),
      ('248257',  '248257',  'simran khokhar'),
      ('18257',   '18257',   'sneha'),
      ('36007',   '36007',   'tizil paliwal'),
      ('248234',  '248234',  'yash sharma'),
      -- ── SALES GV ─────────────────────────────────────────────
      ('248364',  '248364',  'abhishek'),
      ('8586',    '8586',    'abhishek kr gupta'),
      ('8572',    '8572',    'arun kumar'),
      ('36005',   '36005',   'ashish narang'),
      ('248365',  '248365',  'kanishk'),
      ('260129',  '260129',  'muskan'),
      ('260140',  '260140',  'nishi'),
      ('AA376',   'AA376',   'nitesh kumar'),
      ('8587',    '8587',    'piyush bhatnagar'),
      ('248363',  '248363',  'piyush bhatnagar'),
      ('36006',   '36006',   'preeti'),
      ('8585',    '8585',    'pulin srivastava'),
      ('36009',   '36009',   'vikash kumar'),
      ('8568',    '8568',    'vikrant sharma'),
      ('260107',  '260107',  'vinayak tyagi'),
      -- ── SALES-AK ─────────────────────────────────────────────
      ('8559',    '8559',    'ajay shukla'),
      ('8182',    '8182',    'akash'),
      ('260138',  '260138',  'akash'),
      ('260171',  '260171',  'alok maurya'),
      ('AA029',   'AA029',   'amit kadyan'),
      ('260185',  '260185',  'amit singh'),
      ('8338',    '8338',    'ankush gautam'),
      ('8566',    '8566',    'anubhav'),
      ('AA580',   'AA580',   'aryan tomar'),
      ('260194',  '260194',  'ashish bathra'),
      ('AA049',   'AA049',   'bhavnesh kadyan'),
      ('260200',  '260200',  'deepak singh'),
      ('8576',    '8576',    'dilip'),
      ('260201',  '260201',  'divya sangal'),
      ('8579',    '8579',    'harsh'),
      ('260172',  '260172',  'himani kaushik'),
      ('260992',  '260992',  'himanshi'),
      ('260159',  '260159',  'himanshu gupta'),
      ('8478',    '8478',    'khushboo manhas'),
      ('260166',  '260166',  'khushi'),
      ('260124',  '260124',  'manoj'),
      ('260165',  '260165',  'mayank'),
      ('260152',  '260152',  'mayank singh'),
      ('AA273',   'AA273',   'mukul grover'),
      ('260141',  '260141',  'nagendra kumar'),
      ('290993',  '290993',  'nikita'),
      ('8596',    '8596',    'pankaj ak'),
      ('AA060',   'AA060',   'pawan bhati'),
      ('AA241',   'AA241',   'pawan kadyan'),
      ('260160',  '260160',  'piyush bhardwaj'),
      ('AA038',   'AA038',   'praveen mavi'),
      ('AA9042',  'AA9042',  'rajeev nagar'),
      ('AA030',   'AA030',   'ravish singh'),
      ('260187',  '260187',  'rohan kumar'),
      ('8434',    '8434',    'sachin shukla'),
      ('AA057',   'AA057',   'sahil kasar'),
      ('260151',  '260151',  'saif ali khan salmani'),
      ('260164',  '260164',  'shivani singh'),
      ('260991',  '260991',  'silesh'),
      ('51',      '51',      'sohit kumar'),
      ('260193',  '260193',  'sonia sahini'),
      ('AA059',   'AA059',   'sumit kasana'),
      ('AA040',   'AA040',   'swapndeep'),
      ('260156',  '260156',  'tushar sharma'),
      ('260119',  '260119',  'uday'),
      ('AA275',   'AA275',   'umesh sharma'),
      ('AA6308',  'AA6308',  'vinod kumar singh'),
      ('AA055',   'AA055',   'vinod singh'),
      ('AA050',   'AA050',   'vishesh sharma'),
      ('260186',  '260186',  'yugal pandey'),
      -- ── SALES-GURGAON ────────────────────────────────────────
      ('4800261', '4800261', 'parveen'),
      -- ── SALES-PM ─────────────────────────────────────────────
      ('26115',   '26115',   'aditya nagar'),
      ('260153',  '260153',  'ashok kr pandey'),
      ('AA075',   'AA075',   'prince mavi'),
      ('260180',  '260180',  'shikha'),
      -- ── SALES-RCTM ───────────────────────────────────────────
      ('260179',  '260179',  'akash'),
      ('260202',  '260202',  'aman singh'),
      ('260203',  '260203',  'aryan yadav'),
      ('260197',  '260197',  'ashish kumar'),
      ('AA322',   'AA322',   'bhumi kundu'),
      ('260177',  '260177',  'harsh'),
      ('260175',  '260175',  'kanika'),
      ('260195',  '260195',  'manish kulshrestha'),
      ('8239',    '8239',    'manu pushpam tyagi'),
      ('260204',  '260204',  'mehandi'),
      ('AA282',   'AA282',   'naresh bhatia'),
      ('AA470',   'AA470',   'niraj kumar singh'),
      ('AA315',   'AA315',   'nitesh kr singh'),
      ('AA281',   'AA281',   'raghu nandan chona'),
      ('AA558',   'AA558',   'raj singh'),
      ('260178',  '260178',  'ravi'),
      ('260183',  '260183',  'sharik khan'),
      ('260176',  '260176',  'sonakshi'),
      ('260196',  '260196',  'subhav gautam'),
      ('8315',    '8315',    'suraj sharma'),
      -- ── SALES-SM ─────────────────────────────────────────────
      ('8531',    '8531',    'ashutosh kaushik'),
      ('AA111',   'AA111',   'varun chahal'),
      -- ── SALES-SRV ────────────────────────────────────────────
      ('248354',  '248354',  'abhishek mavi'),
      ('248235',  '248235',  'alance addhana'),
      ('AA084',   'AA084',   'ankit mavi'),
      ('248330',  '248330',  'atif'),
      ('206',     '206',     'awadesh pateriya'),
      ('AA324',   'AA324',   'gautam kumar gupta'),
      ('363',     '363',     'harsh yaduvanshi'),
      ('100',     '100',     'himanshu kumar'),
      ('248353',  '248353',  'karan bandari'),
      ('629',     '629',     'lalit saren'),
      ('AA125',   'AA125',   'manish mavi'),
      ('2004',    '2004',    'manya'),
      ('248300',  '248300',  'mohit'),
      ('8295',    '8295',    'nimish goyal'),
      ('88',      '88',      'rahul solanki'),
      ('AA126',   'AA126',   'saurabh mavi'),
      ('36002',   '36002',   'tahrir'),
      ('8294',    '8294',    'yash singhal'),
      -- ── SALES-VPTM ───────────────────────────────────────────
      ('8334',    '8334',    'aditya badana'),
      ('9305',    '9305',    'akash'),
      ('AA336',   'AA336',   'sidhant sharma'),
      ('AA447',   'AA447',   'vishal pandey'),
      -- ── SECTOR-136 ───────────────────────────────────────────
      ('248222',  '248222',  'ankit'),
      ('248239',  '248239',  'chintu'),
      ('AA6007',  'AA6007',  'vishjeet'),
      -- ── SS TM ────────────────────────────────────────────────
      ('36001',   '36001',   'rajat pansari'),
      ('248366',  '248366',  'rajnish'),
      ('36004',   '36004',   'renu'),
      ('248359',  '248359',  'sachin yadav'),
      ('248307',  '248307',  'sandeep sethi'),
      ('260106',  '260106',  'vishal')
    ) AS m(emp_number, bio_code, ref_name)
  ) LOOP
    v_target_profile_id := NULL;

    -- 1. Try finding target profile by exact employee_number (prefer active, latest)
    SELECT id INTO v_target_profile_id
    FROM public.profiles
    WHERE employee_number = r.emp_number
      AND is_active = true
    ORDER BY created_at DESC NULLS LAST
    LIMIT 1;

    -- 2. If not found, try by exact case-insensitive full name match
    IF v_target_profile_id IS NULL THEN
      SELECT id INTO v_target_profile_id
      FROM public.profiles
      WHERE lower(trim(name)) = lower(trim(r.ref_name))
        AND is_active = true
      ORDER BY created_at DESC NULLS LAST
      LIMIT 1;
    END IF;

    -- 3. If still not found, try fuzzy name matching (only if unassigned)
    IF v_target_profile_id IS NULL THEN
      SELECT id INTO v_target_profile_id
      FROM public.profiles
      WHERE lower(trim(name)) LIKE '%' || lower(trim(r.ref_name)) || '%'
        AND is_active = true
        AND smartoffice_employee_code IS NULL
      ORDER BY created_at DESC NULLS LAST
      LIMIT 1;
    END IF;

    -- If a target profile was located:
    IF v_target_profile_id IS NOT NULL THEN
      -- If any other profile currently holds this biometric code, clear it first
      UPDATE public.profiles
      SET smartoffice_employee_code = NULL
      WHERE smartoffice_employee_code = r.bio_code
        AND id <> v_target_profile_id;

      -- Assign the biometric code to the confirmed profile
      UPDATE public.profiles
      SET smartoffice_employee_code = r.bio_code,
          smartoffice_synced_at = now()
      WHERE id = v_target_profile_id;
    END IF;

  END LOOP;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 4: BACKFILL USER_ID IN DEVICE LOGS
-- ────────────────────────────────────────────────────────────────────────────

UPDATE public.smartoffice_device_logs dl
SET user_id = p.id
FROM public.profiles p
WHERE (p.smartoffice_employee_code = dl.employee_code OR p.employee_number = dl.employee_code)
  AND p.is_active = true
  AND dl.user_id IS NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 5: SYNC ATTENDANCE FROM VERIFIED BIOMETRIC PUNCHES
-- Safely parses text/date/timestamptz punch log formats
-- ────────────────────────────────────────────────────────────────────────────

WITH parsed_logs AS (
  SELECT
    log.user_id,
    coalesce(
      NULLIF(log.log_date_only::text, '')::date,
      CASE 
        WHEN NULLIF(trim(log.log_datetime), '') IS NOT NULL AND length(trim(log.log_datetime)) >= 10
          THEN (SUBSTRING(trim(log.log_datetime) FROM 1 FOR 10))::date
        ELSE NULL
      END
    ) AS att_date,
    CASE
      WHEN NULLIF(trim(log.log_datetime), '') IS NOT NULL THEN
        CASE 
          WHEN trim(log.log_datetime) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}' 
            THEN (trim(log.log_datetime) || '+05:30')::timestamptz
          WHEN trim(log.log_datetime) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' 
            THEN trim(log.log_datetime)::timestamptz
          ELSE (trim(log.log_datetime) || '+05:30')::timestamptz
        END
      WHEN log.log_date_only IS NOT NULL AND log.log_time IS NOT NULL THEN
        (log.log_date_only::text || ' ' || log.log_time::text || '+05:30')::timestamptz
      ELSE NULL
    END AS punch_ts
  FROM public.smartoffice_device_logs log
  WHERE log.user_id IS NOT NULL
),
daily_biometric AS (
  SELECT
    user_id,
    att_date,
    min(punch_ts) AS first_punch,
    max(punch_ts) AS last_punch,
    count(*)::int AS punch_cnt
  FROM parsed_logs
  WHERE att_date IS NOT NULL AND punch_ts IS NOT NULL
  GROUP BY user_id, att_date
)
INSERT INTO public.attendance_logs(
  user_id,
  office_id,
  date,
  checkin_time,
  checkin_source,
  checkout_time,
  checkout_source,
  status,
  attendance_status,
  day_status,
  attendance_type,
  smartoffice_imported,
  biometric_first_punch,
  biometric_last_punch,
  biometric_punch_count,
  work_hours,
  updated_at
)
SELECT
  d.user_id,
  p.office_id,
  d.att_date,
  d.first_punch,
  'BIOMETRIC',
  CASE
    WHEN d.att_date < (now() AT TIME ZONE 'Asia/Kolkata')::date AND d.punch_cnt >= 2 AND d.last_punch > d.first_punch
      THEN d.last_punch
    WHEN d.att_date < (now() AT TIME ZONE 'Asia/Kolkata')::date
      THEN (d.att_date::text || ' 23:59:00+05:30')::timestamptz
    ELSE NULL
  END,
  CASE WHEN d.att_date < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN 'SYSTEM' ELSE NULL END,
  CASE WHEN d.att_date < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN 'AUTO_CHECKED_OUT' ELSE 'CHECKED_IN' END,
  'PRESENT',
  'P',
  'BIOMETRIC',
  true,
  d.first_punch,
  d.last_punch,
  d.punch_cnt,
  CASE
    WHEN d.att_date < (now() AT TIME ZONE 'Asia/Kolkata')::date AND d.punch_cnt >= 2 AND d.last_punch > d.first_punch
      THEN round((extract(epoch FROM (d.last_punch - d.first_punch)) / 3600)::numeric, 2)
    ELSE NULL
  END,
  now()
FROM daily_biometric d
JOIN public.profiles p ON p.id = d.user_id
ON CONFLICT (user_id, date) DO UPDATE
SET
  checkin_time = EXCLUDED.checkin_time,
  checkin_source = 'BIOMETRIC',
  smartoffice_imported = true,
  biometric_first_punch = EXCLUDED.biometric_first_punch,
  biometric_last_punch = EXCLUDED.biometric_last_punch,
  biometric_punch_count = EXCLUDED.biometric_punch_count,
  attendance_status = coalesce(attendance_logs.attendance_status, 'PRESENT'),
  day_status = coalesce(attendance_logs.day_status, 'P'),
  status = CASE
    WHEN attendance_logs.checkout_time IS NULL AND EXCLUDED.date = (now() AT TIME ZONE 'Asia/Kolkata')::date THEN 'CHECKED_IN'
    ELSE attendance_logs.status
  END,
  updated_at = now();

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 6: SCHEDULE CRON JOB FOR AUTOMATED SYNC EVERY MINUTE
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_publishable_key text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      SELECT decrypted_secret INTO v_publishable_key
      FROM vault.decrypted_secrets
      WHERE name = 'SUPABASE_ANON_KEY_FOR_BIOMETRIC_CRON'
      LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      v_publishable_key := NULL;
    END;

    v_publishable_key := coalesce(
      nullif(trim(v_publishable_key), ''),
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImppZGJyd3B6ZnBidXJzaWh0dnBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0MTg3OTgsImV4cCI6MjA4OTk5NDc5OH0.P-j0skFmSd-WtqV5-wi51ArxAwE4ZBt3ctYBtY-mj-0'
    );

    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname IN (
      'biometric-attendance-sync-every-2-minutes',
      'biometric-attendance-sync-every-minute'
    );

    PERFORM cron.schedule(
      'biometric-attendance-sync-every-minute',
      '* * * * *',
      format(
        $job$
          select net.http_post(
            url := 'https://jidbrwpzfpbursihtvpg.supabase.co/functions/v1/biometric-attendance-sync',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'Authorization', 'Bearer %s',
              'apikey', '%s',
              'x-biometric-sync-source', 'pg_cron'
            ),
            body := '{}'::jsonb,
            timeout_milliseconds := 55000
          );
        $job$,
        v_publishable_key,
        v_publishable_key
      )
    );
  END IF;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- SECTION 7: VERIFICATION QUERY
-- ────────────────────────────────────────────────────────────────────────────

SELECT
  'PROFILES_SUMMARY' AS metric,
  COUNT(*) AS total_active_profiles,
  COUNT(*) FILTER (WHERE smartoffice_employee_code IS NOT NULL) AS linked_to_biometric,
  COUNT(*) FILTER (WHERE smartoffice_employee_code IS NULL) AS unlinked_profiles
FROM public.profiles
WHERE is_active = true

UNION ALL

SELECT
  'ATTENDANCE_LOGS_TODAY' AS metric,
  COUNT(*) AS total_attendance,
  COUNT(*) FILTER (WHERE checkin_source = 'BIOMETRIC') AS biometric_checkins,
  COUNT(*) FILTER (WHERE status = 'CHECKED_IN') AS currently_checked_in
FROM public.attendance_logs
WHERE date = (now() AT TIME ZONE 'Asia/Kolkata')::date;

NOTIFY pgrst, 'reload schema';
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           