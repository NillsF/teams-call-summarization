import {
  CallAutomationClient,
  CallConnection,
  CallMedia,
  DtmfTone,
  parseCallAutomationEvent,
  type CallAutomationEvent,
  type MediaStreamingOptions,
  type AnswerCallOptions,
} from '@azure/communication-call-automation';
import { type PhoneNumberIdentifier } from '@azure/communication-common';
import { config } from './config';
import { logger } from './logger';

const acsClient = new CallAutomationClient(config.acsConnectionString);

/** Tracks active calls: key → { callConnectionId, serverCallId, callerPhone } */
export const activeCalls = new Map<
  string,
  { callConnectionId: string; serverCallId: string; callerPhone?: string }
>();

/**
 * Answer an incoming call (from EventGrid IncomingCall event) and start audio media streaming.
 */
export async function answerIncomingCall(
  incomingCallContext: string,
  callerPhone?: string,
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
    enableBidirectional: true,
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
    callerPhone,
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

/** Send DTMF tone "1" to the caller to accept the Teams meeting "press 1 to join" prompt. */
async function sendDtmfToJoin(callConnectionId: string): Promise<void> {
  const callData = activeCalls.get(callConnectionId);
  if (!callData?.callerPhone) {
    logger.warn({ callConnectionId }, 'No caller phone to send DTMF to, skipping');
    return;
  }

  // Small delay to let the IVR prompt play
  await new Promise(resolve => setTimeout(resolve, 3000));

  const callConnection = acsClient.getCallConnection(callConnectionId);
  const callMedia = callConnection.getCallMedia();
  const target: PhoneNumberIdentifier = { phoneNumber: callData.callerPhone };

  logger.info({ callConnectionId, target: callData.callerPhone }, 'Sending DTMF tone 1 to join meeting');
  await callMedia.sendDtmfTones([DtmfTone.One], target);
  logger.info({ callConnectionId }, 'DTMF tone 1 sent successfully');
}
export function handleCallbackEvent(event: Record<string, unknown>): void {
  // Log raw event for debugging
  logger.info({ rawEvent: JSON.stringify(event).substring(0, 500) }, 'Callback event received');

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
      // Send DTMF tone "1" to join the Teams meeting (Teams prompts "press 1 to join")
      sendDtmfToJoin(parsed.callConnectionId).catch(err =>
        logger.error({ err }, 'Failed to send DTMF join tone')
      );
      break;

    case 'CallDisconnected':
      logger.info({ callConnectionId: parsed.callConnectionId, resultInformation: parsed.resultInformation }, 'Call disconnected');
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
