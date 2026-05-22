// api/calls.js
// Returns the 50 most recent calls (newest first) for the dashboard.

import { listRecentCalls } from '../lib/store.js';

export const config = {
  api: { bodyParser: true }
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const calls = await listRecentCalls(50);
    return res.status(200).json({ calls });
  } catch (e) {
    console.error('[calls] error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
