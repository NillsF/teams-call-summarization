import express, { Request, Response, NextFunction } from 'express';
import { config } from './config';
import { logger } from './logger';
import { MeetingSummarizerBot } from './bot';
import { answerIncomingCall, handleCallbackEvent, activeCalls } from './callAutomation';
import { createAudioStreamServer } from './audioStreamHandler';
import { adapter } from './chatPoster';
import { meetingScheduler } from './scheduler';
import { addSseClient, broadcastEvent } from './demoSse';
import { transcriptAccumulator } from './transcriber';
import path from 'path';

const app = express();
app.use(express.json());

const bot = new MeetingSummarizerBot();

// Meeting join is now handled via EventGrid IncomingCall → answerCall flow
// See POST /api/eventgrid endpoint

// EventGrid webhook for ACS IncomingCall events
app.post('/api/eventgrid', async (req, res) => {
  const events = Array.isArray(req.body) ? req.body : [req.body];
  
  for (const event of events) {
    // EventGrid validation handshake
    if (event.eventType === 'Microsoft.EventGrid.SubscriptionValidationEvent') {
      const validationCode = event.data?.validationCode;
      logger.info({ validationCode }, 'EventGrid validation handshake');
      res.json({ validationResponse: validationCode });
      return;
    }
    
    // Handle IncomingCall
    if (event.eventType === 'Microsoft.Communication.IncomingCall') {
      const incomingCallContext = event.data?.incomingCallContext;
      if (!incomingCallContext) {
        logger.warn('IncomingCall event missing incomingCallContext');
        continue;
      }
      
      logger.info({ from: event.data?.from, to: event.data?.to }, 'Incoming call received');
      
      try {
        const callerPhone = event.data?.from?.phoneNumber?.value;
        const result = await answerIncomingCall(incomingCallContext, callerPhone);
        const meetingId = `call-${result.callConnectionId}`;
        
        // Auto-start the scheduler for this call
        const dummyRef = { conversation: { id: meetingId } } as any;
        meetingScheduler.startMeeting(meetingId, result.serverCallId, dummyRef);
        
        // Broadcast to any SSE demo clients
        broadcastEvent('global', { 
          type: 'call-answered', 
          data: { meetingId, callConnectionId: result.callConnectionId },
          timestamp: new Date().toISOString() 
        });
        
        logger.info({ meetingId, callConnectionId: result.callConnectionId }, 'Answered incoming call');
      } catch (err: any) {
        logger.error({ err }, 'Failed to answer incoming call');
      }
    }
  }
  
  res.sendStatus(200);
});

app.post('/api/messages', async (req, res) => {
  await adapter.process(req, res, (context) => bot.run(context));
});

app.post('/api/callbacks', async (req, res) => {
  const events = req.body;
  if (Array.isArray(events)) {
    for (const event of events) {
      handleCallbackEvent(event);
    }
  }
  res.sendStatus(200);
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', activeMeetings: meetingScheduler.getActiveMeetings() });
});

// ── Demo UI routes ──

app.get('/demo', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'demo.html'));
});

// Start a meeting via the demo UI (no Teams bot needed)
app.post('/api/demo/join', async (req, res) => {
  // The bot now works via EventGrid IncomingCall - no active join needed
  // Return instructions for the user
  res.json({ 
    message: 'Bot is listening for incoming calls via EventGrid. Add the ACS phone number to your Teams meeting, or the bot will auto-answer when called.',
    activeCalls: Array.from(activeCalls.keys())
  });
});

// Stop a demo meeting
app.post('/api/demo/stop', (req, res) => {
  const meetingId = req.body?.meetingId as string | undefined;
  if (meetingId) {
    meetingScheduler.stopMeeting(meetingId);
    broadcastEvent(meetingId, { type: 'status', data: 'Stopped', timestamp: new Date().toISOString() });
  }
  res.json({ ok: true });
});

app.get('/api/demo/status', (_req, res) => {
  const calls = Array.from(activeCalls.entries()).map(([id, data]) => ({
    callConnectionId: id,
    serverCallId: data.serverCallId,
  }));
  res.json({ activeCalls: calls, meetingCount: meetingScheduler.getActiveMeetings() });
});

app.get('/api/demo/events/global', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(`data: ${JSON.stringify({ type: 'status', data: 'Listening for incoming calls...', timestamp: new Date().toISOString() })}\n\n`);
  addSseClient('global', res);
});

// SSE stream for live transcript + summary events
app.get('/api/demo/events/:meetingId', (req, res) => {
  const { meetingId } = req.params;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(`data: ${JSON.stringify({ type: 'status', data: 'Connected', timestamp: new Date().toISOString() })}\n\n`);
  addSseClient(meetingId, res);
});

// Get current transcript for a meeting
app.get('/api/demo/transcript/:meetingId', (req, res) => {
  const text = transcriptAccumulator.get(req.params.meetingId);
  res.json({ transcript: text || '' });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, 'Unhandled express error');
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(config.port, () => {
  logger.info({ port: config.port }, 'Server running');
});

createAudioStreamServer(server, '/ws/audio');

const shutdown = () => {
  logger.info('Shutting down...');
  meetingScheduler.stopAll();
  server.close();
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled rejection');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});
