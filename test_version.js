async function testVersion() {
  const anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImppZGJyd3B6ZnBidXJzaWh0dnBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0MTg3OTgsImV4cCI6MjA4OTk5NDc5OH0.P-j0skFmSd-WtqV5-wi51ArxAwE4ZBt3ctYBtY-mj-0";
  const edgeUrl = "https://jidbrwpzfpbursihtvpg.supabase.co/functions/v1/biometric-attendance-sync";
  const res = await fetch(edgeUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${anonKey}`,
      "apikey": anonKey,
    },
    body: JSON.stringify({ action: "version" })
  });
  console.log("Version call status:", res.status);
  console.log("Version response:", await res.json());
}
testVersion();
