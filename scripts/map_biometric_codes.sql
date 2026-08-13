-- ============================================================
-- map_biometric_codes.sql
-- Links every employee code from Monthly_InOutReport (5)(1).xls
-- to the matching HRMS profile via employee_number.
--
-- HOW TO RUN:
--   1. Open Supabase → SQL Editor
--   2. Paste & run the PREVIEW block first (SELECT only)
--   3. If preview looks correct, run the UPDATE + BACKFILL block
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- STEP 1 — PREVIEW  (run this first, check output)
-- Shows what will be linked before you commit anything
-- ────────────────────────────────────────────────────────────
SELECT
  p.id,
  p.name,
  p.employee_number,
  p.smartoffice_employee_code AS current_code,
  m.bio_code                  AS new_code,
  CASE
    WHEN p.smartoffice_employee_code IS NULL THEN 'Will SET'
    WHEN p.smartoffice_employee_code = m.bio_code THEN 'Already linked ✓'
    ELSE 'Will OVERWRITE (' || p.smartoffice_employee_code || ')'
  END AS action
FROM profiles p
JOIN (VALUES
  -- (employee_number, biometric_code, display_name_for_reference)
  -- ── ACCOUNTS COMMERCIAL ──────────────────────────────────
  ('8414',    '8414',    'Abhishek Tripathi'),
  ('8241',    '8241',    'Aditya Kaushik'),
  ('AA224',   'AA224',   'J.P.'),
  ('AA020',   'AA020',   'Kailash Chand'),
  ('8229',    '8229',    'Manoj Madan'),
  ('248208',  '248208',  'Mithilesh Kumar Jha'),
  ('8381',    '8381',    'Nishu Kumar'),
  ('260101',  '260101',  'Prateek Sharma'),
  ('AA012',   'AA012',   'Rajpoot P'),
  ('AA017',   'AA017',   'Sanjay Kumar Bhati'),
  ('8135',    '8135',    'Sanjeev Kr. Thakur'),
  ('AA014',   'AA014',   'Sumit Bansal'),
  ('AA019',   'AA019',   'Vikas Bhati'),
  -- ── ADMIN & BACKOFFICE ───────────────────────────────────
  ('AA193',   'AA193',   'Kamesh Badana'),
  ('AA227',   'AA227',   'Krishna Kumar'),
  ('AA018',   'AA018',   'Manish Tomar'),
  -- ── CASUAL ───────────────────────────────────────────────
  ('8347',    '8347',    'Aditya'),
  ('AA023',   'AA023',   'Basant'),
  ('8235',    '8235',    'Brijesh Basement'),
  ('260118',  '260118',  'Harish'),
  ('779',     '779',     'Jeet'),
  ('800045',  '800045',  'Kamal Singh'),
  ('260148',  '260148',  'Minam'),
  ('AA411',   'AA411',   'Pankaj Kumar'),
  ('AA024',   'AA024',   'Sajid'),
  ('AA025',   'AA025',   'Santosh'),
  ('905',     '905',     'Shivam'),
  ('AA122',   'AA122',   'Sonu'),
  ('AA026',   'AA026',   'Uttam'),
  ('AA022',   'AA022',   'Veeresh Yadav'),
  ('8327',    '8327',    'Vikash'),
  ('8543',    '8543',    'Vikash GN'),
  -- ── HR ───────────────────────────────────────────────────
  ('AA006',   'AA006',   'Ankur'),
  ('8485',    '8485',    'Anshul Sharma'),
  ('40902',   '40902',   'Deepti'),
  ('248360',  '248360',  'Isha Pandey'),
  ('119',     '119',     'Ishika'),
  ('AA145',   'AA145',   'Navneet Kumar'),
  ('8479',    '8479',    'Nishita Atras'),
  ('1809',    '1809',    'Vaishali'),
  ('AA004',   'AA004',   'Vinita Yadav'),
  -- ── MANAGEMENT ───────────────────────────────────────────
  ('AA002',   'AA002',   'Ankush Kadyan'),
  ('AA001',   'AA001',   'Gaurav Mavi'),
  ('AA110',   'AA110',   'Sachin Mavi'),
  ('1111',    '1111',    'UV'),
  -- ── MARKETING ────────────────────────────────────────────
  ('8519',    '8519',    'Anant'),
  ('260189',  '260189',  'Ayesha Tomar'),
  ('8374',    '8374',    'Balraj Singh'),
  ('248335',  '248335',  'Deepti Dhingra'),
  ('8540',    '8540',    'Devansh Bansal'),
  ('260188',  '260188',  'Devanshi Rathi'),
  ('AA016',   'AA016',   'Komal Sharma'),
  ('8356',    '8356',    'Madhav Vij'),
  ('8464',    '8464',    'Megha Chanden'),
  ('8441',    '8441',    'Ritesh'),
  ('8138',    '8138',    'Sagar Singh'),
  ('8475',    '8475',    'Satrajeet Neogi'),
  ('8561',    '8561',    'Shashank Kumar'),
  ('260128',  '260128',  'Suraj'),
  ('8346',    '8346',    'Vishal Joshi'),
  -- ── ROMIL TM ─────────────────────────────────────────────
  ('248326',  '248326',  'Abhishek Chaudhary'),
  ('93450',   '93450',   'Anjali'),
  ('248343',  '248343',  'Ankur Gupta'),
  ('248248',  '248248',  'Devendra Joshi'),
  ('248231',  '248231',  'Dolly'),
  ('36008',   '36008',   'Gulshan'),
  ('248245',  '248245',  'Kapil Sarreen'),
  ('248347',  '248347',  'Krishna Kumar'),
  ('248361',  '248361',  'Krishna Pathak'),
  ('90278',   '90278',   'Lalita'),
  ('248237',  '248237',  'Pavan Kumar'),
  ('248345',  '248345',  'Piyush'),
  ('248350',  '248350',  'Priya Pandey'),
  ('248240',  '248240',  'Priyanka Kochar'),
  ('248265',  '248265',  'Rahul Sharma'),
  ('248241',  '248241',  'Romil Saxena'),
  ('248293',  '248293',  'Saksham'),
  ('248346',  '248346',  'Satya Prakash'),
  ('248306',  '248306',  'Shabina'),
  ('248257',  '248257',  'Simran Khokhar'),
  ('18257',   '18257',   'Sneha'),
  ('36007',   '36007',   'Tizil Paliwal'),
  ('248234',  '248234',  'Yash Sharma'),
  -- ── SALES GV ─────────────────────────────────────────────
  ('248364',  '248364',  'Abhishek'),
  ('8586',    '8586',    'Abhishek Kr. Gupta'),
  ('8572',    '8572',    'Arun Kumar'),
  ('36005',   '36005',   'Ashish Narang'),
  ('248365',  '248365',  'Kanishk'),
  ('260129',  '260129',  'Muskan'),
  ('260140',  '260140',  'Nishi'),
  ('AA376',   'AA376',   'Nitesh Kumar'),
  ('8587',    '8587',    'Piyush Bhatnagar'),
  ('248363',  '248363',  'Piyush Bhatnagar 2'),
  ('36006',   '36006',   'Preeti'),
  ('8585',    '8585',    'Pulin Srivastava'),
  ('36009',   '36009',   'Vikash Kumar'),
  ('8568',    '8568',    'Vikrant Sharma'),
  ('260107',  '260107',  'Vinayak Tyagi'),
  -- ── SALES-AK ─────────────────────────────────────────────
  ('8559',    '8559',    'Ajay Shukla'),
  ('8182',    '8182',    'Akash'),
  ('260138',  '260138',  'Akash 2'),
  ('260171',  '260171',  'Alok Maurya'),
  ('AA029',   'AA029',   'Amit Kadyan'),
  ('260185',  '260185',  'Amit Singh'),
  ('8338',    '8338',    'Ankush Gautam'),
  ('8566',    '8566',    'Anubhav'),
  ('AA580',   'AA580',   'Aryan Tomar'),
  ('260194',  '260194',  'Ashish Bathra'),
  ('AA049',   'AA049',   'Bhavnesh Kadyan'),
  ('260200',  '260200',  'Deepak Singh'),
  ('8576',    '8576',    'Dilip'),
  ('260201',  '260201',  'Divya Sangal'),
  ('8579',    '8579',    'Harsh'),
  ('260172',  '260172',  'Himani Kaushik'),
  ('260992',  '260992',  'Himanshi'),
  ('260159',  '260159',  'Himanshu Gupta'),
  ('8478',    '8478',    'Khushboo Manhas'),
  ('260166',  '260166',  'Khushi'),
  ('260124',  '260124',  'Manoj'),
  ('260165',  '260165',  'Mayank'),
  ('260152',  '260152',  'Mayank Singh'),
  ('AA273',   'AA273',   'Mukul Grover'),
  ('260141',  '260141',  'Nagendra Kumar'),
  ('290993',  '290993',  'Nikita'),
  ('8596',    '8596',    'Pankaj AK'),
  ('AA060',   'AA060',   'Pawan Bhati'),
  ('AA241',   'AA241',   'Pawan Kadyan'),
  ('260160',  '260160',  'Piyush Bhardwaj'),
  ('AA038',   'AA038',   'Praveen Mavi'),
  ('AA9042',  'AA9042',  'Rajeev Nagar'),
  ('AA030',   'AA030',   'Ravish Singh'),
  ('260187',  '260187',  'Rohan Kumar'),
  ('8434',    '8434',    'Sachin Shukla'),
  ('AA057',   'AA057',   'Sahil Kasar'),
  ('260151',  '260151',  'Saif Ali Khan Salmani'),
  ('260164',  '260164',  'Shivani Singh'),
  ('260991',  '260991',  'Silesh'),
  ('51',      '51',      'Sohit Kumar'),
  ('260193',  '260193',  'Sonia Sahini'),
  ('AA059',   'AA059',   'Sumit Kasana'),
  ('AA040',   'AA040',   'Swapndeep'),
  ('260156',  '260156',  'Tushar Sharma'),
  ('260119',  '260119',  'Uday'),
  ('AA275',   'AA275',   'Umesh Sharma'),
  ('AA6308',  'AA6308',  'Vinod Kumar Singh'),
  ('AA055',   'AA055',   'Vinod Singh'),
  ('AA050',   'AA050',   'Vishesh Sharma'),
  ('260186',  '260186',  'Yugal Pandey'),
  -- ── SALES-GURGAON ────────────────────────────────────────
  ('4800261', '4800261', 'Parveen'),
  -- ── SALES-PM ─────────────────────────────────────────────
  ('26115',   '26115',   'Aditya Nagar'),
  ('260153',  '260153',  'Ashok Kr. Pandey'),
  ('AA075',   'AA075',   'Prince Mavi'),
  ('260180',  '260180',  'Shikha'),
  -- ── SALES-RCTM ───────────────────────────────────────────
  ('260179',  '260179',  'Akash'),
  ('260202',  '260202',  'Aman Singh'),
  ('260203',  '260203',  'Aryan Yadav'),
  ('260197',  '260197',  'Ashish Kumar'),
  ('AA322',   'AA322',   'Bhumi Kundu'),
  ('260177',  '260177',  'Harsh'),
  ('260175',  '260175',  'Kanika'),
  ('260195',  '260195',  'Manish Kulshrestha'),
  ('8239',    '8239',    'Manu Pushpam Tyagi'),
  ('260204',  '260204',  'Mehandi'),
  ('AA282',   'AA282',   'Naresh Bhatia'),
  ('AA470',   'AA470',   'Niraj Kumar Singh'),
  ('AA315',   'AA315',   'Nitesh Kr. Singh'),
  ('AA281',   'AA281',   'Raghu Nandan Chona'),
  ('AA558',   'AA558',   'Raj Singh'),
  ('260178',  '260178',  'Ravi'),
  ('260183',  '260183',  'Sharik Khan'),
  ('260176',  '260176',  'Sonakshi'),
  ('260196',  '260196',  'Subhav Gautam'),
  ('8315',    '8315',    'Suraj Sharma'),
  -- ── SALES-SM ─────────────────────────────────────────────
  ('8531',    '8531',    'Ashutosh Kaushik'),
  ('AA111',   'AA111',   'Varun Chahal'),
  -- ── SALES-SRV ────────────────────────────────────────────
  ('248354',  '248354',  'Abhishek Mavi'),
  ('248235',  '248235',  'Alance Addhana'),
  ('AA084',   'AA084',   'Ankit Mavi'),
  ('248330',  '248330',  'Atif'),
  ('206',     '206',     'Awadesh Pateriya'),
  ('AA324',   'AA324',   'Gautam Kumar Gupta'),
  ('363',     '363',     'Harsh Yaduvanshi'),
  ('100',     '100',     'Himanshu Kumar'),
  ('248353',  '248353',  'Karan Bandari'),
  ('629',     '629',     'Lalit Saren'),
  ('AA125',   'AA125',   'Manish Mavi'),
  ('2004',    '2004',    'Manya'),
  ('248300',  '248300',  'Mohit'),
  ('8295',    '8295',    'Nimish Goyal'),
  ('88',      '88',      'Rahul Solanki'),
  ('AA126',   'AA126',   'Saurabh Mavi'),
  ('36002',   '36002',   'Tahrir'),
  ('8294',    '8294',    'Yash Singhal'),
  -- ── SALES-VPTM ───────────────────────────────────────────
  ('8334',    '8334',    'Aditya Badana'),
  ('9305',    '9305',    'Akash'),
  ('AA336',   'AA336',   'Sidhant Sharma'),
  ('AA447',   'AA447',   'Vishal Pandey'),
  -- ── SECTOR-136 ───────────────────────────────────────────
  ('248222',  '248222',  'Ankit'),
  ('248239',  '248239',  'Chintu'),
  ('AA6007',  'AA6007',  'Vishjeet'),
  -- ── SS TM ────────────────────────────────────────────────
  ('36001',   '36001',   'Rajat Pansari'),
  ('248366',  '248366',  'Rajnish'),
  ('36004',   '36004',   'Renu'),
  ('248359',  '248359',  'Sachin Yadav'),
  ('248307',  '248307',  'Sandeep Sethi'),
  ('260106',  '260106',  'Vishal')
) AS m(emp_number, bio_code, ref_name)
  ON p.employee_number = m.emp_number
