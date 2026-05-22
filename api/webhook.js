// api/webhook.js
// Vapi POSTs events here throughout a call's lifecycle.
// We only care about the end-of-call-report event, which contains the
// full transcript + Vapi's structured data extraction.
//
// Configure this URL in Vapi assistant config:
//   Advanced → Server URL → https://<your-vercel-domain>/api/webhook

import { upsertCall, getCall } from '../lib/store.js';

export const config = {
  api: { bodyParser: true }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const event = req.body?.message || req.body;
    const type = event?.type;
    const callId = event?.call?.id;

    console.log('[webhook] event type=' + type + ' call=' + callId);

    // Vapi sends many event types: status-update, transcript, function-call,
    // end-of-call-report, etc. We only persist on end-of-call-report.
    if (type !== 'end-of-call-report') {
      return res.status(200).json({ ok: true, ignored: type });
    }

    if (!callId) {
      console.warn('[webhook] end-of-call-report missing call.id');
      return res.status(200).json({ ok: true });
    }

    const existing = await getCall(callId);
    if (!existing) {
      console.warn('[webhook] no row for call', callId, '- creating one');
    }

    const transcript = event.transcript || event.artifact?.transcript || null;
    const summary = event.summary || event.analysis?.summary || null;
    const structured = event.analysis?.structuredData || event.artifact?.structuredData || null;
    const endedReason = event.endedReason || null;
    const durationSeconds = event.durationSeconds
      ?? event.duration
      ?? (event.startedAt && event.endedAt ? Math.round((new Date(event.endedAt) - new Date(event.startedAt)) / 1000) : null);
    const recordingUrl = event.recordingUrl || event.artifact?.recordingUrl || null;

    await upsertCall({
      id: callId,
      // If no row existed, fill these from event so we still have a complete record
      lead_name: existing?.lead_name || event.customer?.name || null,
      phone: existing?.phone || event.customer?.number || null,
      property: existing?.property || null,
      brokerage: existing?.brokerage || null,
      created_at: existing?.created_at || new Date().toISOString(),
      status: 'completed',
      ended_reason: endedReason,
      duration_seconds: durationSeconds,
      transcript,
      summary,
      structured_data: structured,
      recording_url: recordingUrl,
      completed_at: new Date().toISOString()
    });

    console.log('[webhook] saved call', callId, 'duration=' + durationSeconds + 's ended=' + endedReason);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[webhook] error:', e.message, e.stack);
    // Always 200 to Vapi — we don't want them to retry endlessly on our bugs.
    return res.status(200).json({ ok: false, error: e.message });
  }
}
