/**
 * Seed script to populate initial roles and offices
 * Run this once to set up the database with initial data
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://gpvakmpuvpjalycvsoqu.supabase.co";
const supabaseAnonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdwdmFrbXB1dnBqYWx5Y3Zzb3F1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY0ODI5OTIsImV4cCI6MjA4MjA1ODk5Mn0.ftz9RU3yK9pQhGpSTp3M3jQCPEG-sQKUilqpZUQiVho";

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const roles = [
  { name: "Business Head" },
  { name: "Commercial Team" },
  { name: "Accounts Team" },
  { name: "Marketing Team" },
  { name: "Team Head" },
  { name: "Team Lead" },
  { name: "Sales Executive" },
];

const offices = [
  { name: "Sector 63" },
  { name: "Noida 136" },
  { name: "Greater Noida Alpha 2" },
  { name: "Gurugram" },
];

async function seedData() {
  console.log("Starting data seeding...\n");

  try {
    // Seed Roles
    console.log("🔄 Adding roles...");
    for (const role of roles) {
      const { data, error } = await supabase
        .from("roles")
        .insert([role])
        .select();

      if (error) {
        console.error(`❌ Error adding role "${role.name}":`, error.message);
      } else {
        console.log(`✅ Added role: ${role.name}`);
      }
    }

    console.log("\n🔄 Adding offices...");
    // Seed Offices
    for (const office of offices) {
      const { data, error } = await supabase
        .from("offices")
        .insert([office])
        .select();

      if (error) {
        console.error(
          `❌ Error adding office "${office.name}":`,
          error.message,
        );
      } else {
        console.log(`✅ Added office: ${office.name}`);
      }
    }

    console.log("\n✨ Data seeding completed!");
    console.log(`\n📊 Summary:`);
    console.log(`   - Roles added: ${roles.length}`);
    console.log(`   - Offices added: ${offices.length}`);
  } catch (error) {
    console.error("Fatal error during seeding:", error);
    process.exit(1);
  }
}

// Run the seeding function
seedData()
  .then(() => {
    console.log("\n✅ All done!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Failed:", error);
    process.exit(1);
  });
