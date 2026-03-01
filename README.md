# Doppelgänger

A social party game where players impersonate their friends using AI voice cloning. Record your voice, get assigned a friend to mimic, and see if others can guess who's really behind each voice.

![Doppelgänger](Frontend/public/titlefont.svg)

## Overview

**Doppelgänger** is a multiplayer voice-based party game that combines:

- **Voice cloning** — Each player records a voice sample that gets cloned via ElevenLabs
- **Speech-to-speech conversion** — During rounds, your voice is converted to sound like another player's
- **AI-generated scenarios** — Mistral generates unique prompts (location + scenario) for each round
- **Real-time multiplayer** — WebSocket-powered rooms for live game state

### How It Works

1. **Sign up** — Create an account and record ~60 seconds of your voice for cloning
2. **Create or join a room** — Host creates a room with a 6-digit code; friends join with the code
3. **Start the game** — Host chooses number of rounds and kicks off
4. **Each round:**
   - Everyone is secretly assigned another player to impersonate
   - An AI-generated scenario appears (e.g., *"A TSA agent finds a large bag of jewels in your luggage. What's your next move?"*)
   - You record your response (up to 15 seconds) while *acting* as your assigned player
   - Your recording is converted to sound like their cloned voice
   - All converted clips are played back anonymously
   - Everyone guesses who was impersonating whom
5. **Scoring** — 100 points per correct guess; leaderboard at the end of each round and the game

---

## Project Structure

```
DoppelgangerMonoRepo/
├── Backend/          # FastAPI voice API & game logic
├── Frontend/         # Next.js web app
├── render.yaml       # Render deployment config
└── README.md
```

### Backend (`Backend/`)

| Module | Purpose |
|--------|---------|
| `main.py` | FastAPI app entry, CORS, route registration |
| `config.py` | Supabase, ElevenLabs, AWS S3 client setup |
| `orchestrator.py` | Mistral AI scenario generation from prompts DB |
| `websocket_manager.py` | Room WebSocket connections & broadcasting |
| `routes/room.py` | Create/join rooms, WebSocket, rounds, match checking, leaderboard |
| `routes/onboard.py` | User registration & login |
| `routes/voice.py` | Voice cloning & speech-to-speech conversion |
| `routes/s3.py` | Upload/download/list audio files in S3 |

### Frontend (`Frontend/`)

| Route | Purpose |
|-------|---------|
| `/` | Landing page — sign up / log in |
| `/signup` | Voice calibration — record voice sample for cloning |
| `/lobby` | Create or join a room |
| `/room/[roomId]` | Room lobby — wait for players, host starts game |
| `/room/[roomId]/round` | Round flow — record → playback → guess → results |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16, React 19, Tailwind CSS 4 |
| Backend | FastAPI, Python 3.11, Uvicorn |
| Database | Supabase (PostgreSQL) |
| Voice | ElevenLabs (voice cloning, speech-to-speech) |
| AI | Mistral (scenario generation) |
| Storage | AWS S3 (round audio files) |
| Deployment | Render |

---

## Prerequisites

- **Node.js** 18+ (for Frontend)
- **Python** 3.11+ (for Backend)
- **Supabase** project
- **ElevenLabs** API key
- **Mistral** API key
- **AWS** account (S3 bucket, IAM credentials)

---

## Setup

### 1. Backend

```bash
cd Backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Create `Backend/.env`:

```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_KEY=your-anon-public-key
ELEVENLABS_API_KEY=your-elevenlabs-api-key
MISTRAL_API_KEY=your-mistral-api-key

AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key
AWS_REGION=us-east-1
S3_BUCKET_NAME=your-bucket-name
```

Run the server:

```bash
uvicorn main:app --reload --port 8000
```

### 2. Frontend

```bash
cd Frontend
npm install
```

Create `Frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Run the dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 3. Database (Supabase)

Ensure these tables exist:

- **users** — `username`, `own_voice_id` (ElevenLabs voice ID after cloning)
- **game_lobby** — `room_id`, `player_list`, `game_state`, `max_players`
- **rounds** — `room_id`, `player`, `assigned_player`, `round_num`, `max_rounds`, `round_scores`
- **prompts** — `id`, `Location`, `Scenario` (used by orchestrator for AI prompts)

---

## API Overview

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/onboard/user` | GET | Register new user |
| `/onboard/login` | GET | Login (check user exists) |
| `/room/create` | POST | Create game room |
| `/room/join` | POST | Join room by code |
| `/room/{room_id}` | GET | Get room details |
| `/room/{room_id}/ws` | WebSocket | Real-time room updates |
| `/room/next_round` | POST | Start/advance round |
| `/room/check-match` | POST | Submit guesses, get score |
| `/room/leaderboard` | GET | Round leaderboard |
| `/room/leaderboard/final` | GET | Final game leaderboard |
| `/onboard/voices` | POST | Create voice clone (audio + username) |
| `/round/convert` | POST | Convert audio to cloned voice |
| `/upload/s3` | POST | Upload round audio to S3 |

---

## Deployment (Render)

The project includes `render.yaml` for deploying the backend to Render. Configure environment variables in the Render dashboard for:

- `SUPABASE_URL`, `SUPABASE_KEY`
- `ELEVENLABS_API_KEY`
- `MISTRAL_API_KEY`
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET_NAME`

Set `NEXT_PUBLIC_API_URL` in the Frontend to point to your deployed backend URL.

---

## License

Private project. All rights reserved.
