# Meeting Summarizer (nfacs)

A Teams meeting bot that automatically joins meetings, transcribes the conversation in real time, and posts concise AI-generated summaries directly to the meeting chat. Built with Azure Communication Services (ACS) for audio capture, Azure OpenAI Whisper for speech-to-text, and GPT-5.2-chat for summarization.

The bot operates cross-tenant — Azure resources (ACS, OpenAI, Bot Service) live in one tenant while Teams users are in another. No admin consent is required in the Teams tenant; users simply sideload the app and paste a meeting join link.

## Architecture

```
Teams Meeting
     │
     ▼
ACS joins meeting ──► Raw audio streamed via WebSocket
                              │
                              ▼
                     Whisper transcribes audio (30 s chunks)
                              │
                              ▼
                     GPT-5.2-chat summarizes transcript
                              │
                              ▼
                     Bot posts summary to meeting chat
                     (Bot Framework proactive messaging / UAMI)
```

1. A user pastes a Teams meeting join URL into the bot chat.
2. ACS Call Automation joins the meeting and begins streaming raw PCM audio over a WebSocket.
3. Every 30 seconds the audio buffer is converted to WAV and sent to Azure OpenAI Whisper for transcription.
4. At a configurable interval (default 5 minutes), the accumulated transcript is sent to GPT-5.2-chat which produces a bullet-point summary.
5. The summary is posted back to the meeting chat as an Adaptive Card via Bot Framework proactive messaging.

## Prerequisites

| Requirement | Details |
|---|---|
| **Node.js** | 18 or later |
| **Azure Subscription** | ACS resource, Azure OpenAI (Whisper + GPT-5.2-chat deployments), Bot Service (UAMI), Entra ID app registration |
| **Microsoft Teams** | Sideloading enabled for your user / tenant |
| **Dev Tunnel CLI** | [`devtunnel`](https://learn.microsoft.com/azure/developer/dev-tunnels/get-started) or `ngrok` for exposing local endpoints |

## Local Development Setup

### 1. Clone and install

```bash
git clone <repo-url>
cd aem-copilot
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in every value. See [`env.md`](env.md) for descriptions and examples of each variable.

### 3. Start a dev tunnel

The bot needs a publicly reachable HTTPS URL so ACS and Bot Service can call back into your local server.

```bash
devtunnel create --allow-anonymous
devtunnel port create -p 3978
devtunnel host
```

Copy the tunnel URL (e.g. `https://<tunnel-id>-3978.devtunnels.ms`).

### 4. Update callback URL

- Set `CALLBACK_URI` in `.env` to your tunnel URL:
  ```
  CALLBACK_URI=https://<tunnel-id>-3978.devtunnels.ms
  ```
- In the Azure Portal, update the **Bot Service → Configuration → Messaging endpoint** to:
  ```
  https://<tunnel-id>-3978.devtunnels.ms/api/messages
  ```

### 5. Run the bot

```bash
npm run dev
```

The server starts on port 3978.

## Sideloading the App

1. Zip the contents of the `appPackage/` folder (`manifest.json`, `color.png`, `outline.png`):
   ```bash
   cd appPackage && zip -r ../app.zip . && cd ..
   ```
2. In Teams, go to **Apps → Manage your apps → Upload a custom app → Upload for me or my org**.
3. Select `app.zip`.
4. Add the bot to a meeting chat (or any 1:1/group chat).

## Usage

1. In the meeting chat, paste a **Teams meeting join URL** (the full `https://teams.microsoft.com/l/meetup-join/...` link).
2. The bot joins the meeting via ACS and begins capturing audio.
3. Every **N minutes** (configured by `SUMMARY_INTERVAL_MINUTES`, default 5), a summary is posted to the chat as an Adaptive Card.
4. Type **`stop`** in the chat to end summarization and disconnect the bot from the meeting.

## Project Structure

```
src/
├── audioStreamHandler.ts   # WebSocket server; receives & buffers PCM audio from ACS
├── bot.ts                  # Teams bot message handler; extracts meeting URLs, manages sessions
├── callAutomation.ts       # ACS Call Automation client; joins meetings, handles callbacks
├── chatPoster.ts           # Posts summaries as Adaptive Cards via Bot Framework proactive messaging
├── config.ts               # Loads & validates environment variables
├── scheduler.ts            # Orchestrates periodic transcription & summary intervals
├── summarizer.ts           # Sends transcript to GPT-5.2-chat and returns bullet-point summaries
└── transcriber.ts          # Converts PCM → WAV, calls Whisper for speech-to-text
```

## Environment Variables

| Variable | Description |
|---|---|
| `MICROSOFT_APP_ID` | Entra ID app registration Application (client) ID |
| `MICROSOFT_APP_PASSWORD` | Entra ID app registration client secret |
| `MICROSOFT_APP_TENANT_ID` | Entra ID tenant (directory) ID for the Azure resource tenant |
| `ACS_CONNECTION_STRING` | Azure Communication Services connection string |
| `WHISPER_ENDPOINT` | Full URL to the Azure OpenAI Whisper deployment (including API version) |
| `WHISPER_KEY` | API key for the Whisper deployment |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI endpoint URL for the GPT deployment |
| `AZURE_OPENAI_API_KEY` | API key for the Azure OpenAI GPT deployment |
| `AZURE_OPENAI_DEPLOYMENT_NAME` | Name of the GPT model deployment (e.g. `gpt-5.2-chat`) |
| `SUMMARY_INTERVAL_MINUTES` | How often (in minutes) to post a summary (default: `5`) |
| `CALLBACK_URI` | Public HTTPS URL for ACS/Bot callbacks (dev tunnel or ngrok URL) |

> **Note:** Never commit real values to source control. Use `.env` locally and Azure App Settings in production. See `.env.example` for the template.
