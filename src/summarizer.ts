import { AzureOpenAI } from 'openai';
import { config } from './config';
import { getCognitiveAccessToken } from './entraAuth';
import { logger } from './logger';

const MINIMUM_TRANSCRIPT_LENGTH = 20;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

function isTransientError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('network') || msg.includes('econnreset') || msg.includes('timeout') || msg.includes('econnrefused')) {
      return true;
    }
    // Check for status code in OpenAI errors
    const statusCode = (error as unknown as Record<string, unknown>).status;
    if (typeof statusCode === 'number' && (statusCode >= 500 || statusCode === 429)) {
      return true;
    }
  }
  return false;
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SYSTEM_PROMPT = `You are a meeting summarizer. Given a transcript of a meeting, produce a concise summary using bullet points. You must:
- Identify key discussion topics
- Note any decisions made
- List action items if any
- Include speaker names when available in the transcript
Keep the summary brief and well-organized.`;

// Extract base endpoint (remove path components if present)
const baseEndpoint = config.azureOpenAiEndpoint.replace(/\/openai\/.*$/, '');

function createOpenAIClient(): AzureOpenAI {
  const baseOptions = {
    endpoint: baseEndpoint,
    apiVersion: '2025-04-01-preview',
    deployment: config.azureOpenAiDeploymentName,
  };
  if (config.authMode === 'apikey') {
    return new AzureOpenAI({ ...baseOptions, apiKey: config.azureOpenAiApiKey });
  }
  return new AzureOpenAI({ ...baseOptions, azureADTokenProvider: getCognitiveAccessToken });
}

const client = createOpenAIClient();

export async function summarizeTranscript(transcriptText: string): Promise<string> {
  if (!transcriptText || transcriptText.trim().length < MINIMUM_TRANSCRIPT_LENGTH) {
    return 'Not enough transcript content to generate a summary.';
  }

  try {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await client.chat.completions.create({
          model: config.azureOpenAiDeploymentName,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: transcriptText },
          ],
          max_completion_tokens: 1024,
        });

        const summary = response.choices[0]?.message?.content;
        if (!summary) {
          return 'The model returned an empty summary.';
        }
        return summary;
      } catch (error: unknown) {
        if (isTransientError(error) && attempt < MAX_RETRIES) {
          logger.warn({ err: error, attempt }, 'Summarization transient error, retrying');
          await delay(RETRY_DELAY_MS);
          continue;
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to summarize transcript: ${message}`);
      }
    }
    throw new Error('Failed to summarize transcript after retries');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message);
  }
}
