const fs = require('fs');
let content = fs.readFileSync('fix_view.sql', 'utf-8');

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

content = bucketSql + "\n" + content;
fs.writeFileSync('fix_400_errors.sql', content, 'utf-8');
console.log("Prepared fix_400_errors.sql");
