"""
Shared configuration and client initialization.
All service clients (Supabase, ElevenLabs, S3) are created here
and imported by route modules.
"""

import os
from typing import Optional

import boto3
from dotenv import load_dotenv
from elevenlabs.client import ElevenLabs
from supabase import create_client, Client

load_dotenv()

# ── Supabase ──────────────────────────────────────────────────────────
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

supabase: Optional[Client] = None
if SUPABASE_URL and SUPABASE_KEY:
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# ── ElevenLabs ────────────────────────────────────────────────────────
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY")

elevenlabs: Optional[ElevenLabs] = None
if ELEVENLABS_API_KEY:
    elevenlabs = ElevenLabs(api_key=ELEVENLABS_API_KEY)

# ── AWS S3 ────────────────────────────────────────────────────────────
AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
S3_BUCKET_NAME = os.getenv("S3_BUCKET_NAME")

s3_client = None
if AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY:
    s3_client = boto3.client(
        "s3",
        aws_access_key_id=AWS_ACCESS_KEY_ID,
        aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
        region_name=AWS_REGION,
    )
