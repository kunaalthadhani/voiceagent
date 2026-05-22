# Sesame ↔ Vapi MVP — Real Estate Voice Agent (Layla)

A custom TTS bridge that lets Vapi use Sesame CSM-1B (via Replicate) as its voice provider.
Vapi handles telephony, STT, LLM, and turn-taking. This repo is just the TTS webhook.

---

## Architecture

```
Vapi call → Vapi LLM → POST /api/tts (this) → Replicate Sesame CSM-1B → raw PCM → Vapi → caller
```

---

## Deployment

### 1. Deploy to Vercel

```bash
cd sesame-vapi-mvp
git init
git add .
git commit -m "initial commit"
# Push to GitHub, then import the repo at https://vercel.com/new and deploy.
```

You'll get a URL like `https://sesame-vapi-mvp.vercel.app`. The TTS endpoint is `/api/tts`.

### 2. Replicate setup

1. Sign up at https://replicate.com
2. Generate an API token: https://replicate.com/account/api-tokens
3. In Vercel → Project Settings → Environment Variables, add `REPLICATE_API_TOKEN`
4. Confirm model availability at https://replicate.com/sesame/csm-1b
5. Redeploy so the env var takes effect

### 3. Sanity-test the endpoint

```bash
curl -X POST https://sesame-vapi-mvp.vercel.app/api/tts \
  -H "Content-Type: application/json" \
  -d '{"message":{"text":"Hello, this is a test."}}' \
  --output test.pcm
```

First call may take 30+ seconds (cold start). You should get a ~50–200 KB binary back.

Troubleshooting:
- `REPLICATE_API_TOKEN not set` → env var missing or not redeployed
- `Replicate 422` → Sesame input field names changed; check the model page
- Timeout → cold start exceeded 60s; retry

### 4. Vapi setup

1. Sign up at https://vapi.ai
2. Create Assistant:
   - Name: `Layla — Real Estate Qualifier`
   - Model: GPT-4o-mini or Claude Haiku
   - First Message: leave blank
   - System Prompt: paste the Layla prompt (see CLAUDE.md section 5)
3. Voice section:
   - Provider: **Custom Voice**
   - URL: `https://sesame-vapi-mvp.vercel.app/api/tts`
   - Method: POST
4. Dynamic Variables: declare `lead_name`, `property`, `brokerage`
5. Save

### 5. Phone number

Vapi → Phone Numbers → buy a Vapi-managed number (~$2/mo, instant).

### 6. Test

- Browser: dashboard → assistant → "Talk to assistant"
- Phone: Phone Numbers → "Make outbound call" → enter your number

---

## Pre-demo warmup

Sesame goes cold after ~5 min idle. Run this ~30s before any live demo:

```bash
curl -X POST https://sesame-vapi-mvp.vercel.app/api/tts \
  -H "Content-Type: application/json" \
  -d '{"message":{"text":"Warming up the demo."}}' \
  --output /dev/null
```

---

## Known limitations

- Latency: ~1–2s per response (vs ~300ms for ElevenLabs). Tradeoff for voice quality.
- English only. No Arabic in CSM-1B.
- Cold starts after idle = 30s+ pause. Warm up before demos.
- No CRM push, no Ziwo +971 caller ID — those are Phase 3.

---

## What's NOT in scope

Bitrix24, form webhook receiver, Ziwo SIP, retries, multi-language, WhatsApp fallback,
Pipecat/LiveKit, frontend. See CLAUDE.md section 9.
