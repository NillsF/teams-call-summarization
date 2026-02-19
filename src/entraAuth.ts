import { config } from './config';

const COGNITIVE_SCOPE = 'https://cognitiveservices.azure.com/.default';

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getCognitiveAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - 60_000 > now) {
    return cachedToken.token;
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.microsoftAppId,
    client_secret: config.microsoftAppPassword,
    scope: COGNITIVE_SCOPE,
  });

  const response = await fetch(
    `https://login.microsoftonline.com/${config.microsoftAppTenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to acquire Entra ID token: ${response.status} ${errorText}`);
  }

  const payload = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: payload.access_token,
    expiresAt: now + payload.expires_in * 1000,
  };

  return payload.access_token;
}
