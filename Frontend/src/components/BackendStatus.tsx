'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface HealthStatus {
  status: string;
}

interface ApiMessage {
  message: string;
}

export function BackendStatus() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [message, setMessage] = useState<ApiMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkBackend() {
      try {
        const [healthData, messageData] = await Promise.all([
          api.get<HealthStatus>('/health'),
          api.get<ApiMessage>('/'),
        ]);
        setHealth(healthData);
        setMessage(messageData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to connect');
      } finally {
        setLoading(false);
      }
    }

    checkBackend();
  }, []);

  if (loading) {
    return (
      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <p className="text-zinc-600 dark:text-zinc-400">Connecting to backend...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
        <p className="font-medium text-red-600 dark:text-red-400">Backend Connection Error</p>
        <p className="text-sm text-red-500">{error}</p>
        <p className="mt-2 text-xs text-red-400">
          Make sure your FastAPI backend is running on https://doppelganger-backend.vercel.app/
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950">
      <p className="font-medium text-green-600 dark:text-green-400">
        Backend Connected
      </p>
      <p className="text-sm text-green-600 dark:text-green-300">
        Status: {health?.status}
      </p>
      <p className="text-sm text-green-600 dark:text-green-300">
        Message: {message?.message}
      </p>
    </div>
  );
}
