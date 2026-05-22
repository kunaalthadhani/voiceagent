// api/calls.js
// Returns the 50 most recent calls (newest first) for the dashboard.

import { kv } from '@vercel/kv';

export const config = {
  api: { bodyParser: true }
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // zrange with REV gives newest first
    const ids = await kv.zrange('calls:by_time', 0, 49, { rev: true });
    if (!ids || ids.length === 0) {
      return res.status(200).json({ calls: [] });
    }

    const keys = ids.map((id) => 'call:' + id);
    const records = await kv.mget(...keys);

    const calls = records.filter(Boolean);
    return res.status(200).json({ calls });
  } catch (e) {
    console.error('[calls] error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
