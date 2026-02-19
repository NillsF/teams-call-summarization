import { Response } from 'express';
import { logger } from './logger';

interface DemoEvent {
  type: 'transcript' | 'summary' | 'status' | 'error' | 'call-answered';
  data: string | Record<string, unknown>;
  timestamp: string;
}

const clients = new Map<string, Response[]>();

export function addSseClient(meetingId: string, res: Response): void {
  if (!clients.has(meetingId)) {
    clients.set(meetingId, []);
  }
  clients.get(meetingId)!.push(res);
  res.on('close', () => {
    const arr = clients.get(meetingId);
    if (arr) {
      const idx = arr.indexOf(res);
      if (idx !== -1) arr.splice(idx, 1);
      if (arr.length === 0) clients.delete(meetingId);
    }
  });
}

export function broadcastEvent(meetingId: string, event: DemoEvent): void {
  const arr = clients.get(meetingId);
  if (!arr || arr.length === 0) return;
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of arr) {
    try {
      res.write(payload);
    } catch {
      logger.warn({ meetingId }, 'Failed to write SSE event');
    }
  }
}

export function broadcastAll(event: DemoEvent): void {
  for (const meetingId of clients.keys()) {
    broadcastEvent(meetingId, event);
  }
}
