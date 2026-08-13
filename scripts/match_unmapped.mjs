import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

// Read .env manually
const envContent = readFileSync('.env', 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const [key, ...rest] = line.split('=');
  if (key && rest.length) {
    env[key.trim()] = rest.join('=').trim();
  }
});

const supabase = createClient(
  env['EXPO_PUBLIC_SUPABASE_URL'],
  env['EXPO_PUBLIC_SUPABASE_ANON_KEY']
);

// All biometric codes from the Excel report, with name from the report
// Format: [biometric_code, report_name, department]
const BIOMETRIC_MAP = [
  // ACCOUNTS COMMERCIAL
  ['8414',   'Abhishek Tripathi',     'ACCOUNTS COMMERCIAL'],
  ['8241',   'Aditya Kaushik',        'ACCOUNTS COMMERCIAL'],
  ['AA224',  'J.P.',                  'ACCOUNTS COMMERCIAL'],
  ['AA020',  'Kailash Chand',         'ACCOUNTS COMMERCIAL'],
  ['8229',   'Manoj Madan',           'ACCOUNTS COMMERCIAL'],
  ['248208', 'Mithilesh Kumar Jha',   'ACCOUNTS COMMERCIAL'],
  ['8381',   'Nishu kumar',           'ACCOUNTS COMMERCIAL'],
  ['260101', 'Prateek Sharma',        'ACCOUNTS COMMERCIAL'],
  ['AA012',  'Rajpoot P',             'ACCOUNTS COMMERCIAL'],
  ['AA017',  'Sanjay Kumar Bhati',    'ACCOUNTS COMMERCIAL'],
  ['8135',   'Sanjeev Kr. Thakur',    'ACCOUNTS COMMERCIAL'],
  ['AA014',  'Sumit Bansal',          'ACCOUNTS COMMERCIAL'],
  ['AA019',  'Vikas Bhati',           'ACCOUNTS COMMERCIAL'],
  // ADMIN & BACKOFFICE
  ['AA193',  'Kamesh Badana',         'ADMIN & BACKOFFICE'],
  ['AA227',  'Krishna Kumar',         'ADMIN & BACKOFFICE'],
  ['AA018',  'Manish Tomar',          'ADMIN & BACKOFFICE'],
  // CASUAL
  ['8347',   'Aditya',                'CASUAL'],
  ['AA023',  'Basant',                'CASUAL'],
  ['8235',   'Brijesh Basement',      'CASUAL'],
  ['260118', 'Harish',                'CASUAL'],
  ['779',    'Jeet',                  'CASUAL'],
  ['800045', 'Kamal Singh',           'CASUAL'],
  ['260148', 'Minam',                 'CASUAL'],
  ['AA411',  'Pankaj Kumar',          'CASUAL'],
  ['AA024',  'Sajid',                 'CASUAL'],
  ['AA025',  'Santosh',               'CASUAL'],
  ['905',    'Shivam',                'CASUAL'],
  ['AA122',  'Sonu',                  'CASUAL'],
  ['AA026',  'Uttam',                 'CASUAL'],
  ['AA022',  'Veeresh Yadav',         'CASUAL'],
  ['8327',   'Vikash',                'CASUAL'],
  ['8543',   'Vikash gn',             'CASUAL'],
  // HR
  ['AA006',  'Ankur',                 'HR'],
  ['8485',   'Anshul Sharma',         'HR'],
  ['40902',  'Deepti',                'HR'],
  ['248360', 'Isha Pandey',           'HR'],
  ['119',    'Ishika',                'HR'],
  ['AA145',  'Navneet Kumar',         'HR'],
  ['8479',   'Nishita Atras',         'HR'],
  ['1809',   'Vaishali',              'HR'],
  ['AA004',  'Vinita Yadav',          'HR'],
  // MANAGEMENT
  ['AA002',  'Ankush Kadyan',         'MANAGEMENT'],
  ['AA001',  'Gaurav Mavi',           'MANAGEMENT'],
  ['AA110',  'Sachin Mavi',           'MANAGEMENT'],
  ['1111',   'UV',                    'MANAGEMENT'],
  // MARKETING
  ['8519',   'Anant',                 'MARKETING'],
  ['260189', 'Ayesha Tomar',          'MARKETING'],
  ['8374',   'Balraj Singh',          'MARKETING'],
  ['248335', 'Deepti Dhingra',        'MARKETING'],
  ['8540',   'Devansh Bansal',        'MARKETING'],
  ['260188', 'Devanshi Rathi',        'MARKETING'],
  ['AA016',  'Komal Sharma',          'MARKETING'],
  ['8356',   'Madhav Vij',            'MARKETING'],
  ['8464',   'Megha Chanden',         'MARKETING'],
  ['8441',   'Ritesh',                'MARKETING'],
  ['8138',   'Sagar Singh',           'MARKETING'],
  ['8475',   'Satrajeet Neogi',       'MARKETING'],
  ['8561',   'Shashank Kumar',        'MARKETING'],
  ['260128', 'Suraj',                 'MARKETING'],
  ['8346',   'Vishal Joshi',          'MARKETING'],
  // ROMIL TM
  ['248326', 'Abhishek Chaudhary',    'ROMIL TM'],
  ['93450',  'Anjali',                'ROMIL TM'],
  ['248343', 'Ankur Gupta',           'ROMIL TM'],
  ['248248', 'Devendra Joshi',        'ROMIL TM'],
  ['248231', 'Dolly',                 'ROMIL TM'],
  ['36008',  'Gulshan',               'ROMIL TM'],
  ['248245', 'Kapil Sarreen',         'ROMIL TM'],
  ['248347', 'Krishna Kumar',         'ROMIL TM'],
  ['248361', 'Krishna Pathak',        'ROMIL TM'],
  ['90278',  'Lalita',                'ROMIL TM'],
  ['248237', 'Pavan Kumar',           'ROMIL TM'],
  ['248345', 'Piyush',                'ROMIL TM'],
  ['248350', 'Priya Pandey',          'ROMIL TM'],
  ['248240', 'Priyanka Kochar',       'ROMIL TM'],
  ['248265', 'Rahul Sharma',          'ROMIL TM'],
  ['248241', 'Romil Saxena',          'ROMIL TM'],
  ['248293', 'Saksham',               'ROMIL TM'],
  ['248346', 'Satya Prakash',         'ROMIL TM'],
  ['248306', 'Shabina',               'ROMIL TM'],
  ['248257', 'Simran Khokhar',        'ROMIL TM'],
  ['18257',  'Sneha',                 'ROMIL TM'],
  ['36007',  'Tizil Paliwal',         'ROMIL TM'],
  ['248234', 'Yash Sharma',           'ROMIL TM'],
  // SALES GV
  ['248364', 'Abhishek',              'SALES GV'],
  ['8586',   'Abhishek Kr. Gupta',    'SALES GV'],
  ['8572',   'Arun Kumar',            'SALES GV'],
  ['36005',  'Ashish Narang',         'SALES GV'],
  ['248365', 'Kanishk',               'SALES GV'],
  ['260129', 'Muskan',                'SALES GV'],
  ['260140', 'Nishi',                 'SALES GV'],
  ['AA376',  'Nitesh Kumar',          'SALES GV'],
  ['8587',   'Piyush Bhatnagar',     'SALES GV'],
  ['248363', 'Piyush Bhatnagar',      'SALES GV'],
  ['36006',  'Preeti',                'SALES GV'],
  ['8585',   'Pulin Srivastava',      'SALES GV'],
  ['36009',  'Vikash Kumar',          'SALES GV'],
  ['8568',   'Vikrant Sharma',        'SALES GV'],
  ['260107', 'Vinayak Tyagi',         'SALES GV'],
  // SALES-AK
  ['8559',   'Ajay Shukla',           'SALES-AK'],
  ['8182',   'Akash',                 'SALES-AK'],
  ['260138', 'Akash',                 'SALES-AK'],
  ['260171', 'Alok Maurya',           'SALES-AK'],
  ['AA029',  'Amit Kadyan',           'SALES-AK'],
  ['260185', 'Amit Singh',            'SALES-AK'],
  ['8338',   'Ankush Gautam',         'SALES-AK'],
  ['8566',   'Anubhav',               'SALES-AK'],
  ['AA580',  'Aryan Tomar',           'SALES-AK'],
  ['260194', 'Ashish Bathra',         'SALES-AK'],
  ['AA049',  'Bhavnesh Kadyan',       'SALES-AK'],
  ['260200', 'Deepak Singh',          'SALES-AK'],
  ['8576',   'Dilip',                 'SALES-AK'],
  ['260201', 'Divya Sangal',          'SALES-AK'],
  ['8579',   'Harsh',                 'SALES-AK'],
  ['260172', 'Himani Kaushik',        'SALES-AK'],
  ['260992', 'Himanshi',              'SALES-AK'],
  ['260159', 'Himanshu Gupta',        'SALES-AK'],
  ['8478',   'Khushboo Manhas',       'SALES-AK'],
  ['260166', 'Khushi',                'SALES-AK'],
  ['260124', 'Manoj',                 'SALES-AK'],
  ['260165', 'Mayank',                'SALES-AK'],
  ['260152', 'Mayank Singh',          'SALES-AK'],
  ['AA273',  'Mukul Grover',          'SALES-AK'],
  ['260141', 'Nagendra Kumar',        'SALES-AK'],
  ['290993', 'Nikita',                'SALES-AK'],
  ['8596',   'Pankaj AK',             'SALES-AK'],
  ['AA060',  'Pawan Bhati',           'SALES-AK'],
  ['AA241',  'Pawan Kadyan',          'SALES-AK'],
  ['260160', 'Piyush Bhardwaj',       'SALES-AK'],
  ['AA038',  'Praveen Mavi',          'SALES-AK'],
  ['AA9042', 'Rajeev Nagar',          'SALES-AK'],
  ['AA030',  'Ravish Singh',          'SALES-AK'],
  ['260187', 'Rohan Kumar',           'SALES-AK'],
  ['8434',   'Sachin Shukla',         'SALES-AK'],
  ['AA057',  'Sahil Kasar',           'SALES-AK'],
  ['260151', 'Saif Ali Khan Salmani', 'SALES-AK'],
  ['260164', 'Shivani Singh',         'SALES-AK'],
  ['260991', 'Silesh',                'SALES-AK'],
  ['51',     'Sohit Kumar',           'SALES-AK'],
  ['260193', 'Sonia Sahini',          'SALES-AK'],
  ['AA059',  'Sumit Kasana',          'SALES-AK'],
  ['AA040',  'Swapndeep',             'SALES-AK'],
  ['260156', 'Tushar Sharma',         'SALES-AK'],
  ['260119', 'Uday',                  'SALES-AK'],
  ['AA275',  'Umesh Sharma',          'SALES-AK'],
  ['AA6308', 'Vinod Kumar Singh',     'SALES-AK'],
  ['AA055',  'Vinod Singh',           'SALES-AK'],
  ['AA050',  'Vishesh Sharma',        'SALES-AK'],
  ['260186', 'Yugal Pandey',          'SALES-AK'],
  // SALES-GURGAON
  ['4800261','Parveen',               'SALES-GURGAON'],
  // SALES-PM
  ['26115',  'Aditya Nagar',          'SALES-PM'],
  ['260153', 'Ashok Kr. Pandey',      'SALES-PM'],
  ['AA075',  'Prince Mavi',           'SALES-PM'],
  ['260180', 'Shikha',                'SALES-PM'],
  // SALES-RCTM
  ['260179', 'Akash',                 'SALES-RCTM'],
  ['260202', 'Aman Singh',            'SALES-RCTM'],
  ['260203', 'Aryan Yadav',           'SALES-RCTM'],
  ['260197', 'Ashish Kumar',          'SALES-RCTM'],
  ['AA322',  'Bhumi Kundu',           'SALES-RCTM'],
  ['260177', 'Harsh',                 'SALES-RCTM'],
  ['260175', 'Kanika',                'SALES-RCTM'],
  ['260195', 'Manish Kulshrestha',    'SALES-RCTM'],
  ['8239',   'Manu Pushpam Tyagi',    'SALES-RCTM'],
  ['260204', 'Mehandi',               'SALES-RCTM'],
  ['AA282',  'Naresh Bhatia',         'SALES-RCTM'],
  ['AA470',  'Niraj Kumar Singh',     'SALES-RCTM'],
  ['AA315',  'Nitesh Kr. Singh',      'SALES-RCTM'],
  ['AA281',  'Raghu Nandan Chona',    'SALES-RCTM'],
  ['AA558',  'Raj Singh',             'SALES-RCTM'],
  ['260178', 'Ravi',                  'SALES-RCTM'],
  ['260183', 'Sharik Khan',           'SALES-RCTM'],
  ['260176', 'Sonakshi',              'SALES-RCTM'],
  ['260196', 'Subhav Gautam',         'SALES-RCTM'],
  ['8315',   'Suraj Sharma',          'SALES-RCTM'],
  // SALES-SM
  ['8531',   'Ashutosh Kaushik',      'SALES-SM'],
  ['AA111',  'Varun Chahal',          'SALES-SM'],
  // SALES-SRV
  ['248354', 'Abhishek Mavi',         'SALES-SRV'],
  ['248235', 'Alance Addhana',        'SALES-SRV'],
  ['AA084',  'Ankit Mavi',            'SALES-SRV'],
  ['248330', 'Atif',                  'SALES-SRV'],
  ['206',    'Awadesh Pateriya',      'SALES-SRV'],
  ['AA324',  'Gautam Kumar Gupta',    'SALES-SRV'],
  ['363',    'Harsh Yaduvanshi',      'SALES-SRV'],
  ['100',    'Himanshu Kumar',        'SALES-SRV'],
  ['248353', 'Karan Bandari',         'SALES-SRV'],
  ['629',    'Lalit Saren',           'SALES-SRV'],
  ['AA125',  'Manish Mavi',           'SALES-SRV'],
  ['2004',   'Manya',                 'SALES-SRV'],
  ['248300', 'Mohit',                 'SALES-SRV'],
  ['8295',   'Nimish Goyal',          'SALES-SRV'],
  ['88',     'Rahul Solanki',         'SALES-SRV'],
  ['AA126',  'Saurabh Mavi',          'SALES-SRV'],
  ['36002',  'Tahrir',                'SALES-SRV'],
  ['8294',   'Yash Singhal',          'SALES-SRV'],
  // SALES-VPTM
  ['8334',   'Aditya Badana',         'SALES-VPTM'],
  ['9305',   'Akash',                 'SALES-VPTM'],
  ['AA336',  'Sidhant Sharma',        'SALES-VPTM'],
  ['AA447',  'Vishal Pandey',         'SALES-VPTM'],
  // SECTOR-136
  ['248222', 'Ankit',                 'SECTOR-136'],
  ['248239', 'Chintu',                'SECTOR-136'],
  ['AA6007', 'Vishjeet',              'SECTOR-136'],
  // SS TM
  ['36001',  'Rajat Pansari',         'SS TM'],
  ['248366', 'Rajnish',               'SS TM'],
  ['36004',  'Renu',                  'SS TM'],
  ['248359', 'Sachin Yadav',          'SS TM'],
  ['248307', 'Sandeep Sethi',         'SS TM'],
  ['260106', 'Vishal',                'SS TM'],
];