WHERE p.is_active = true
ORDER BY
  CASE m.action
    WHEN 'Will OVERWRITE' THEN 1
    WHEN 'Will SET' THEN 2
    ELSE 3
  END,
  p.name;


-- ────────────────────────────────────────────────────────────
-- STEP 2 — APPLY UPDATES (PASS 1: by employee_number)
-- Run only after verifying the preview above looks correct.
-- Safe: skips profiles already correctly linked.
-- ────────────────────────────────────────────────────────────

-- 2a. Update profiles.smartoffice_employee_code by employee_number
UPDATE profiles p
SET
  smartoffice_employee_code = m.bio_code,
  smartoffice_synced_at     = now()
FROM (VALUES
  ('8414',    '8414'),
  ('8241',    '8241'),
  ('AA224',   'AA224'),
  ('AA020',   'AA020'),
  ('8229',    '8229'),
  ('248208',  '248208'),
  ('8381',    '8381'),
  ('260101',  '260101'),
  ('AA012',   'AA012'),
  ('AA017',   'AA017'),
  ('8135',    '8135'),
  ('AA014',   'AA014'),
  ('AA019',   'AA019'),
  ('AA193',   'AA193'),
  ('AA227',   'AA227'),
  ('AA018',   'AA018'),
  ('8347',    '8347'),
  ('AA023',   'AA023'),
  ('8235',    '8235'),
  ('260118',  '260118'),
  ('779',     '779'),
  ('800045',  '800045'),
  ('260148',  '260148'),
  ('AA411',   'AA411'),
  ('AA024',   'AA024'),
  ('AA025',   'AA025'),
  ('905',     '905'),
  ('AA122',   'AA122'),
  ('AA026',   'AA026'),
  ('AA022',   'AA022'),
  ('8327',    '8327'),
  ('8543',    '8543'),
  ('AA006',   'AA006'),
  ('8485',    '8485'),
  ('40902',   '40902'),
  ('248360',  '248360'),
  ('119',     '119'),
  ('AA145',   'AA145'),
  ('8479',    '8479'),
  ('1809',    '1809'),
  ('AA004',   'AA004'),
  ('AA002',   'AA002'),
  ('AA001',   'AA001'),
  ('AA110',   'AA110'),
  ('1111',    '1111'),
  ('8519',    '8519'),
  ('260189',  '260189'),
  ('8374',    '8374'),
  ('248335',  '248335'),
  ('8540',    '8540'),
  ('260188',  '260188'),
  ('AA016',   'AA016'),
  ('8356',    '8356'),
  ('8464',    '8464'),
  ('8441',    '8441'),
  ('8138',    '8138'),
  ('8475',    '8475'),
  ('8561',    '8561'),
  ('260128',  '260128'),
  ('8346',    '8346'),
  ('248326',  '248326'),
  ('93450',   '93450'),
  ('248343',  '248343'),
  ('248248',  '248248'),
  ('248231',  '248231'),
  ('36008',   '36008'),
  ('248245',  '248245'),
  ('248347',  '248347'),
  ('248361',  '248361'),
  ('90278',   '90278'),
  ('248237',  '248237'),
  ('248345',  '248345'),
  ('248350',  '248350'),
  ('248240',  '248240'),
  ('248265',  '248265'),
  ('248241',  '248241'),
  ('248293',  '248293'),
  ('248346',  '248346'),
  ('248306',  '248306'),
  ('248257',  '248257'),
  ('18257',   '18257'),
  ('36007',   '36007'),
  ('248234',  '248234'),
  ('248364',  '248364'),
  ('8586',    '8586'),
  ('8572',    '8572'),
  ('36005',   '36005'),
  ('248365',  '248365'),
  ('260129',  '260129'),
  ('260140',  '260140'),
  ('AA376',   'AA376'),
  ('8587',    '8587'),
  ('248363',  '248363'),
  ('36006',   '36006'),
  ('8585',    '8585'),
  ('36009',   '36009'),
  ('8568',    '8568'),
  ('260107',  '260107'),
  ('8559',    '8559'),
  ('8182',    '8182'),
  ('260138',  '260138'),
  ('260171',  '260171'),
  ('AA029',   'AA029'),
  ('260185',  '260185'),
  ('8338',    '8338'),
  ('8566',    '8566'),
  ('AA580',   'AA580'),
  ('260194',  '260194'),
  ('AA049',   'AA049'),
  ('260200',  '260200'),
  ('8576',    '8576'),
  ('260201',  '260201'),
  ('8579',    '8579'),
  ('260172',  '260172'),
  ('260992',  '260992'),
  ('260159',  '260159'),
  ('8478',    '8478'),
  ('260166',  '260166'),
  ('260124',  '260124'),
  ('260165',  '260165'),
  ('260152',  '260152'),
  ('AA273',   'AA273'),
  ('260141',  '260141'),
  ('290993',  '290993'),
  ('8596',    '8596'),
  ('AA060',   'AA060'),
  ('AA241',   'AA241'),
  ('260160',  '260160'),
  ('AA038',   'AA038'),
  ('AA9042',  'AA9042'),
  ('AA030',   'AA030'),
  ('260187',  '260187'),
  ('8434',    '8434'),
  ('AA057',   'AA057'),
  ('260151',  '260151'),
  ('260164',  '260164'),
  ('260991',  '260991'),
  ('51',      '51'),
  ('260193',  '260193'),
  ('AA059',   'AA059'),
  ('AA040',   'AA040'),
  ('260156',  '260156'),
  ('260119',  '260119'),
  ('AA275',   'AA275'),
  ('AA6308',  'AA6308'),
  ('AA055',   'AA055'),
  ('AA050',   'AA050'),
  ('260186',  '260186'),
  ('4800261', '4800261'),
  ('26115',   '26115'),
  ('260153',  '260153'),
  ('AA075',   'AA075'),
  ('260180',  '260180'),
  ('260179',  '260179'),
  ('260202',  '260202'),
  ('260203',  '260203'),
  ('260197',  '260197'),
  ('AA322',   'AA322'),
  ('260177',  '260177'),
  ('260175',  '260175'),
  ('260195',  '260195'),
  ('8239',    '8239'),
  ('260204',  '260204'),
  ('AA282',   'AA282'),
  ('AA470',   'AA470'),
  ('AA315',   'AA315'),
  ('AA281',   'AA281'),
  ('AA558',   'AA558'),
  ('260178',  '260178'),
  ('260183',  '260183'),
  ('260176',  '260176'),
  ('260196',  '260196'),
  ('8315',    '8315'),
  ('8531',    '8531'),
  ('AA111',   'AA111'),
  ('248354',  '248354'),
  ('248235',  '248235'),
  ('AA084',   'AA084'),
  ('248330',  '248330'),
  ('206',     '206'),
  ('AA324',   'AA324'),
  ('363',     '363'),
  ('100',     '100'),
  ('248353',  '248353'),
  ('629',     '629'),
  ('AA125',   'AA125'),
  ('2004',    '2004'),
  ('248300',  '248300'),
  ('8295',    '8295'),
  ('88',      '88'),
  ('AA126',   'AA126'),
  ('36002',   '36002'),
  ('8294',    '8294'),
  ('8334',    '8334'),
  ('9305',    '9305'),
  ('AA336',   'AA336'),
  ('AA447',   'AA447'),
  ('248222',  '248222'),
  ('248239',  '248239'),
  ('AA6007',  'AA6007'),
  ('36001',   '36001'),
  ('248366',  '248366'),
  ('36004',   '36004'),
  ('248359',  '248359'),
  ('248307',  '248307'),
  ('260106',  '260106')
) AS m(emp_number, bio_code)
WHERE p.employee_number = m.emp_number
  AND p.is_active = true
  AND (
    p.smartoffice_employee_code IS NULL
    OR p.smartoffice_employee_code <> m.bio_code
  );


