const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
try {
  if (!url || !key) throw Error("Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_KEY in the EAS build environment.");
  if (new URL(url).protocol !== "https:") throw Error("The Supabase build URL must use HTTPS.");
  if (!key.startsWith("sb_publishable_")) {
    const claims = JSON.parse(Buffer.from(key.split(".")[1] || "", "base64url").toString());
    if (claims.role !== "anon") throw Error("Use a Supabase publishable or anon key in the app.");
  }
  console.log("Supabase build configuration verified.");
} catch (error) {
  console.error("Build stopped: " + (error instanceof SyntaxError ? "Invalid Supabase public key." : error.message));
  process.exit(1);
}
