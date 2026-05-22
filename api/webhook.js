// api/webhook.js
// Vapi POSTs events here throughout a call's lifecycle.
// We only care about the end-of-call-report event, which contains the
// full transcript + Vapi's structured data extraction.
//
// Configure this URL in Vapi assistant config:
//   Advanced → Server URL → https://<your-vercel-domain>/api/webhook

import { kv } from '@vercel/kv';

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

    const existing = await kv.get('call:' + callId);
    if (!existing) {
      console.warn('[webhook] no KV record for call', callId, '- creating one');
    }

    const transcript = event.transcript || event.artifact?.transcript || null;
    const summary = event.summary || event.analysis?.summary || null;
    const structured = event.analysis?.structuredData || event.artifact?.structuredData || null;
    const endedReason = event.endedReason || null;
    const durationSeconds = event.durationSeconds
      ?? event.duration
      ?? (event.startedAt && event.endedAt ? Math.round((new Date(event.endedAt) - new Date(event.startedAt)) / 1000) : null);
    const recordingUrl = event.recordingUrl || event.artifact?.recordingUrl || null;

    const updated = Object.assign({}, existing || { id: callId, created_at: Date.now() }, {
      status: 'completed',
      ended_reason: endedReason,
      duration_seconds: durationSeconds,
      transcript,
      summary,
      structured_data: structured,
      recording_url: recordingUrl,
      completed_at: Date.now()
    });

    await kv.set('call:' + callId, updated);
    if (!existing) {
      // Ensure it shows up in the dashboard list even if intake didn't add it
      await kv.zadd('calls:by_time', { score: updated.created_at, member: callId });
    }

    console.log('[webhook] saved call', callId, 'duration=' + durationSeconds + 's ended=' + endedReason);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[webhook] error:', e.message, e.stack);
    // Always 200 to Vapi — we don't want them to retry endlessly on our bugs.
    return res.status(200).json({ ok: false, error: e.message });
  }
}
