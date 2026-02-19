# Meeting Summarizer (nfacs)

A Teams meeting bot that automatically joins meetings, transcribes the conversation in real time, and posts concise AI-generated summaries directly to the meeting chat. Built with Azure Communication Services (ACS) for audio capture, Azure OpenAI Whisper for speech-to-text, and GPT-5.2-chat for summarization.

The bot operates cross-tenant — Azure resources (ACS, OpenAI, Bot Service) live in one tenant while Teams users are in another. No admin consent is required in the Teams tenant; users simply sideload the app and paste a meeting join link.

## Architecture

### POC Architecture (Current)

```text
Teams meeting
    │
    │ PSTN call-out
    ▼
ACS phone number
    │
    │ Event Grid: Microsoft.Communication.IncomingCall
    ▼
/api/eventgrid (Express)
    │
    │ answerCall + DTMF "1" on CallConnected
    ▼
ACS media streaming (wss://.../ws/audio, PCM16K mono)
    │
    │ every 30s: buffer → WAV
    ▼
Azure OpenAI Whisper (Microsoft Entra ID token)
    │
    ▼
Transcript accumulator (per call)
    │
    │ every SUMMARY_INTERVAL_MINUTES (default: 5 min)
    ▼
GPT-5.2-chat summarizer (Microsoft Entra ID token)
    │
    ├──► Demo UI (SSE: live transcript + summaries)
    └──► Optional Teams chat post (Adaptive Card via proactive bot messaging)
```

- Teams calls out to the ACS PSTN number; ACS emits an `IncomingCall` Event Grid event to `/api/eventgrid`.
- The service answers with Call Automation, then sends DTMF tone `1` after `CallConnected` to pass the Teams IVR join prompt.
- ACS streams mixed audio to `/ws/audio`; the scheduler transcribes buffered audio every **30 seconds**.
- Transcript chunks are accumulated and summarized every `SUMMARY_INTERVAL_MINUTES` (**default: 5 minutes**) using GPT-5.2-chat.
- Summaries are always sent to the demo UI and posted to Teams chat when a valid conversation reference is available.
- Whisper and GPT requests use Microsoft Entra ID bearer tokens acquired at runtime.

### Production Architecture (Target on Azure)

```text
Teams client/user
      │
      ▼
Microsoft Teams platform
      │
      ▼
Azure Bot Service (Teams channel)
      │  /api/messages + proactive chat posts
      ▼
Azure Container Apps (meeting-summarizer runtime)
      ├─ ACS call control/audio capture ───────► Azure Communication Services
      │                                           │
      │                                           └─ Call events ─► Event Grid ─► ACA callback endpoint
      ├─ Transcription ─────────────────────────► Azure OpenAI (Whisper deployment)
      ├─ Summarization ─────────────────────────► Azure OpenAI (GPT deployment)
      ├─ Secret/config resolution (MI) ─────────► Azure Key Vault
      └─ Logs/traces/metrics ───────────────────► Application Insights + Log Analytics
```

#### Required Azure Services (Production)

| Service | Responsibility |
|---|---|
| **Azure Container Apps (ACA)** | Runs the bot API, ACS callbacks, audio processing, and summary orchestration with autoscaling. |
| **Azure Bot Service (Teams channel)** | Connects Teams messages/events to the bot endpoint and supports proactive chat posting. |
| **Azure Communication Services (Call Automation)** | Joins Teams meetings and provides media/call event hooks used by the app runtime. |
| **Azure Event Grid** | Delivers ACS lifecycle events to ACA callback endpoints reliably. |
| **Azure OpenAI (Whisper + GPT deployments)** | Whisper handles speech-to-text; GPT generates periodic meeting summaries. |
| **Azure Key Vault** | Central store for secrets/keys/certificates, accessed from ACA via managed identity. |
| **Application Insights + Log Analytics** | Centralized telemetry, diagnostics, and alerting for runtime and integration health. |

#### Production Posture (High Level)

- Use **managed identity** for ACA-to-Key Vault and other Azure resource access; avoid long-lived credentials where possible.
- Keep all sensitive configuration in **Key Vault** and reference secrets from ACA revisions; rotate secrets centrally.
- Keep ACA **public ingress** enabled only for required callback paths (Bot/ACS/Event Grid) over HTTPS, with strict request validation.
- Configure **scaling/reliability** with minimum replicas for warm start, autoscale rules, health probes, and Event Grid retry handling.

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

## Authentication Modes

The app supports two ways to authenticate with Azure OpenAI (Whisper + GPT):

| Mode | `AZURE_AUTH_MODE` | When to use |
|------|-------------------|-------------|
| Entra ID | `entra` (default) | Production / no API key needed. Uses the service principal from `MICROSOFT_APP_ID` / `MICROSOFT_APP_PASSWORD` / `MICROSOFT_APP_TENANT_ID` via client_credentials grant. The Azure AI Services resource must have **local auth disabled** (`disableLocalAuth=true`). |
| API Key | `apikey` | Local dev / simple setup without a service principal. Set `WHISPER_KEY` and `AZURE_OPENAI_API_KEY`. |

### Entra ID mode (default)

No extra config needed — the app reuses the bot's service principal credentials (`MICROSOFT_APP_ID`, `MICROSOFT_APP_PASSWORD`, `MICROSOFT_APP_TENANT_ID`) to acquire a `https://cognitiveservices.azure.com/.default` token.

Requirements:
- The SP must have **Cognitive Services User** role on the Azure AI Services resource.
- The resource must have `disableLocalAuth=true` (or keys simply left blank).

### API Key mode

Set `AZURE_AUTH_MODE=apikey` and populate both key fields:

```env
AZURE_AUTH_MODE=apikey
WHISPER_KEY=<your-whisper-api-key>
AZURE_OPENAI_API_KEY=<your-openai-api-key>
```

The server will refuse to start if either key is missing when this mode is selected.

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
