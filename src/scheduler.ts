import { ConversationReference } from 'botbuilder';
import { config } from './config';
import { logger } from './logger';
import { getAndClearAudioBuffer, hasAudioData, removeAudioBuffer } from './audioStreamHandler';
import { transcribeAudio, transcriptAccumulator } from './transcriber';
import { summarizeTranscript } from './summarizer';
import { postSummaryToChat } from './chatPoster';

interface ActiveMeeting {
  conversationId: string;
  serverCallId: string;
  conversationReference: Partial<ConversationReference>;
  transcriptionTimer: NodeJS.Timeout;
  summaryTimer: NodeJS.Timeout;
}

const TRANSCRIPTION_INTERVAL_MS = 30_000;

export class MeetingScheduler {
  private meetings = new Map<string, ActiveMeeting>();

  startMeeting(
    conversationId: string,
    serverCallId: string,
    conversationReference: Partial<ConversationReference>,
  ): void {
    if (this.meetings.has(conversationId)) {
      logger.warn({ conversationId }, 'Meeting already active, stopping first');
      this.stopMeeting(conversationId);
    }

    const transcriptionTimer = setInterval(() => {
      this.processTranscription(conversationId, serverCallId).catch((err) => {
        logger.error({ err, conversationId }, 'Transcription error');
      });
    }, TRANSCRIPTION_INTERVAL_MS);

    const summaryIntervalMs = config.summaryIntervalMinutes * 60 * 1000;
    const summaryTimer = setInterval(() => {
      this.processSummary(conversationId, conversationReference).catch((err) => {
        logger.error({ err, conversationId }, 'Summary error');
      });
    }, summaryIntervalMs);

    this.meetings.set(conversationId, {
      conversationId,
      serverCallId,
      conversationReference,
      transcriptionTimer,
      summaryTimer,
    });

    logger.info({ conversationId, summaryIntervalMinutes: config.summaryIntervalMinutes }, 'Started meeting');
  }

  stopMeeting(conversationId: string): void {
    const meeting = this.meetings.get(conversationId);
    if (!meeting) {
      logger.warn({ conversationId }, 'No active meeting found');
      return;
    }

    clearInterval(meeting.transcriptionTimer);
    clearInterval(meeting.summaryTimer);
    removeAudioBuffer(meeting.serverCallId);
    transcriptAccumulator.remove(conversationId);
    this.meetings.delete(conversationId);

    logger.info({ conversationId }, 'Stopped meeting');
  }

  getActiveMeetings(): string[] {
    return Array.from(this.meetings.keys());
  }

  stopAll(): void {
    logger.info({ count: this.meetings.size }, 'Stopping all meetings');
    for (const conversationId of this.meetings.keys()) {
      this.stopMeeting(conversationId);
    }
  }

  private async processTranscription(conversationId: string, serverCallId: string): Promise<void> {
    if (!hasAudioData(serverCallId)) {
      return;
    }

    logger.info({ conversationId }, 'Processing transcription');
    const audioBuffer = getAndClearAudioBuffer(serverCallId);
    if (!audioBuffer) {
      return;
    }

    const text = await transcribeAudio(audioBuffer);
    if (text) {
      transcriptAccumulator.append(conversationId, text);
      logger.info({ conversationId, chars: text.length }, 'Transcribed audio');
    }
  }

  private async processSummary(
    conversationId: string,
    conversationReference: Partial<ConversationReference>,
  ): Promise<void> {
    const transcriptText = transcriptAccumulator.getAndClear(conversationId);
    if (!transcriptText) {
      logger.info({ conversationId }, 'No transcript to summarize');
      return;
    }

    logger.info({ conversationId, chars: transcriptText.length }, 'Summarizing transcript');
    const summary = await summarizeTranscript(transcriptText);
    await postSummaryToChat(conversationReference, summary, config.summaryIntervalMinutes);
    logger.info({ conversationId }, 'Posted summary');
  }
}

export const meetingScheduler = new MeetingScheduler();
