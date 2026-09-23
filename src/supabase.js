import { createClient } from '@supabase/supabase-js';

const cleanValue = (value) => typeof value === 'string' ? value.trim().replace(/^(["'])(.*)\1$/, '$2') : '';
const url = cleanValue(import.meta.env.VITE_SUPABASE_URL);
const publicKey = cleanValue(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY);

let client = null;
let configurationError = '';

if (!url || !publicKey) {
  configurationError = 'Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.local, then restart the dev server.';
} else {
  try {
    const parsedUrl = new URL(url);
    if (!['https:', 'http:'].includes(parsedUrl.protocol) || parsedUrl.hostname === 'your-project.supabase.co') {
      throw new Error('VITE_SUPABASE_URL must be the Project URL shown in Supabase → Project Settings → API.');
    }
    if (publicKey === 'your-supabase-anon-key' || publicKey === 'your-supabase-publishable-key') {
      throw new Error('Replace the placeholder key with the Supabase publishable key (or legacy anon key).');
    }
    client = createClient(url, publicKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  } catch (error) {
    configurationError = error instanceof Error ? error.message : 'Supabase configuration is invalid.';
    client = null;
  }
}

export const supabase = client;
export const supabaseConfigurationError = configurationError;
export const hasSupabaseConfig = Boolean(client);
