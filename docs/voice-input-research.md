# Voice Input Research: Adding Speech-to-Text to Emdash

## Context

Emdash is a local Electron app where users bring their own API keys/subscriptions. Voice input must work independently of any CLI coding agent — it's a UI-level feature that captures speech, transcribes it, and injects the resulting text into the prompt input or terminal. This document evaluates all viable approaches.

---

## 1. Web Speech API (Not Viable)

The `webkitSpeechRecognition` API relies on a Google API key baked into Chrome. Electron does **not** have access to this key, so the API fails immediately with a network error. This is a [long-standing Electron issue](https://github.com/electron/electron/issues/46143) with no fix. **Do not pursue this path.**

---

## 2. Audio Capture in Electron

Before evaluating STT engines, the app needs to capture microphone audio. Two approaches work:

### Approach A: `getUserMedia` in the Renderer (Recommended)

```typescript
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
// Use AudioWorkletNode to downsample to 16kHz mono 16-bit PCM
// Send chunks to main process via IPC for STT processing
```

- Works on macOS, Windows, Linux
- Standard web API, well-supported in Electron
- macOS requires `NSMicrophoneUsageDescription` in `Info.plist` (already needed for Electron)
- Can use `MediaRecorder` for encoding, or `AudioWorkletNode` for raw PCM

### Approach B: `node-record-lpcm16` in the Main Process

- Records 16-bit LPCM directly from Node.js
- Depends on system tools (`sox`, `arecord`, `rec`)
- More complex to bundle cross-platform
- Better suited for headless/CLI apps

**Recommendation:** Use Approach A. It follows web standards, works in the renderer where the UI lives, and avoids bundling native recording tools.

---

## 3. STT Engine Options

### 3a. Cloud APIs (User Brings Their Own Key)

Since users already bring their own API keys for coding agents, the same pattern works for STT.

| Provider | Cost/min | Streaming | Free Tier | npm Package |
|----------|----------|-----------|-----------|-------------|
| **OpenAI Whisper** | $0.006 | No | $5 credit | `openai` |
| **OpenAI gpt-4o-mini-transcribe** | $0.003 | No | same | `openai` |
| **Deepgram Nova-3** | $0.004-0.008 | Yes (WebSocket) | Yes | `@deepgram/sdk` |
| **AssemblyAI** | $0.0025 | Yes | Yes | `assemblyai` |
| **Google Cloud STT** | $0.016 | Yes | 60 min/mo | `@google-cloud/speech` |
| **Azure Speech** | $0.017 | Yes | 5 hrs/mo | `microsoft-cognitiveservices-speech-sdk` |
| **AWS Transcribe** | $0.024 | Yes ($0.030) | 60 min/mo (1yr) | `@aws-sdk/client-transcribe` |

**Key observations:**
- **OpenAI Whisper API** is the easiest win — many users already have an `OPENAI_API_KEY` configured. Simple REST call with an audio file. No streaming, but for "push-to-talk" dictation (record, stop, transcribe) this is fine.
- **Deepgram** is the best option for real-time streaming at a reasonable price. WebSocket-based, per-second billing.
- **AssemblyAI** is cheapest per minute and has streaming support.

### 3b. Local/On-Device Options

These leverage the user's local machine — no API key or internet needed.

#### whisper.cpp (Best local option for accuracy)

C/C++ port of OpenAI Whisper, optimized for CPU. Multiple Node.js bindings available:

| Model | Params | Disk Size | RAM | Word Error Rate |
|-------|--------|-----------|-----|-----------------|
| tiny | 39M | ~75 MB | ~273 MB | ~12% |
| base | 74M | ~142 MB | ~388 MB | ~8% |
| small | 244M | ~466 MB | ~852 MB | ~5% |
| medium | 769M | ~1.5 GB | ~2.1 GB | ~4% |
| large-v3 | 1.55B | ~2.9 GB | ~3.9 GB | ~2.7% |
| turbo | 809M | ~1.5 GB | ~2 GB | Near-large accuracy, faster |

**npm packages:**
- `nodejs-whisper` — Well-maintained, auto-downloads models, supports CUDA
- `@lumen-labs-dev/whisper-node` — Most feature-rich: VAD, diarization, prebuilt Windows binaries
- `whisper-node` — Simpler, less maintained

**Tradeoffs:** Batch-only (no real-time streaming). User records, stops, then waits for transcription. The `tiny` model transcribes in ~1-2 seconds on modern hardware for short utterances. Requires native compilation step (or prebuilt binaries via `@lumen-labs-dev`).

#### Vosk (Best local option for streaming)

Open-source offline STT with real-time streaming support and <500ms latency.

- **npm:** `vosk` (official)
- **Models:** Small models from ~50MB, large models ~1-2GB. 20+ languages.
- **Advantage over whisper.cpp:** Native streaming API — results appear as user speaks
- **Tradeoff:** Lower accuracy than Whisper on long-form audio
- **Platform:** macOS, Linux, Windows

#### Picovoice Leopard/Cheetah (Commercial)

- Tiny models (<20MB), good accuracy, real-time streaming (Cheetah)
- **npm:** `@picovoice/leopard-node`, `@picovoice/cheetah-node`
- **Tradeoff:** Commercial licensing required for production; limited language support
- **Interesting for:** If Emdash wanted to bundle a very small, fast local engine

#### Transformers.js (Browser WASM)

- Runs Whisper models via WASM/WebGPU in the renderer process
- No native compilation needed
- Slower than native whisper.cpp
- Could be a fallback when users don't want to install native dependencies

### 3c. OS-Level Dictation (Limited Utility)

- **macOS Dictation:** No public API. Users can use system-wide Fn+Fn shortcut which types into any focused text field — works in Electron inputs automatically, but is outside app control.
- **Windows Dictation:** Users can use Win+H system-wide. Same limitation.
- **Linux:** No built-in OS dictation API.

These aren't programmatically accessible, but users already have them available. Emdash could document this as a "zero-config" option.

---

## 4. Recommended Architecture for Emdash

### Design Principle: Layered Approach

Given Emdash's "bring your own key" model, the best approach is a **tiered system** that leverages what users already have:

```
┌─────────────────────────────────────────────────┐
│  Voice Input Button (Renderer)                  │
│  ┌───────────────────────────────────────────┐  │
│  │  Audio Capture: getUserMedia + AudioWorklet│  │
│  └──────────────────┬────────────────────────┘  │
│                     │ PCM chunks via IPC         │
│  ┌──────────────────▼────────────────────────┐  │
│  │  STT Engine Router (Main Process)          │  │
│  │                                            │  │
│  │  ┌─────────┐ ┌──────────┐ ┌────────────┐ │  │
│  │  │ OpenAI  │ │ Deepgram │ │ whisper.cpp │ │  │
│  │  │ Whisper │ │ Streaming│ │ (local)    │ │  │
│  │  │ API     │ │ API      │ │            │ │  │
│  │  └─────────┘ └──────────┘ └────────────┘ │  │
│  └──────────────────┬────────────────────────┘  │
│                     │ transcribed text           │
│  ┌──────────────────▼────────────────────────┐  │
│  │  Text injection into prompt/terminal       │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### Tier 1: Cloud API (Simplest, Most Accurate)

**Auto-detect user's existing API keys.** If a user has `OPENAI_API_KEY` set (which many Emdash users will), voice input can work immediately:

1. User clicks mic button / holds push-to-talk key
2. Audio captured via `getUserMedia` in renderer
3. On stop, audio sent to main process via IPC
4. Main process calls OpenAI Whisper API (`POST /v1/audio/transcriptions`)
5. Transcribed text returned to renderer and inserted into prompt input

**Implementation effort:** Low. The `openai` npm package is likely already available or trivially added. The API call is ~5 lines of code.

**How this fits Emdash's model:** Users already configure `OPENAI_API_KEY` for Codex and other agents. The same key works for Whisper API. No new subscription needed.

**Additional cloud providers** (Deepgram, AssemblyAI, etc.) can be added as options in settings for users who prefer them or want streaming transcription.

### Tier 2: Local whisper.cpp (Privacy-First, Offline)

For users who don't want audio leaving their machine:

1. User selects "Local (Whisper)" in voice settings
2. On first use, app downloads the chosen model (~75MB for tiny, ~142MB for base)
3. Audio processed locally via `nodejs-whisper` or `@lumen-labs-dev/whisper-node`
4. No API key needed

**Implementation effort:** Medium. Requires native module compilation (similar to existing `node-pty` and `sqlite3` dependencies) and model management.

### Tier 3: Local Vosk (Streaming + Offline)

For users who want real-time streaming transcription without cloud:

1. User selects "Local (Vosk)" in voice settings
2. App downloads Vosk model (~50MB for small)
3. Real-time transcription as user speaks
4. No API key needed

### Settings Integration

Following Emdash's existing patterns:

```typescript
// In AppSettings (src/main/settings.ts)
voice?: {
  enabled: boolean;
  engine: 'openai' | 'deepgram' | 'assemblyai' | 'whisper-local' | 'vosk-local';
  whisperModel?: 'tiny' | 'base' | 'small' | 'medium' | 'large-v3';
  language?: string;      // ISO 639-1 code, default 'en'
  pushToTalk?: boolean;   // vs toggle mode
  hotkey?: string;        // keyboard shortcut
};
```

API keys would use the existing `providerConfigs` pattern — users configure `OPENAI_API_KEY`, `DEEPGRAM_API_KEY`, etc. in the same way they configure agent API keys today.

### IPC Pattern

Following the existing PTY data streaming pattern:

```typescript
// Main process - voice IPC handlers
ipcMain.handle('voice:transcribe', async (_event, audioBuffer: ArrayBuffer, engine: string) => {
  // Route to appropriate STT engine
  return { success: true, data: { text: transcribedText } };
});

// For streaming engines (Vosk, Deepgram)
// Use webContents.send('voice:partial', { text }) for partial results
```

### UI Components Needed

1. **Mic button** in the chat input area (next to send button)
2. **VoiceSettingsCard** in Settings page (engine selection, model choice, hotkey config)
3. **Recording indicator** (visual feedback while recording)
4. **Partial transcription overlay** (for streaming engines — shows text as it's recognized)

---

## 5. Implementation Priority

### Phase 1: MVP (Cloud API)
- Add mic button to chat input
- Capture audio via `getUserMedia` + `MediaRecorder` (WebM/Opus format)
- Send to OpenAI Whisper API using user's existing `OPENAI_API_KEY`
- Insert transcribed text into prompt input
- Add `voice` section to settings with engine selection
- **Estimated scope:** ~5-8 files changed

### Phase 2: More Cloud Options
- Add Deepgram support (with real-time streaming via WebSocket)
- Add AssemblyAI support
- Push-to-talk hotkey (global shortcut)

### Phase 3: Local/Offline
- Integrate whisper.cpp via `nodejs-whisper` or `@lumen-labs-dev/whisper-node`
- Model download manager (progress indicator, model selection)
- Integrate Vosk for real-time local streaming

### Phase 4: Polish
- Voice activity detection (auto-stop on silence)
- Noise cancellation hints
- Per-task voice language setting
- Keyboard shortcut customization

---

## 6. Key Technical Considerations

### Microphone Permissions
- **macOS:** Requires `NSMicrophoneUsageDescription` in `Info.plist`. Electron handles the permission prompt automatically.
- **Windows/Linux:** No special permissions needed beyond standard Electron.
- Use `navigator.permissions.query({ name: 'microphone' })` to check permission state.

### Audio Format
- For cloud APIs: `MediaRecorder` output (WebM/Opus) works with OpenAI, Deepgram, and most others
- For local engines: Need to downsample to 16kHz mono 16-bit PCM via `AudioWorkletNode`
- Consider using `AudioContext.createMediaStreamSource()` + downsampling worklet for universal format

### Bundle Size Impact
- Cloud-only approach: Negligible (just API client code)
- whisper.cpp: +~2-5MB for the native module (models downloaded separately on first use)
- Vosk: +~5-10MB for the native module (models downloaded separately)

### Security
- Audio data for cloud APIs goes over HTTPS
- Local engines keep audio on-device
- API keys stored using existing `providerConfigs` pattern (settings.json)
- No audio is stored persistently — only the transcribed text

---

## 7. Summary

| Approach | Accuracy | Latency | Privacy | Cost | Implementation Effort |
|----------|----------|---------|---------|------|----------------------|
| OpenAI Whisper API | Excellent | 1-3s | Cloud | $0.006/min | Low |
| Deepgram (streaming) | Excellent | <500ms | Cloud | $0.004-0.008/min | Medium |
| whisper.cpp local | Good-Excellent | 1-5s | Local | Free | Medium |
| Vosk local | Good | <500ms | Local | Free | Medium |
| OS dictation | Varies | Real-time | Local | Free | None (already available) |

**The recommended path:** Start with OpenAI Whisper API (Tier 1) since it requires the least new infrastructure and leverages API keys users already have. Add local whisper.cpp as a Phase 3 privacy-first alternative. The architecture should be engine-agnostic from the start so new backends can be plugged in easily.
