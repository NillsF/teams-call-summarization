import * as dotenv from 'dotenv';
dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

export const config = {
  // Microsoft Entra ID / Bot
  microsoftAppId: required('MICROSOFT_APP_ID'),
  microsoftAppPassword: required('MICROSOFT_APP_PASSWORD'),
  microsoftAppTenantId: required('MICROSOFT_APP_TENANT_ID'),

  // Azure Communication Services
  acsConnectionString: required('ACS_CONNECTION_STRING'),

  // Azure OpenAI - Whisper (speech-to-text)
  whisperEndpoint: required('WHISPER_ENDPOINT'),
  whisperKey: optional('WHISPER_KEY', ''),

  // Azure OpenAI - GPT (summarization)
  azureOpenAiEndpoint: required('AZURE_OPENAI_ENDPOINT'),
  azureOpenAiApiKey: optional('AZURE_OPENAI_API_KEY', ''),
  azureOpenAiDeploymentName: required('AZURE_OPENAI_DEPLOYMENT_NAME'),

  // App config
  summaryIntervalMinutes: parseInt(optional('SUMMARY_INTERVAL_MINUTES', '5'), 10),
  callbackUri: required('CALLBACK_URI'),

  // Server
  port: parseInt(optional('PORT', '3978'), 10),
};
