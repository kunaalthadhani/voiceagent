// api/intake.js
// Receives lead form submission from public/index.html, then asks Vapi
// to place an outbound call to that lead with their info as dynamic variables.

import { insertCall } from '../lib/store.js';

export const config = {
  api: { bodyParser: true }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { lead_name, phone, property, brokerage } = req.body || {};

    if (!lead_name || !phone || !property || !brokerage) {
      return res.status(400).json({ error: 'Missing required field (lead_name, phone, property, brokerage)' });
    }

    // Basic phone sanity check — must start with + and be 8+ digits.
    if (!/^\+\d{8,15}$/.test(phone.trim())) {
      return res.status(400).json({ error: 'Phone must be E.164 format like +971501234567' });
    }

    const apiKey = process.env.VAPI_API_KEY;
    const assistantId = process.env.VAPI_ASSISTANT_ID;
    const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;

    if (!apiKey || !assistantId || !phoneNumberId) {
      return res.status(500).json({
        error: 'Server missing VAPI_API_KEY, VAPI_ASSISTANT_ID, or VAPI_PHONE_NUMBER_ID'
      });
    }

    console.log('[intake] placing call to', phone, 'for', lead_name);

    const vapiRes = await fetch('https://api.vapi.ai/call', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        assistantId,
        phoneNumberId,
        customer: { number: phone.trim() },
        assistantOverrides: {
          variableValues: {
            lead_name,
            property,
            brokerage
          }
        }
      })
    });

    const vapiJson = await vapiRes.json();

    if (!vapiRes.ok) {
      console.error('[intake] Vapi error:', vapiRes.status, vapiJson);
      return res.status(502).json({ error: 'Vapi: ' + (vapiJson.message || vapiRes.status) });
    }

    const callId = vapiJson.id;
    console.log('[intake] Vapi call created:', callId);

    // Stash a placeholder row in Supabase — the webhook will enrich it after the call.
    await insertCall({
      id: callId,
      lead_name,
      phone,
      property,
      brokerage,
      status: 'dialing',
      created_at: new Date().toISOString()
    });

    return res.status(200).json({ ok: true, callId });
  } catch (e) {
    console.error('[intake] error:', e.message, e.stack);
    return res.status(500).json({ error: e.message });
  }
}
