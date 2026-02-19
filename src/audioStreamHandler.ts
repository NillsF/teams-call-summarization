import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { StreamingData, type AudioData, type AudioMetadata } from '@azure/communication-call-automation';
import { logger } from './logger';

// Global audio buffer: single buffer for all incoming audio (one call at a time)
// Keyed by a connection identifier derived from the WebSocket
let activeConnectionId = '';
const audioBuffers = new Map<string, Buffer[]>();

/**
 * Creates a WebSocket server attached to an existing HTTP server
 * for receiving ACS media streaming audio.
 */
export function createAudioStreamServer(server: http.Server, path: string): WebSocketServer {
  const wss = new WebSocketServer({ server, path });

  wss.on('connection', (ws: WebSocket) => {
    const connId = `ws-${Date.now()}`;
    activeConnectionId = connId;
    audioBuffers.set(connId, []);
    logger.info({ path, connId }, 'WebSocket connection established');

    ws.on('message', (data: Buffer | string) => {
      try {
        const raw = typeof data === 'string' ? data : data.toString('utf-8');
        const parsed = StreamingData.parse(raw);
        const kind = StreamingData.getStreamingKind();

        if (kind === 'AudioMetadata') {
          const meta = parsed as AudioMetadata;
          logger.info({ connId, encoding: meta.encoding, sampleRate: meta.sampleRate, channels: meta.channels }, 'Audio metadata received');
          return;
        }

        if (kind === 'AudioData') {
          const audio = parsed as AudioData;

          if (audio.isSilent) {
            return;
          }

          const pcmBuffer = Buffer.from(audio.data, 'base64');

          if (!audioBuffers.has(connId)) {
            audioBuffers.set(connId, []);
          }
          audioBuffers.get(connId)!.push(pcmBuffer);

          const chunks = audioBuffers.get(connId)!;
          const totalBytes = chunks.reduce((sum, b) => sum + b.length, 0);
          if (chunks.length % 100 === 0) {
            logger.info({ connId, totalBytes, chunks: chunks.length }, 'Audio buffering progress');
          }
        }
      } catch (err) {
        logger.error({ err }, 'Error parsing audio stream message');
      }
    });

    ws.on('close', () => {
      logger.info({ connId }, 'WebSocket connection closed');
    });

    ws.on('error', (err: Error) => {
      logger.error({ err, connId }, 'WebSocket error');
    });
  });

  logger.info({ path }, 'WebSocket server created');
  return wss;
}

/** Returns concatenated audio buffer for a call and clears it.
 *  Accepts serverCallId for API compat but uses the active WS connection. */
export function getAndClearAudioBuffer(_serverCallId: string): Buffer | null {
  // Try active connection first, then fall back to any buffer with data
  const connId = activeConnectionId;
  let chunks = audioBuffers.get(connId);
  if (!chunks || chunks.length === 0) {
    // Search all buffers
    for (const [id, bufs] of audioBuffers) {
      if (bufs.length > 0) {
        chunks = bufs;
        break;
      }
    }
  }
  if (!chunks || chunks.length === 0) {
    return null;
  }
  const combined = Buffer.concat(chunks);
  chunks.length = 0; // clear in place
  logger.info({ bytes: combined.length }, 'Returned and cleared audio buffer');
  return combined;
}

/** Check if there's buffered audio for a call. */
export function hasAudioData(_serverCallId: string): boolean {
  for (const [, chunks] of audioBuffers) {
    if (chunks.length > 0) return true;
  }
  return false;
}

/** Cleanup buffer when a call ends. */
export function removeAudioBuffer(_serverCallId: string): void {
  audioBuffers.clear();
  logger.info('Removed all audio buffers');
}