function normalizeName(name) {
  return name.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9\s]/g, '');
}

function nameWords(name) {
  return normalizeName(name).split(/\s+/).filter(w => w.length > 1);
}

async function main() {
  // Get unmapped profiles
  const { data: unmapped, error } = await supabase
    .from('profiles')
    .select('id, name, employee_number, smartoffice_employee_code')
    .eq('is_active', true)
    .is('smartoffice_employee_code', null)
    .order('name');

  if (error) {
    console.error('Error:', error);
    return;
  }

  // Get all profiles already mapped (to avoid duplicates)
  const { data: mapped } = await supabase
    .from('profiles')
    .select('id, name, employee_number, smartoffice_employee_code')
    .eq('is_active', true)
    .not('smartoffice_employee_code', 'is', null);

  const mappedCodes = new Set(mapped.map(p => p.smartoffice_employee_code));
  const mappedNames = new Set(mapped.map(p => normalizeName(p.name)));

  console.log('=== Finding matches for unmapped profiles ===\n');
  
  const matches = [];

  for (const profile of unmapped) {
    const pName = normalizeName(profile.name);
    const pWords = nameWords(profile.name);
    
    let bestMatch = null;
    let bestScore = 0;

    for (const [bioCode, reportName] of BIOMETRIC_MAP) {
      // Skip already mapped codes
      if (mappedCodes.has(bioCode)) continue;
      
      const rName = normalizeName(reportName);
      const rWords = nameWords(reportName);
      
      // Calculate match score
      let score = 0;
      
      // Exact match
      if (pName === rName) score = 100;
      
      // Check word overlap
      const commonWords = pWords.filter(w => rWords.includes(w));
      score = Math.max(score, commonWords.length / Math.max(pWords.length, rWords.length) * 100);
      
      // Check if one name contains the other
      if (pName.includes(rName) || rName.includes(pName)) {
        score = Math.max(score, 80);
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = [bioCode, reportName];
      }
    }

    if (bestMatch && bestScore >= 60) {
      matches.push({
        profile: profile,
        bioCode: bestMatch[0],
        reportName: bestMatch[1],
        score: bestScore
      });
      console.log(`MATCH (${Math.round(bestScore)}%): "${profile.name}" (id:${profile.id.slice(0,8)}...) → bio_code ${bestMatch[0]} (${bestMatch[1]})`);
    } else if (bestMatch) {
      console.log(`WEAK MATCH (${Math.round(bestScore)}%): "${profile.name}" → ${bestMatch[0]} (${bestMatch[1]})`);
    } else {
      console.log(`NO MATCH: "${profile.name}"`);
    }
  }

  // Generate SQL UPDATE statements
  console.log('\n\n=== SQL UPDATE STATEMENTS ===');
  if (matches.length > 0) {
    console.log('-- Run these in Supabase SQL Editor:\n');
    console.log('UPDATE profiles p');
    console.log('SET smartoffice_employee_code = m.bio_code,');
    console.log('    smartoffice_synced_at = now()');
    console.log('FROM (VALUES');
    matches.forEach((m, i) => {
      const comma = i < matches.length - 1 ? ',' : '';
      console.log(`  ('${m.profile.id}', '${m.bioCode}')${comma} -- ${m.profile.name}`);
    });
    console.log(') AS m(profile_id, bio_code)');
    console.log('WHERE p.id = m.profile_id::uuid');
    console.log('  AND (p.smartoffice_employee_code IS NULL OR p.smartoffice_employee_code <> m.bio_code);');
    
    // Backfill
    console.log('\n-- Then backfill historical data:\n');
    console.log('UPDATE smartoffice_device_logs dl');
    console.log('SET user_id = p.id');
    console.log('FROM profiles p');
    console.log('WHERE p.smartoffice_employee_code = dl.employee_code');
    console.log('  AND p.is_active = true');
    console.log('  AND dl.user_id IS NULL;');
  }

  console.log(`\n\nTotal unmapped: ${unmapped.length}`);
  console.log(`Auto-matched: ${matches.length}`);
}

main();