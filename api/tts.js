// api/tts.js
// Vapi-compatible custom TTS endpoint that wraps Sesame CSM-1B (hosted on Replicate).
// Vapi POSTs { message: { text, sampleRate } }. We must return raw PCM:
//   - 16-bit signed integer, little-endian
//   - mono
//   - sample rate exactly matching message.sampleRate (Vapi: 8000/16000/22050/24000)
// Any deviation = garbled audio.

export const config = {
  api: {
    bodyParser: true,
    responseLimit: false
  }
};

const SESAME_VERSION = '3e59b10a9894c54ae5f2fc0347e3a2f5c82f0574407e53a7d9f76ec7c502ad03';

async function generateSesameAudio(text, speakerId) {
  const apiKey = process.env.REPLICATE_API_TOKEN;
  if (!apiKey) throw new Error('REPLICATE_API_TOKEN not set');

  const response = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
      'Prefer': 'wait=60'
    },
    body: JSON.stringify({
      version: SESAME_VERSION,
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

// Parse a WAV buffer into { format, channels, sampleRate, bitsPerSample, data }.
// format: 1 = PCM int, 3 = IEEE float.
function parseWav(buf) {
  if (buf.length < 44) throw new Error('WAV too small: ' + buf.length + ' bytes');
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a WAV file (header=' + buf.toString('ascii', 0, 4) + '/' + buf.toString('ascii', 8, 12) + ')');
  }

  let fmt = null;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);

    if (chunkId === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(offset + 8),
        channels: buf.readUInt16LE(offset + 10),
        sampleRate: buf.readUInt32LE(offset + 12),
        bitsPerSample: buf.readUInt16LE(offset + 22)
      };
    } else if (chunkId === 'data') {
      if (!fmt) throw new Error('data chunk before fmt chunk');
      return Object.assign({}, fmt, { data: buf.slice(offset + 8, offset + 8 + chunkSize) });
    }
    offset += 8 + chunkSize + (chunkSize % 2); // chunks are word-aligned
  }
  throw new Error('data chunk not found in WAV');
}

// Convert IEEE float32 PCM → int16 PCM (mono in, mono out).
function float32ToInt16Mono(buf, channels) {
  const frameSize = 4 * channels;
  const frames = Math.floor(buf.length / frameSize);
  const out = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      sum += buf.readFloatLE(i * frameSize + c * 4);
    }
    const avg = sum / channels;
    const clamped = Math.max(-1, Math.min(1, avg));
    out.writeInt16LE(Math.round(clamped * 32767), i * 2);
  }
  return out;
}

// Convert multi-channel int16 PCM → mono int16 PCM.
function int16ToMono(buf, channels) {
  if (channels === 1) return buf;
  const frameSize = 2 * channels;
  const frames = Math.floor(buf.length / frameSize);
  const out = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      sum += buf.readInt16LE(i * frameSize + c * 2);
    }
    out.writeInt16LE(Math.round(sum / channels), i * 2);
  }
  return out;
}

// Linear-interpolation resampler for int16 mono PCM.
function resampleInt16Mono(buf, srcRate, dstRate) {
  if (srcRate === dstRate) return buf;
  const srcSamples = buf.length / 2;
  const ratio = srcRate / dstRate;
  const dstSamples = Math.floor(srcSamples / ratio);
  const out = Buffer.alloc(dstSamples * 2);
  for (let i = 0; i < dstSamples; i++) {
    const srcPos = i * ratio;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(i0 + 1, srcSamples - 1);
    const frac = srcPos - i0;
    const s0 = buf.readInt16LE(i0 * 2);
    const s1 = buf.readInt16LE(i1 * 2);
    const interp = Math.round(s0 + (s1 - s0) * frac);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, interp)), i * 2);
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const text = body.message?.text || body.text || '';
    const targetSampleRate = Number(body.message?.sampleRate || body.sampleRate || 24000);
    const speakerId = Number(body.message?.voice ?? body.voice ?? process.env.SESAME_SPEAKER ?? 0);

    console.log('[tts] req:', JSON.stringify({ text: text.slice(0, 80), targetSampleRate, speakerId }));

    if (!text.trim()) {
      const silenceFrames = Math.floor(targetSampleRate * 0.1); // ~100ms
      return res.status(200).send(Buffer.alloc(silenceFrames * 2));
    }

    const t0 = Date.now();
    const wavBuffer = await generateSesameAudio(text, speakerId);
    const wav = parseWav(wavBuffer);
    console.log('[tts] sesame wav:', JSON.stringify({
      format: wav.format,
      channels: wav.channels,
      sampleRate: wav.sampleRate,
      bitsPerSample: wav.bitsPerSample,
      dataBytes: wav.data.length
    }));

    // Convert to mono 16-bit PCM at Sesame's native rate.
    let pcm;
    if (wav.format === 3 && wav.bitsPerSample === 32) {
      pcm = float32ToInt16Mono(wav.data, wav.channels);
    } else if (wav.format === 1 && wav.bitsPerSample === 16) {
      pcm = int16ToMono(wav.data, wav.channels);
    } else {
      throw new Error('Unsupported WAV format=' + wav.format + ' bps=' + wav.bitsPerSample);
    }

    // Resample to Vapi's requested rate.
    pcm = resampleInt16Mono(pcm, wav.sampleRate, targetSampleRate);

    console.log('[tts] done in ' + (Date.now() - t0) + 'ms, ' + pcm.length + ' PCM bytes @ ' + targetSampleRate + 'Hz');

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', pcm.length);
    return res.status(200).send(pcm);
  } catch (e) {
    console.error('[tts] error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
