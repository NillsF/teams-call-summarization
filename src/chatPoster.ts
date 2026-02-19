import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  ConversationReference,
  CardFactory,
  TurnContext,
} from 'botbuilder';
import { config } from './config';
import { logger } from './logger';

const botFrameworkAuth = new ConfigurationBotFrameworkAuthentication({
  MicrosoftAppId: config.microsoftAppId,
  MicrosoftAppTenantId: config.microsoftAppTenantId,
  MicrosoftAppType: 'UserAssignedMsi',
});

export const adapter = new CloudAdapter(botFrameworkAuth);

function buildSummaryCard(summary: string, intervalMinutes: number): object {
  const timestamp = new Date().toLocaleString();
  return {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body: [
      { type: 'TextBlock', text: '📋 Meeting Summary', weight: 'Bolder', size: 'Medium' },
      { type: 'TextBlock', text: `Last ${intervalMinutes} minutes`, isSubtle: true, spacing: 'None' },
      { type: 'TextBlock', text: summary, wrap: true },
      { type: 'TextBlock', text: `Generated at ${timestamp}`, isSubtle: true, size: 'Small' },
    ],
  };
}

export async function postSummaryToChat(
  conversationReference: Partial<ConversationReference>,
  summary: string,
  intervalMinutes: number,
): Promise<void> {
  try {
    await adapter.continueConversationAsync(
      config.microsoftAppId,
      conversationReference,
      async (context: TurnContext) => {
        try {
          const card = buildSummaryCard(summary, intervalMinutes);
          const attachment = CardFactory.adaptiveCard(card);
          await context.sendActivity({ attachments: [attachment] });
        } catch (cardError) {
          logger.error({ err: cardError }, 'Failed to send Adaptive Card, falling back to plain text');
          await context.sendActivity(
            `📋 **Meeting Summary** (Last ${intervalMinutes} minutes)\n\n${summary}`,
          );
        }
      },
    );
  } catch (error) {
    logger.error({ err: error }, 'Failed to post summary to chat');
  }
}
