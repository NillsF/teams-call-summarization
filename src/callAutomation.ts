import {
  CallAutomationClient,
  CallConnection,
  CallMedia,
  parseCallAutomationEvent,
  type CallAutomationEvent,
  type MediaStreamingOptions,
  type AnswerCallOptions,
} from '@azure/communication-call-automation';
import { config } from './config';
import { logger } from './logger';

const acsClient = new CallAutomationClient(config.acsConnectionString);

/** Tracks active calls: key → { callConnectionId, serverCallId } */
export const activeCalls = new Map<
  string,
  { callConnectionId: string; serverCallId: string }
>();

/**
 * Answer an incoming call (from EventGrid IncomingCall event) and start audio media streaming.
 */
export async function answerIncomingCall(
  incomingCallContext: string,
): Promise<{ callConnectionId: string; serverCallId: string }> {
  const callbackUrl = config.callbackUri + '/api/callbacks';
  const wsUrl =
    config.callbackUri.replace(/^https:\/\//i, 'wss://').replace(/^http:\/\//i, 'ws://') +
    '/ws/audio';

  const mediaStreamingOptions: MediaStreamingOptions = {
    transportUrl: wsUrl,
    transportType: 'websocket',
    contentType: 'audio',
    audioChannelType: 'mixed',
    startMediaStreaming: true,
    audioFormat: 'Pcm16KMono',
  };

  const options: AnswerCallOptions = {
    mediaStreamingOptions,
  };

  const callResult = await acsClient.answerCall(
    incomingCallContext,
    callbackUrl,
    options,
  );

  const props = callResult.callConnectionProperties;
  const callConnectionId = props.callConnectionId ?? '';
  const serverCallId = props.serverCallId ?? '';

  activeCalls.set(callConnectionId, {
    callConnectionId,
    serverCallId,
  });

  logger.info({ callConnectionId, serverCallId }, 'Answered incoming call');

  return { callConnectionId, serverCallId };
}

/** Hang up a call by its callConnectionId. */
export async function endCall(callConnectionId: string): Promise<void> {
  const callConnection: CallConnection =
    acsClient.getCallConnection(callConnectionId);
  await callConnection.hangUp(true);
  activeCalls.delete(callConnectionId);
  logger.info({ callConnectionId }, 'Ended call');
}

/** Handle ACS callback events (call connected, disconnected, media streaming, etc.). */
export function handleCallbackEvent(event: Record<string, unknown>): void {
  let parsed: CallAutomationEvent;
  try {
    parsed = parseCallAutomationEvent(event);
  } catch (err) {
    logger.error({ err }, 'Failed to parse callback event');
    return;
  }

  switch (parsed.kind) {
    case 'CallConnected':
      logger.info({ callConnectionId: parsed.callConnectionId, serverCallId: parsed.serverCallId }, 'Call connected');
      break;

    case 'CallDisconnected':
      logger.info({ callConnectionId: parsed.callConnectionId }, 'Call disconnected');
      activeCalls.delete(parsed.callConnectionId);
      break;

    case 'MediaStreamingStarted':
      logger.info({ callConnectionId: parsed.callConnectionId }, 'Media streaming started');
      break;

    case 'MediaStreamingStopped':
      logger.info({ callConnectionId: parsed.callConnectionId }, 'Media streaming stopped');
      break;

    case 'MediaStreamingFailed':
      logger.error({ callConnectionId: parsed.callConnectionId, resultInformation: parsed.resultInformation }, 'Media streaming failed');
      break;

    default:
      logger.info({ kind: parsed.kind }, 'Unhandled event kind');
      break;
  }
}