-- ────────────────────────────────────────────────────────────
-- STEP 2b — APPLY UPDATES (PASS 2: by name / fuzzy match)
-- Catches profiles whose employee_number is NULL or doesn't
-- match the biometric code, but whose name matches.
-- Uses a CTE to only consider codes NOT already mapped to
-- another profile, preventing double-mapping.
-- ────────────────────────────────────────────────────────────

WITH name_map AS (
  SELECT * FROM (VALUES
    -- (bio_code, report_name)
    -- We match LOWER(p.name) against these using LIKE patterns
    
    -- ── ACCOUNTS COMMERCIAL ──────────────────────────────────
    ('8414',   'abhishek tripathi'),
    ('8241',   'aditya kaushik'),
    ('AA224',  'jp'),
    ('AA020',  'kailash chand'),
    ('8229',   'manoj madan'),
    ('248208', 'mithilesh kumar jha'),
    ('8381',   'nishu kumar'),
    ('260101', 'prateek sharma'),
    ('AA012',  'rajpoot p'),
    ('AA017',  'sanjay kumar bhati'),
    ('8135',   'sanjeev kr thakur'),
    ('AA014',  'sumit bansal'),
    ('AA019',  'vikas bhati'),
    -- ── ADMIN & BACKOFFICE ───────────────────────────────────
    ('AA193',  'kamesh badana'),
    ('AA227',  'krishna kumar'),
    ('AA018',  'manish tomar'),
    -- ── CASUAL ───────────────────────────────────────────────
    ('8347',   'aditya'),
    ('AA023',  'basant'),
    ('8235',   'brijesh basement'),
    ('260118', 'harish'),
    ('779',    'jeet'),
    ('800045', 'kamal singh'),
    ('260148', 'minam'),
    ('AA411',  'pankaj kumar'),
    ('AA024',  'sajid'),
    ('AA025',  'santosh'),
    ('905',    'shivam'),
    ('AA122',  'sonu'),
    ('AA026',  'uttam'),
    ('AA022',  'veeresh yadav'),
    ('8327',   'vikash'),
    ('8543',   'vikash gn'),
    -- ── HR ───────────────────────────────────────────────────
    ('AA006',  'ankur'),
    ('8485',   'anshul sharma'),
    ('40902',  'deepti'),
    ('248360', 'isha pandey'),
    ('119',    'ishika'),
    ('AA145',  'navneet kumar'),
    ('8479',   'nishita atras'),
    ('1809',   'vaishali'),
    ('AA004',  'vinita yadav'),
    -- ── MANAGEMENT ───────────────────────────────────────────
    ('AA002',  'ankush kadyan'),
    ('AA001',  'gaurav mavi'),
    ('AA110',  'sachin mavi'),
    ('1111',   'uv'),
    -- ── MARKETING ────────────────────────────────────────────
    ('8519',   'anant'),
    ('260189', 'ayesha tomar'),
    ('8374',   'balraj singh'),
    ('248335', 'deepti dhingra'),
    ('8540',   'devansh bansal'),
    ('260188', 'devanshi rathi'),
    ('AA016',  'komal sharma'),
    ('8356',   'madhav vij'),
    ('8464',   'megha chanden'),
    ('8441',   'ritesh'),
    ('8138',   'sagar singh'),
    ('8475',   'satrajeet neogi'),
    ('8561',   'shashank kumar'),
    ('260128', 'suraj'),
    ('8346',   'vishal joshi'),
    -- ── ROMIL TM ─────────────────────────────────────────────
    ('248326', 'abhishek chaudhary'),
    ('93450',  'anjali'),
    ('248343', 'ankur gupta'),
    ('248248', 'devendra joshi'),
    ('248231', 'dolly'),
    ('36008',  'gulshan'),
    ('248245', 'kapil sarreen'),
    ('248347', 'krishna kumar'),
    ('248361', 'krishna pathak'),
    ('90278',  'lalita'),
    ('248237', 'pavan kumar'),
    ('248345', 'piyush'),
    ('248350', 'priya pandey'),
    ('248240', 'priyanka kochar'),
    ('248265', 'rahul sharma'),
    ('248241', 'romil saxena'),
    ('248293', 'saksham'),
    ('248346', 'satya prakash'),
    ('248306', 'shabina'),
    ('248257', 'simran khokhar'),
    ('18257',  'sneha'),
    ('36007',  'tizil paliwal'),
    ('248234', 'yash sharma'),
    -- ── SALES GV ─────────────────────────────────────────────
    ('248364', 'abhishek'),
    ('8586',   'abhishek kr gupta'),
    ('8572',   'arun kumar'),
    ('36005',  'ashish narang'),
    ('248365', 'kanishk'),
    ('260129', 'muskan'),
    ('260140', 'nishi'),
    ('AA376',  'nitesh kumar'),
    ('8587',   'piyush bhatnagar'),
    ('248363', 'piyush bhatnagar'),
    ('36006',  'preeti'),
    ('8585',   'pulin srivastava'),
    ('36009',  'vikash kumar'),
    ('8568',   'vikrant sharma'),
    ('260107', 'vinayak tyagi'),
    -- ── SALES-AK ─────────────────────────────────────────────
    ('8559',   'ajay shukla'),
    ('8182',   'akash'),
    ('260138', 'akash'),
    ('260171', 'alok maurya'),
    ('AA029',  'amit kadyan'),
    ('260185', 'amit singh'),
    ('8338',   'ankush gautam'),
    ('8566',   'anubhav'),
    ('AA580',  'aryan tomar'),
    ('260194', 'ashish bathra'),
    ('AA049',  'bhavnesh kadyan'),
    ('260200', 'deepak singh'),
    ('8576',   'dilip'),
    ('260201', 'divya sangal'),
    ('8579',   'harsh'),
    ('260172', 'himani kaushik'),
    ('260992', 'himanshi'),
    ('260159', 'himanshu gupta'),
    ('8478',   'khushboo manhas'),
    ('260166', 'khushi'),
    ('260124', 'manoj'),
    ('260165', 'mayank'),
    ('260152', 'mayank singh'),
    ('AA273',  'mukul grover'),
    ('260141', 'nagendra kumar'),
    ('290993', 'nikita'),
    ('8596',   'pankaj ak'),
    ('AA060',  'pawan bhati'),
    ('AA241',  'pawan kadyan'),
    ('260160', 'piyush bhardwaj'),
    ('AA038',  'praveen mavi'),
    ('AA9042', 'rajeev nagar'),
    ('AA030',  'ravish singh'),
    ('260187', 'rohan kumar'),
    ('8434',   'sachin shukla'),
    ('AA057',  'sahil kasar'),
    ('260151', 'saif ali khan salmani'),
    ('260164', 'shivani singh'),
    ('260991', 'silesh'),
    ('51',     'sohit kumar'),
    ('260193', 'sonia sahini'),
    ('AA059',  'sumit kasana'),
    ('AA040',  'swapndeep'),
    ('260156', 'tushar sharma'),
    ('260119', 'uday'),
    ('AA275',  'umesh sharma'),
    ('AA6308', 'vinod kumar singh'),
    ('AA055',  'vinod singh'),
    ('AA050',  'vishesh sharma'),
    ('260186', 'yugal pandey'),
    -- ── SALES-GURGAON ────────────────────────────────────────
    ('4800261','parveen'),
    -- ── SALES-PM ─────────────────────────────────────────────
    ('26115',  'aditya nagar'),
    ('260153', 'ashok kr pandey'),
    ('AA075',  'prince mavi'),
    ('260180', 'shikha'),
    -- ── SALES-RCTM ───────────────────────────────────────────
    ('260179', 'akash'),
    ('260202', 'aman singh'),
    ('260203', 'aryan yadav'),
    ('260197', 'ashish kumar'),
    ('AA322',  'bhumi kundu'),
    ('260177', 'harsh'),
    ('260175', 'kanika'),
    ('260195', 'manish kulshrestha'),
    ('8239',   'manu pushpam tyagi'),
    ('260204', 'mehandi'),
    ('AA282',  'naresh bhatia'),
    ('AA470',  'niraj kumar singh'),
    ('AA315',  'nitesh kr singh'),
    ('AA281',  'raghu nandan chona'),
    ('AA558',  'raj singh'),
    ('260178', 'ravi'),
    ('260183', 'sharik khan'),
    ('260176', 'sonakshi'),
    ('260196', 'subhav gautam'),
    ('8315',   'suraj sharma'),
    -- ── SALES-SM ─────────────────────────────────────────────
    ('8531',   'ashutosh kaushik'),
    ('AA111',  'varun chahal'),
    -- ── SALES-SRV ────────────────────────────────────────────
    ('248354', 'abhishek mavi'),
    ('248235', 'alance addhana'),
    ('AA084',  'ankit mavi'),
    ('248330', 'atif'),
    ('206',    'awadesh pateriya'),
    ('AA324',  'gautam kumar gupta'),
    ('363',    'harsh yaduvanshi'),
    ('100',    'himanshu kumar'),
    ('248353', 'karan bandari'),
    ('629',    'lalit saren'),
    ('AA125',  'manish mavi'),
    ('2004',   'manya'),
    ('248300', 'mohit'),
    ('8295',   'nimish goyal'),
    ('88',     'rahul solanki'),
    ('AA126',  'saurabh mavi'),
    ('36002',  'tahrir'),
    ('8294',   'yash singhal'),
    -- ── SALES-VPTM ───────────────────────────────────────────
    ('8334',   'aditya badana'),
    ('9305',   'akash'),
    ('AA336',  'sidhant sharma'),
    ('AA447',  'vishal pandey'),
    -- ── SECTOR-136 ───────────────────────────────────────────
    ('248222', 'ankit'),
    ('248239', 'chintu'),
    ('AA6007', 'vishjeet'),
    -- ── SS TM ────────────────────────────────────────────────
    ('36001',  'rajat pansari'),
    ('248366', 'rajnish'),
    ('36004',  'renu'),
    ('248359', 'sachin yadav'),
    ('248307', 'sandeep sethi'),
    ('260106', 'vishal')
  ) AS m(bio_code, report_name)
  -- Only consider codes NOT already mapped to another profile
  WHERE NOT EXISTS (
    SELECT 1 FROM profiles p2
    WHERE p2.smartoffice_employee_code = m.bio_code
      AND p2.is_active = true
  )
)
UPDATE profiles p
SET
  smartoffice_employee_code = nm.bio_code,
  smartoffice_synced_at     = now()
