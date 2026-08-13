import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

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

// All biometric codes from the Excel report
const BIOMETRIC_MAP = [
  ['8414',   'Abhishek Tripathi'],
  ['8241',   'Aditya Kaushik'],
  ['AA224',  'J.P.'],
  ['AA020',  'Kailash Chand'],
  ['8229',   'Manoj Madan'],
  ['248208', 'Mithilesh Kumar Jha'],
  ['8381',   'Nishu kumar'],
  ['260101', 'Prateek Sharma'],
  ['AA012',  'Rajpoot P'],
  ['AA017',  'Sanjay Kumar Bhati'],
  ['8135',   'Sanjeev Kr. Thakur'],
  ['AA014',  'Sumit Bansal'],
  ['AA019',  'Vikas Bhati'],
  ['AA193',  'Kamesh Badana'],
  ['AA227',  'Krishna Kumar'],
  ['AA018',  'Manish Tomar'],
  ['8347',   'Aditya'],
  ['AA023',  'Basant'],
  ['8235',   'Brijesh Basement'],
  ['260118', 'Harish'],
  ['779',    'Jeet'],
  ['800045', 'Kamal Singh'],
  ['260148', 'Minam'],
  ['AA411',  'Pankaj Kumar'],
  ['AA024',  'Sajid'],
  ['AA025',  'Santosh'],
  ['905',    'Shivam'],
  ['AA122',  'Sonu'],
  ['AA026',  'Uttam'],
  ['AA022',  'Veeresh Yadav'],
  ['8327',   'Vikash'],
  ['8543',   'Vikash gn'],
  ['AA006',  'Ankur'],
  ['8485',   'Anshul Sharma'],
  ['40902',  'Deepti'],
  ['248360', 'Isha Pandey'],
  ['119',    'Ishika'],
  ['AA145',  'Navneet Kumar'],
  ['8479',   'Nishita Atras'],
  ['1809',   'Vaishali'],
  ['AA004',  'Vinita Yadav'],
  ['AA002',  'Ankush Kadyan'],
  ['AA001',  'Gaurav Mavi'],
  ['AA110',  'Sachin Mavi'],
  ['1111',   'UV'],
  ['8519',   'Anant'],
  ['260189', 'Ayesha Tomar'],
  ['8374',   'Balraj Singh'],
  ['248335', 'Deepti Dhingra'],
  ['8540',   'Devansh Bansal'],
  ['260188', 'Devanshi Rathi'],
  ['AA016',  'Komal Sharma'],
  ['8356',   'Madhav Vij'],
  ['8464',   'Megha Chanden'],
  ['8441',   'Ritesh'],
  ['8138',   'Sagar Singh'],
  ['8475',   'Satrajeet Neogi'],
  ['8561',   'Shashank Kumar'],
  ['260128', 'Suraj'],
  ['8346',   'Vishal Joshi'],
  ['248326', 'Abhishek Chaudhary'],
  ['93450',  'Anjali'],
  ['248343', 'Ankur Gupta'],
  ['248248', 'Devendra Joshi'],
  ['248231', 'Dolly'],
  ['36008',  'Gulshan'],
  ['248245', 'Kapil Sarreen'],
  ['248347', 'Krishna Kumar'],
  ['248361', 'Krishna Pathak'],
  ['90278',  'Lalita'],
  ['248237', 'Pavan Kumar'],
  ['248345', 'Piyush'],
  ['248350', 'Priya Pandey'],
  ['248240', 'Priyanka Kochar'],
  ['248265', 'Rahul Sharma'],
  ['248241', 'Romil Saxena'],
  ['248293', 'Saksham'],
  ['248346', 'Satya Prakash'],
  ['248306', 'Shabina'],
  ['248257', 'Simran Khokhar'],
  ['18257',  'Sneha'],
  ['36007',  'Tizil Paliwal'],
  ['248234', 'Yash Sharma'],
  ['248364', 'Abhishek'],
  ['8586',   'Abhishek Kr. Gupta'],
  ['8572',   'Arun Kumar'],
  ['36005',  'Ashish Narang'],
  ['248365', 'Kanishk'],
  ['260129', 'Muskan'],
  ['260140', 'Nishi'],
  ['AA376',  'Nitesh Kumar'],
  ['8587',   'Piyush Bhatnagar'],
  ['248363', 'Piyush Bhatnagar'],
  ['36006',  'Preeti'],
  ['8585',   'Pulin Srivastava'],
  ['36009',  'Vikash Kumar'],
  ['8568',   'Vikrant Sharma'],
  ['260107', 'Vinayak Tyagi'],
  ['8559',   'Ajay Shukla'],
  ['8182',   'Akash'],
  ['260138', 'Akash'],
  ['260171', 'Alok Maurya'],
  ['AA029',  'Amit Kadyan'],
  ['260185', 'Amit Singh'],
  ['8338',   'Ankush Gautam'],
  ['8566',   'Anubhav'],
  ['AA580',  'Aryan Tomar'],
  ['260194', 'Ashish Bathra'],
  ['AA049',  'Bhavnesh Kadyan'],
  ['260200', 'Deepak Singh'],
  ['8576',   'Dilip'],
  ['260201', 'Divya Sangal'],
  ['8579',   'Harsh'],
  ['260172', 'Himani Kaushik'],
  ['260992', 'Himanshi'],
  ['260159', 'Himanshu Gupta'],
  ['8478',   'Khushboo Manhas'],
  ['260166', 'Khushi'],
  ['260124', 'Manoj'],
  ['260165', 'Mayank'],
  ['260152', 'Mayank Singh'],
  ['AA273',  'Mukul Grover'],
  ['260141', 'Nagendra Kumar'],
  ['290993', 'Nikita'],
  ['8596',   'Pankaj AK'],
  ['AA060',  'Pawan Bhati'],
  ['AA241',  'Pawan Kadyan'],
  ['260160', 'Piyush Bhardwaj'],
  ['AA038',  'Praveen Mavi'],
  ['AA9042', 'Rajeev Nagar'],
  ['AA030',  'Ravish Singh'],
  ['260187', 'Rohan Kumar'],
  ['8434',   'Sachin Shukla'],
  ['AA057',  'Sahil Kasar'],
  ['260151', 'Saif Ali Khan Salmani'],
  ['260164', 'Shivani Singh'],
  ['260991', 'Silesh'],
  ['51',     'Sohit Kumar'],
  ['260193', 'Sonia Sahini'],
  ['AA059',  'Sumit Kasana'],
  ['AA040',  'Swapndeep'],
  ['260156', 'Tushar Sharma'],
  ['260119', 'Uday'],
  ['AA275',  'Umesh Sharma'],
  ['AA6308', 'Vinod Kumar Singh'],
  ['AA055',  'Vinod Singh'],
  ['AA050',  'Vishesh Sharma'],
  ['260186', 'Yugal Pandey'],
  ['4800261','Parveen'],
  ['26115',  'Aditya Nagar'],
  ['260153', 'Ashok Kr. Pandey'],
  ['AA075',  'Prince Mavi'],
  ['260180', 'Shikha'],
  ['260179', 'Akash'],
  ['260202', 'Aman Singh'],
  ['260203', 'Aryan Yadav'],
  ['260197', 'Ashish Kumar'],
  ['AA322',  'Bhumi Kundu'],
  ['260177', 'Harsh'],
  ['260175', 'Kanika'],
  ['260195', 'Manish Kulshrestha'],
  ['8239',   'Manu Pushpam Tyagi'],
  ['260204', 'Mehandi'],
  ['AA282',  'Naresh Bhatia'],
  ['AA470',  'Niraj Kumar Singh'],
  ['AA315',  'Nitesh Kr. Singh'],
  ['AA281',  'Raghu Nandan Chona'],
  ['AA558',  'Raj Singh'],
  ['260178', 'Ravi'],
  ['260183', 'Sharik Khan'],
  ['260176', 'Sonakshi'],
  ['260196', 'Subhav Gautam'],
  ['8315',   'Suraj Sharma'],
  ['8531',   'Ashutosh Kaushik'],
  ['AA111',  'Varun Chahal'],
  ['248354', 'Abhishek Mavi'],
  ['248235', 'Alance Addhana'],
  ['AA084',  'Ankit Mavi'],
  ['248330', 'Atif'],
  ['206',    'Awadesh Pateriya'],
  ['AA324',  'Gautam Kumar Gupta'],
  ['363',    'Harsh Yaduvanshi'],
  ['100',    'Himanshu Kumar'],
  ['248353', 'Karan Bandari'],
  ['629',    'Lalit Saren'],
  ['AA125',  'Manish Mavi'],
  ['2004',   'Manya'],
  ['248300', 'Mohit'],
  ['8295',   'Nimish Goyal'],
  ['88',     'Rahul Solanki'],
  ['AA126',  'Saurabh Mavi'],
  ['36002',  'Tahrir'],
  ['8294',   'Yash Singhal'],
  ['8334',   'Aditya Badana'],
  ['9305',   'Akash'],
  ['AA336',  'Sidhant Sharma'],
  ['AA447',  'Vishal Pandey'],
  ['248222', 'Ankit'],
  ['248239', 'Chintu'],
  ['AA6007', 'Vishjeet'],
  ['36001',  'Rajat Pansari'],
  ['248366', 'Rajnish'],
  ['36004',  'Renu'],
  ['248359', 'Sachin Yadav'],
  ['248307', 'Sandeep Sethi'],
  ['260106', 'Vishal'],
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

  // Get all profiles already mapped
  const { data: mapped } = await supabase
    .from('profiles')
    .select('id, name, employee_number, smartoffice_employee_code')
    .eq('is_active', true)
    .not('smartoffice_employee_code', 'is', null);

  const mappedCodes = new Set(mapped.map(p => p.smartoffice_employee_code));

  console.log('=== REMAINING UNMAPPED PROFILES ===\n');
  
  // Manual mapping for profiles that need it
  const manualMappings = {
    // These are profiles that exist in DB but may not be in the biometric report
    // or need special handling
    
    // "Abhay Rastogi" - employee_number "7" - not in report, skip
    // "Admin" - system account, skip
    // "Anuj Dhaka" - employee_number "8712" - not in report
    // "AYUSHI PAL" - not in report
    // "Azam Hussain" - employee_number "8055" - not in report
    // "BALRAJ BHATI" - employee_number "14" - not in report
    // "Brijesh Solanki" - not in report
    // "DEEPAK KUMAR" - not in report
    // "Deepak Ojha" - employee_number "798" - not in report
    // "Deepak yadav" - not in report
    // "DEEPAKANKAR" - not in report
    // "Divyansh Chauhan" - employee_number "9872" - not in report
    // "Durgesh Kumar Singh" - not in report
    // "Farheen Banu" - not in report
    // "Gajendra Solanki" - not in report
    // "HIMANEE KAUSHIK" - not in report (Himani Kaushik is 260172 but already mapped)
    // "Himanshu Tyagi" - not in report
    // "Karan Bhandari" - not in report (Karan Bandari is 248353 but already mapped)
    // "Khushi Singh" - employee_number "8" - not in report
    // "kiranpal singh" - not in report
    // "KIRANPAL SINGH" - not in report
    // "KULDEEP GAUR" - not in report
    // "Kumar Priya Ranjan" - not in report
    // "MANISH CHAUHAN" - not in report
    // "MANUPUSHPAM TYAGI" - not in report
    // "MEGHA CHANDAN" - employee_number "1" - Megha Chanden is 8464 but already mapped
    // "MISHA KUAMRI" - not in report
    // "Mohammad Zaid" - employee_number "9" - not in report
    // "Mohammed Mehdi" - employee_number "0177" - not in report
    // "Mohd.Saleem" - not in report
    // "Mrityunjay SINGH" - not in report
    // "Nakul" - employee_number "234132" - not in report
    // "Nazim khan" - employee_number "0193" - not in report
    // "NIDHI KUMARI" - not in report
    // "NIKHIL KUMAR" - not in report
    // "Ojaswi Adlakha" - employee_number "005" - not in report
    // "Parul Chaudhary" - not in report
    // "Pavan Bhati" - employee_number "2109" - not in report (Pawan Bhati is AA060 but already mapped)
    // "PRATEEK SHARMA" - not in report (Prateek Sharma is 260101 but already mapped)
    // "Priyanka Sungh" - employee_number "0171" - not in report
    // "PUJA GUPTA" - not in report
    // "RAGHAV PANDEY" - not in report
    // "RAGHU CHONA" - employee_number "123" - not in report (Raghu Nandan Chona is AA281 but already mapped)
    // "Rahul Chaudhary" - not in report
    // "RAKESH KR.SHRIVASTAVA" - employee_number "189" - not in report
    // "RINKU" - not in report
    // "RITIKA YADAV" - not in report
    // "Sahil Bhatt" - not in report
    // "Samarth Yadav" - not in report
    // "Satyam Tiwari" - employee_number "90843" - not in report
    // "Saurav Mavi" - employee_number "341" - not in report (Saurabh Mavi is AA126 but already mapped)
    // "Shaheen" - employee_number "4" - not in report
    // "SHALU" - not in report
    // "SHARAD GOEL" - not in report
    // "SHASHANK KR.GUPTA" - employee_number "786" - not in report
    // "Shavez Rizvi" - not in report
    // "Shreesh Agarwal" - not in report
    // "SHREYA SINGH" - not in report
    // "Shrishty Sharma" - employee_number "9087" - not in report
    // "Shubhashree Mukherjee" - employee_number "6" - not in report
    // "siddhant" - not in report (Sidhant Sharma is AA336 but already mapped)
    // "Sonendra Sharma" - not in report
    // "SOURAV MAVI" - employee_number "fsdf" - not in report
    // "Sunil Kumar" - not in report
    // "Sushank sonker" - not in report
    // "SWAPAN DEEP" - not in report (Swapndeep is AA040 but already mapped)
    // "Upendra Pratap Singh" - not in report
    // "Vineeta Yadav" - not in report (Vinita Yadav is AA004 but already mapped)
    // "Viral Kumar Singh" - not in report
  };

  // Check which biometric codes are NOT yet mapped to any profile
  const unmappedCodes = BIOMETRIC_MAP.filter(([code]) => !mappedCodes.has(code));
  
  console.log(`Total unmapped profiles in DB: ${unmapped.length}`);
  console.log(`Biometric codes NOT yet mapped to any profile: ${unmappedCodes.length}`);
  
  if (unmappedCodes.length > 0) {
    console.log('\n=== UNMAPPED BIOMETRIC CODES (not linked to any profile) ===');
    for (const [code, name] of unmappedCodes) {
      console.log(`  ${code} - ${name}`);
    }
  }

  // Show all unmapped profiles for manual review
  console.log('\n=== ALL UNMAPPED PROFILES (for manual review) ===');
  for (const p of unmapped) {
    console.log(`  "${p.name}" (emp#: ${p.employee_number || 'null'})`);
  }
}

main();