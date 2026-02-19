import express, { Request, Response, NextFunction } from 'express';
import { config } from './config';
import { logger } from './logger';
import { MeetingSummarizerBot } from './bot';
import { joinMeeting, handleCallbackEvent, activeCalls } from './callAutomation';
import { createAudioStreamServer } from './audioStreamHandler';
import { adapter } from './chatPoster';
import { meetingScheduler } from './scheduler';

const app = express();
app.use(express.json());

const bot = new MeetingSummarizerBot();

bot.setOnMeetingJoinCallback(async (conversationId, joinUrl, conversationReference) => {
  const result = await joinMeeting(joinUrl);
  const serverCallId = activeCalls.get(result.callConnectionId)?.serverCallId ?? '';
  meetingScheduler.startMeeting(conversationId, serverCallId, conversationReference);
  logger.info({ conversationId, callConnectionId: result.callConnectionId }, 'Joined meeting');
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
