import {
  TeamsActivityHandler,
  TurnContext,
  ConversationReference,
  ChannelAccount,
} from 'botbuilder';

export interface MeetingSession {
  conversationReference: Partial<ConversationReference>;
  meetingJoinUrl?: string;
}

type OnMeetingJoinCallback = (
  conversationId: string,
  joinUrl: string,
  conversationReference: Partial<ConversationReference>
) => Promise<void>;

const MEETING_URL_REGEX =
  /https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s)>]+/i;

export class MeetingSummarizerBot extends TeamsActivityHandler {
  private sessions = new Map<string, MeetingSession>();
  private onMeetingJoinCallback?: OnMeetingJoinCallback;

  setOnMeetingJoinCallback(callback: OnMeetingJoinCallback): void {
    this.onMeetingJoinCallback = callback;
  }

  protected async onInstallationUpdateAddActivity(context: TurnContext): Promise<void> {
    const ref = TurnContext.getConversationReference(context.activity);
    const conversationId = ref.conversation?.id;
    if (conversationId) {
      this.sessions.set(conversationId, { conversationReference: ref });
    }
  }

  protected async onMembersAddedActivity(
    membersAdded: ChannelAccount[],
    context: TurnContext
  ): Promise<void> {
    const ref = TurnContext.getConversationReference(context.activity);
    const conversationId = ref.conversation?.id;

    for (const member of membersAdded) {
      if (member.id === context.activity.recipient.id) {
        if (conversationId) {
          this.sessions.set(conversationId, { conversationReference: ref });
        }
        await context.sendActivity(
          'Hello! I\'m the Meeting Summarizer bot. ' +
            'Paste a Teams meeting join URL and I\'ll join the meeting to generate summaries for you.'
        );
      }
    }
  }

  protected async onMessageActivity(context: TurnContext): Promise<void> {
    const text = context.activity.text?.trim() ?? '';
    // Strip bot @mention tags so we only look at the user's actual message
    const cleaned = text.replace(/<at>.*?<\/at>/gi, '').trim();

    const match = cleaned.match(MEETING_URL_REGEX);

    if (match) {
      const joinUrl = match[0];
      const ref = TurnContext.getConversationReference(context.activity);
      const conversationId = ref.conversation?.id;

      if (conversationId) {
        const session = this.sessions.get(conversationId) ?? {
          conversationReference: ref,
        };
        session.meetingJoinUrl = joinUrl;
        this.sessions.set(conversationId, session);

        if (this.onMeetingJoinCallback) {
          await this.onMeetingJoinCallback(conversationId, joinUrl, ref);
          await context.sendActivity(
            'Got it! Joining the meeting now. I\'ll post summaries here.'
          );
        } else {
          await context.sendActivity(
            'Meeting URL received, but no join handler is configured.'
          );
        }
      }
    } else {
      await context.sendActivity(
        'To get started, paste a **Teams meeting join URL** into this chat.\n\n' +
          'I\'ll join the meeting and periodically post summaries here.\n\n' +
          'Example: `https://teams.microsoft.com/l/meetup-join/...`'
      );
    }
  }
}

export function getConversationReference(
  bot: MeetingSummarizerBot,
  conversationId: string
): Partial<ConversationReference> | undefined {
  // Access sessions via the public getter
  return getAllConversationReferences(bot).get(conversationId)
    ?.conversationReference;
}

export function getAllConversationReferences(
  bot: MeetingSummarizerBot
): Map<string, MeetingSession> {
  return (bot as unknown as { sessions: Map<string, MeetingSession> }).sessions;
}
