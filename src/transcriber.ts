import { config } from './config';
import { getCognitiveAccessToken } from './entraAuth';
import { logger } from './logger';

const MIN_AUDIO_BYTES = 32000; // 1 second at 16kHz, 16-bit mono
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;
function isTransientError(status: number): boolean {
  return status >= 500 || status === 429;
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callWhisper(formData: FormData): Promise<Response> {
  const headers: Record<string, string> =
    config.authMode === 'apikey'
      ? { 'api-key': config.whisperKey }
      : { Authorization: `Bearer ${await getCognitiveAccessToken()}` };

  return fetch(config.whisperEndpoint, {
    method: 'POST',
    headers,
    body: formData,
  });
}

/** Creates a WAV file buffer from raw PCM data. */
export function createWavBuffer(
  pcmData: Buffer,
  sampleRate: number,
  channels: number,
  bitsPerSample: number
): Buffer {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcmData.length;
  const fileSize = 36 + dataSize;

  const header = Buffer.alloc(44);

  // RIFF chunk
  header.write('RIFF', 0);
  header.writeUInt32LE(fileSize, 4);
  header.write('WAVE', 8);

  // fmt sub-chunk
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);

  // data sub-chunk
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmData]);
}

/** Transcribes raw PCM16 16kHz mono audio via Azure OpenAI Whisper. */
export async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
  if (audioBuffer.length < MIN_AUDIO_BYTES) {
    logger.info({ bytes: audioBuffer.length }, 'Audio too short, skipping');
    return '';
  }

  try {
    const wavBuffer = createWavBuffer(audioBuffer, 16000, 1, 16);

    const formData = new FormData();
    const uint8 = new Uint8Array(wavBuffer.byteLength);
    uint8.set(wavBuffer);
    const blob = new Blob([uint8], { type: 'audio/wav' });
    formData.append('file', blob, 'audio.wav');
    formData.append('response_format', 'text');

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await callWhisper(formData);
        const responseText = !response.ok ? await response.text() : '';

        if (!response.ok) {
          if (isTransientError(response.status) && attempt < MAX_RETRIES) {
            logger.warn({ status: response.status, attempt }, 'Whisper API transient error, retrying');
            await delay(RETRY_DELAY_MS);
            continue;
          }
          logger.error({ status: response.status, errorText: responseText }, 'Whisper API error');
          return '';
        }

        const text = await response.text();
        return text.trim();
      } catch (err) {
        if (attempt < MAX_RETRIES) {
          logger.warn({ err, attempt }, 'Whisper API network error, retrying');
          await delay(RETRY_DELAY_MS);
          continue;
        }
        logger.error({ err }, 'Transcription failed');
        return '';
      }
    }
    return '';
  } catch (err) {
    logger.error({ err }, 'Transcription failed unexpectedly');
    return '';
  }
}

/** Manages per-meeting transcript text accumulation. */
export class TranscriptAccumulator {
  private transcripts = new Map<string, string[]>();

  append(meetingId: string, text: string): void {
    if (!this.transcripts.has(meetingId)) {
      this.transcripts.set(meetingId, []);
    }
    this.transcripts.get(meetingId)!.push(text);
  }

  getAndClear(meetingId: string): string {
    const parts = this.transcripts.get(meetingId);
    if (!parts || parts.length === 0) {
      return '';
    }
    const result = parts.join(' ');
    this.transcripts.set(meetingId, []);
    return result;
  }

  get(meetingId: string): string {
    const parts = this.transcripts.get(meetingId);
    if (!parts || parts.length === 0) {
      return '';
    }
    return parts.join(' ');
  }

  remove(meetingId: string): void {
    this.transcripts.delete(meetingId);
  }
}

export const transcriptAccumulator = new TranscriptAccumulator();
