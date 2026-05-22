// lib/store.js
// Thin wrapper around Supabase for the `calls` table.
// Server-side only — uses the service role key.

import { createClient } from '@supabase/supabase-js';

let client = null;

function getClient() {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing');
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

const TABLE = 'calls';

export async function insertCall(record) {
  const supabase = getClient();
  const { error } = await supabase.from(TABLE).insert(record);
  if (error) throw new Error('insertCall: ' + error.message);
}

export async function upsertCall(record) {
  const supabase = getClient();
  const { error } = await supabase.from(TABLE).upsert(record, { onConflict: 'id' });
  if (error) throw new Error('upsertCall: ' + error.message);
}

export async function getCall(id) {
  const supabase = getClient();
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
  if (error) throw new Error('getCall: ' + error.message);
  return data;
}

export async function listRecentCalls(limit = 50) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error('listRecentCalls: ' + error.message);
  return data || [];
}
