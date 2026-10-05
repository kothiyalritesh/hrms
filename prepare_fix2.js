const fs = require('fs');
let content = fs.readFileSync('COMBINED_MIGRATIONS_V3.sql', 'utf-8');

const regex = /CREATE OR REPLACE VIEW public\.v_attendance_daily_canonical[\s\S]*?FROM evidence e;/;
const match = content.match(regex);
if (match) {
  const bucketSql = `
-- Create profile-pics bucket if missing
INSERT INTO storage.buckets (id, name, public) 
VALUES ('profile-pics', 'profile-pics', false) 
ON CONFLICT (id) DO NOTHING;

-- Grant RLS policies for profile-pics (so users can read their own or others can read them)
CREATE POLICY "Profile pics are viewable by authenticated users" 
ON storage.objects FOR SELECT TO authenticated 
USING (bucket_id = 'profile-pics');

CREATE POLICY "Users can upload their own profile pic" 
ON storage.objects FOR INSERT TO authenticated 
WITH CHECK (bucket_id = 'profile-pics' AND (storage.foldername(name))[1] = 'avatars');

CREATE POLICY "Users can update their own profile pic" 
ON storage.objects FOR UPDATE TO authenticated 
USING (bucket_id = 'profile-pics');

`;
  const viewSql = "DROP VIEW IF EXISTS public.v_attendance_daily_canonical CASCADE;\n\n" + match[0] + ";\n\nGRANT SELECT ON public.v_attendance_daily_canonical TO authenticated, anon;\nNOTIFY pgrst, 'reload schema';\n";
  
  fs.writeFileSync('fix_400_errors.sql', bucketSql + viewSql, 'utf-8');
  console.log("Refined fix_400_errors.sql");
} else {
  console.log("Could not find view definition");
}
