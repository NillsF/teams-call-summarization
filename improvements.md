# POC Improvement Recommendations

This document captures a focused improvement backlog for the current meeting summarizer POC.

## Priority 0 (Do First)

1. **Per-call audio isolation**
   - Replace global `activeConnectionId` and generic buffer fallback logic in `src/audioStreamHandler.ts` with call-scoped buffering keyed by call identity.
   - Update scheduler integration so `getAndClearAudioBuffer(serverCallId)` and `removeAudioBuffer(serverCallId)` operate on a single call only.
   - Why: current logic can mix audio across calls and clears all buffers on one stop event.

2. **Prevent overlapping async jobs**
   - Add per-meeting in-flight guards in `src/scheduler.ts` for transcription and summary jobs.
   - Why: `setInterval` can schedule a new run before the previous run completes, causing overlap and inconsistent state.

3. **Avoid transcript data loss on summary failure**
   - Change summary flow in `src/scheduler.ts` to clear transcript only after successful summarize/post.
   - Why: current `getAndClear()` before summarize can permanently drop transcript text if model/API calls fail.

4. **Harden public webhooks and demo endpoints**
   - Add strict request/event validation in `src/index.ts` for `/api/eventgrid` and `/api/callbacks`.
   - Protect `/api/demo/*` and SSE endpoints with simple auth in non-local environments.
   - Why: current endpoints are unauthenticated and trust input too broadly.

## Priority 1 (Security + Reliability)

1. **Reduce sensitive logging**
   - Stop logging raw callback payload snippets in `src/callAutomation.ts`; redact phone numbers and identifiers.

2. **Bound memory and add backpressure**
   - Add max buffered audio bytes + TTL eviction in `src/audioStreamHandler.ts`.
   - Add transcript size limits in `src/transcriber.ts` (`TranscriptAccumulator`).

3. **Improve timeout and retry strategy**
   - Add explicit timeouts for ACS operations in `src/callAutomation.ts`.
   - Use exponential backoff + jitter in `src/transcriber.ts` and `src/summarizer.ts`.

4. **Tighten config validation**
   - Validate numeric and URL config values in `src/config.ts` (e.g., summary interval bounds, callback URI format).

5. **Remove unsafe type casts**
   - Replace private map access cast in `src/bot.ts` (`as unknown as ...`) with explicit public accessor methods.

## Priority 2 (Maintainability)

1. **Align runtime behavior and docs**
   - README usage still emphasizes message commands/join URL flow while runtime primarily uses EventGrid incoming calls.
   - Update README so POC usage matches the actual running architecture.

2. **Modularize server composition**
   - Split `src/index.ts` into route modules and service wiring for easier testing and clearer ownership boundaries.

3. **Add core automated tests**
   - Add unit tests for scheduler behavior, audio buffer lifecycle, and auth/config validation.
   - Add focused integration tests for webhook parsing and summarization loop control.

4. **Add basic operational metrics**
   - Track per-call counters/latency for buffering, transcription, summarization, and failures to simplify troubleshooting.

---

These recommendations are intentionally scoped to improving the current POC without changing the core product behavior.
