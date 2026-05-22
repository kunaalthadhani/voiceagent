// api/tts.js
// Vapi-compatible custom TTS endpoint that wraps Sesame CSM-1B (hosted on Replicate).
// Vapi POSTs here with text; we return raw 16-bit PCM mono audio. Vapi handles sample rate conversion.

export const config = {
  api: {
    bodyParser: true,
    responseLimit: false
  }
};

const SESAME_MODEL = 'lucataco/csm-1b';

async function generateSesameAudio(text, speakerId) {
  const apiKey = process.env.REPLICATE_API_TOKEN;
  if (!apiKey) throw new Error('REPLICATE_API_TOKEN not set');

  const response = await fetch('https://api.replicate.com/v1/models/' + SESAME_MODEL + '/predictions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
      'Prefer': 'wait=60'
    },
    body: JSON.stringify({
      input: {
        text: text,
        speaker: speakerId,
        max_audio_length_ms: 30000
      }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error('Replicate ' + response.status + ': ' + errText.slice(0, 200));
  }

  const result = await response.json();
  if (result.status === 'failed') throw new Error('Sesame failed: ' + result.error);
  if (!result.output) throw new Error('Sesame returned no output');

  const audioUrl = Array.isArray(result.output) ? result.output[0] : result.output;
  const audioResponse = await fetch(audioUrl);
  if (!audioResponse.ok) throw new Error('Failed to fetch audio: ' + audioResponse.status);

  const arrayBuffer = await audioResponse.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// Sesame returns a WAV file. Vapi wants raw PCM bytes (no header).
function stripWavHeader(wavBuffer) {
  for (let i = 0; i < Math.min(wavBuffer.length - 8, 200); i++) {
    if (
      wavBuffer[i] === 0x64 && wavBuffer[i + 1] === 0x61 &&
      wavBuffer[i + 2] === 0x74 && wavBuffer[i + 3] === 0x61
    ) {
      return wavBuffer.slice(i + 8); // skip "data" + size field
    }
  }
  console.warn('[tts] WAV data marker not found, using 44-byte fallback');
  return wavBuffer.slice(44);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const text = body.message?.text || body.text || '';
    const speakerId = Number(body.speaker ?? process.env.SESAME_SPEAKER ?? 0);

    if (!text.trim()) {
      return res.status(200).send(Buffer.alloc(3200)); // ~100ms silence
    }

    console.log('[tts] synthesizing: "' + text.slice(0, 80) + '" (speaker=' + speakerId + ')');
    const t0 = Date.now();
    const wavBuffer = await generateSesameAudio(text, speakerId);
    const pcmBuffer = stripWavHeader(wavBuffer);
    console.log('[tts] done in ' + (Date.now() - t0) + 'ms, ' + pcmBuffer.length + ' PCM bytes');

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', pcmBuffer.length);
    return res.status(200).send(pcmBuffer);
  } catch (e) {
    console.error('[tts] error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
