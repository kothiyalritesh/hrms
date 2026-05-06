// Test script to verify activity service
// Run this in browser console to debug

const userId = "94f8c297-2e9b-446f-9b2a-3610ae3b56cb";

// Test direct Supabase query
async function testActivityFetch() {
  const { supabase } = await import("@/lib/supabase");
  
  console.log("Testing activity fetch for user:", userId);
  
  const { data, error } = await supabase
    .from("activity_logs")
    .select("*")
    .eq("user_id", userId)
    .order("timestamp", { ascending: false })
    .limit(50);
  
  console.log("Result:", { dataLength: data?.length, error, data });
  return { data, error };
}

// Run the test
testActivityFetch();
