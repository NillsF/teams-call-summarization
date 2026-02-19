import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { logger } from './logger';

// Per-call audio buffer: serverCallId -> array of PCM chunks
const audioBuffers = new Map<string, Buffer[]>();

interface AcsAudioData {
  kind: 'AudioData';
  audioData: {
    data: string;
    timestamp: string;
    participantRawID: string;
    silent: boolean;
  };
  serverCallId: string;
}

interface AcsAudioMetadata {
  kind: 'AudioMetadata';
  [key: string]: unknown;
}

type AcsMediaMessage = AcsAudioData | AcsAudioMetadata;

/**
 * Creates a WebSocket server attached to an existing HTTP server
 * for receiving ACS media streaming audio.
 */
export function createAudioStreamServer(server: http.Server, path: string): WebSocketServer {
  const wss = new WebSocketServer({ server, path });

  wss.on('connection', (ws: WebSocket) => {
    logger.info({ path }, 'WebSocket connection established');

    ws.on('message', (data: Buffer | string) => {
      try {
        const message: AcsMediaMessage = JSON.parse(
          typeof data === 'string' ? data : data.toString('utf-8')
        );

        if (message.kind === 'AudioMetadata') {
          logger.debug('Received AudioMetadata, ignoring');
          return;
        }

        if (message.kind === 'AudioData') {
          const { serverCallId, audioData } = message as AcsAudioData;

          if (audioData.silent) {
            return;
          }

          const pcmBuffer = Buffer.from(audioData.data, 'base64');

          if (!audioBuffers.has(serverCallId)) {
            audioBuffers.set(serverCallId, []);
          }
          audioBuffers.get(serverCallId)!.push(pcmBuffer);

          const chunks = audioBuffers.get(serverCallId)!;
          const totalBytes = chunks.reduce((sum, b) => sum + b.length, 0);
          logger.debug({ serverCallId, bytes: pcmBuffer.length, totalBytes, chunks: chunks.length }, 'Buffered audio');
        }
      } catch (err) {
        logger.error({ err }, 'Error parsing audio stream message');
      }
    });

    ws.on('close', () => {
      logger.info('WebSocket connection closed');
    });

    ws.on('error', (err: Error) => {
      logger.error({ err }, 'WebSocket error');
    });
  });

  logger.info({ path }, 'WebSocket server created');
  return wss;
}

/** Returns concatenated audio buffer for a call and clears it. */
export function getAndClearAudioBuffer(serverCallId: string): Buffer | null {
  const chunks = audioBuffers.get(serverCallId);
  if (!chunks || chunks.length === 0) {
    return null;
  }
  const combined = Buffer.concat(chunks);
  audioBuffers.set(serverCallId, []);
  logger.debug({ serverCallId, bytes: combined.length }, 'Returned and cleared audio buffer');
  return combined;
}

/** Check if there's buffered audio for a call. */
export function hasAudioData(serverCallId: string): boolean {
  const chunks = audioBuffers.get(serverCallId);
  return !!chunks && chunks.length > 0;
}

/** Cleanup buffer when a call ends. */
export function removeAudioBuffer(serverCallId: string): void {
  audioBuffers.delete(serverCallId);
  logger.info({ serverCallId }, 'Removed audio buffer');
}