FROM name_map nm
WHERE p.is_active = true
  AND p.smartoffice_employee_code IS NULL
  -- Match if the profile name (lowercased) starts with or contains the report name
  AND (
    -- For single-word report names: profile name starts with that word
    -- e.g. "ankur" → "ANKUR TYAGI" matches
    (POSITION(' ' IN nm.report_name) = 0 AND LOWER(p.name) LIKE nm.report_name || '%')
    OR
    -- For multi-word: exact match of the full lowercased name
    -- e.g. "manish kulshrestha" → "MANISH KULSHRESTHA" matches
    (POSITION(' ' IN nm.report_name) > 0 AND LOWER(p.name) LIKE nm.report_name)
    OR
    -- Profile name contains the report name (for cases like "Atif Anwar" → "atif")
    LOWER(p.name) LIKE '%' || nm.report_name || '%'
  );


-- 2c. Back-fill smartoffice_device_logs.user_id for all newly linked codes
--     (links historical punches so they show up in reports immediately)
UPDATE smartoffice_device_logs dl
SET user_id = p.id
FROM profiles p
WHERE p.smartoffice_employee_code = dl.employee_code
  AND p.is_active = true
  AND dl.user_id IS NULL;


-- ────────────────────────────────────────────────────────────
-- STEP 3 — VERIFY (run after updates to confirm row counts)
-- ────────────────────────────────────────────────────────────
SELECT
  COUNT(*)                                            AS total_profiles,
  COUNT(*) FILTER (WHERE smartoffice_employee_code IS NOT NULL) AS linked,
  COUNT(*) FILTER (WHERE smartoffice_employee_code IS NULL)     AS still_unlinked
FROM profiles
WHERE is_active = true;

-- Show any device log rows still without a user_id (should shrink after step 2b)
SELECT
  employee_code,
  COUNT(*) AS punch_count,
  MIN(log_date_only) AS first_date,
  MAX(log_date_only) AS last_date
FROM smartoffice_device_logs
WHERE user_id IS NULL
GROUP BY employee_code
ORDER BY punch_count DESC
LIMIT 30;
