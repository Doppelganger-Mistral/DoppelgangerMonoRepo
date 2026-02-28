"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState<"landing" | "signup" | "login">("landing");
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSignup = async () => {
    const trimmed = username.trim();
    if (!trimmed) {
      setError("Please enter a username");
      return;
    }

    setError("");
    setLoading(true);

    try {
      const res = await fetch(
        `${API_URL}/onboard/user?username=${encodeURIComponent(trimmed)}`
      );

      if (res.status === 409) {
        setError("Username already exists");
        setLoading(false);
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.detail ?? "Something went wrong");
        setLoading(false);
        return;
      }

      router.push(`/signup?username=${encodeURIComponent(trimmed)}`);
    } catch {
      setError("Could not reach the server");
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    const trimmed = username.trim();
    if (!trimmed) {
      setError("Please enter a username");
      return;
    }

    setError("");
    setLoading(true);

    try {
      const res = await fetch(
        `${API_URL}/onboard/login?username=${encodeURIComponent(trimmed)}`
      );

      if (res.status === 404) {
        setError("Username not found");
        setLoading(false);
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.detail ?? "Something went wrong");
        setLoading(false);
        return;
      }

      router.push(`/lobby?username=${encodeURIComponent(trimmed)}`);
    } catch {
      setError("Could not reach the server");
      setLoading(false);
    }
  };

  const resetToLanding = () => {
    setMode("landing");
    setUsername("");
    setError("");
  };

  return (
    <main className="flex min-h-screen items-center bg-forest">
      {/* Left Content */}
      <div className="flex w-[55%] shrink-0 flex-col justify-center pl-10 md:pl-16 lg:pl-24 xl:pl-32 pr-4 py-12">
        <Image
          src="/titlefont.svg"
          alt="Doppelgänger"
          width={900}
          height={180}
          className="w-full h-auto drop-shadow-[0_3px_6px_rgba(0,0,0,0.5)] -ml-[40px]"
          priority
        />

        {mode === "landing" && (
          <>
            <p className="font-benguiat text-white text-lg sm:text-xl md:text-2xl lg:text-3xl mt-4 md:mt-6 lg:mt-8 leading-[1.4]">
              Trust no one,
              <br />
              not even your own voice
            </p>

            <div className="flex gap-4 md:gap-5 mt-6 md:mt-8 lg:mt-10">
              <button
                onClick={() => setMode("signup")}
                className="px-6 md:px-8 lg:px-10 py-2 md:py-2.5 lg:py-3 border-[1.5px] border-cream rounded-full font-gordon text-cream text-xs md:text-sm uppercase tracking-[0.2em] cursor-pointer bg-transparent shadow-[0_4px_12px_rgba(0,0,0,0.4)] transition-all duration-300 ease-out hover:bg-cream hover:text-forest hover:scale-105 hover:shadow-[0_6px_20px_rgba(0,0,0,0.5)]"
              >
                Sign Up
              </button>
              <button
                onClick={() => setMode("login")}
                className="px-6 md:px-8 lg:px-10 py-2 md:py-2.5 lg:py-3 border-[1.5px] border-cream rounded-full font-gordon text-cream text-xs md:text-sm uppercase tracking-[0.2em] cursor-pointer bg-transparent shadow-[0_4px_12px_rgba(0,0,0,0.4)] transition-all duration-300 ease-out hover:bg-cream hover:text-forest hover:scale-105 hover:shadow-[0_6px_20px_rgba(0,0,0,0.5)]"
              >
                Log In
              </button>
            </div>
          </>
        )}

        {mode === "signup" && (
          <>
            <p className="font-benguiat text-white text-lg sm:text-xl md:text-2xl lg:text-3xl mt-4 md:mt-6 lg:mt-8 leading-[1.4]">
              Choose a username
            </p>

            <div className="flex gap-4 mt-6 md:mt-8 lg:mt-10 items-center">
              <input
                type="text"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  if (error) setError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSignup();
                }}
                placeholder="Enter username"
                disabled={loading}
                className="px-4 py-2.5 md:py-3 w-56 md:w-64 rounded-full border-[1.5px] border-cream bg-transparent font-gordon text-cream text-sm md:text-base placeholder:text-cream/40 outline-none focus:shadow-[0_0_12px_rgba(213,206,196,0.25)] transition-shadow duration-300"
              />
              <button
                onClick={handleSignup}
                disabled={loading}
                className="px-6 md:px-8 lg:px-10 py-2 md:py-2.5 lg:py-3 border-[1.5px] border-cream rounded-full font-gordon text-cream text-xs md:text-sm uppercase tracking-[0.2em] cursor-pointer bg-transparent shadow-[0_4px_12px_rgba(0,0,0,0.4)] transition-all duration-300 ease-out hover:bg-cream hover:text-forest hover:scale-105 hover:shadow-[0_6px_20px_rgba(0,0,0,0.5)] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:bg-transparent disabled:hover:text-cream"
              >
                {loading ? "Signing up..." : "Sign Up"}
              </button>
            </div>

            {error && (
              <p className="font-benguiat text-red-400 text-sm md:text-base mt-3 ml-1">
                {error}
              </p>
            )}

            <button
              onClick={resetToLanding}
              className="mt-4 font-gordon text-cream/60 text-xs uppercase tracking-[0.15em] cursor-pointer bg-transparent border-none hover:text-cream transition-colors duration-200"
            >
              ← Back
            </button>
          </>
        )}

        {mode === "login" && (
          <>
            <p className="font-benguiat text-white text-lg sm:text-xl md:text-2xl lg:text-3xl mt-4 md:mt-6 lg:mt-8 leading-[1.4]">
              Enter your username
            </p>

            <div className="flex gap-4 mt-6 md:mt-8 lg:mt-10 items-center">
              <input
                type="text"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  if (error) setError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleLogin();
                }}
                placeholder="Enter username"
                disabled={loading}
                className="px-4 py-2.5 md:py-3 w-56 md:w-64 rounded-full border-[1.5px] border-cream bg-transparent font-gordon text-cream text-sm md:text-base placeholder:text-cream/40 outline-none focus:shadow-[0_0_12px_rgba(213,206,196,0.25)] transition-shadow duration-300"
              />
              <button
                onClick={handleLogin}
                disabled={loading}
                className="px-6 md:px-8 lg:px-10 py-2 md:py-2.5 lg:py-3 border-[1.5px] border-cream rounded-full font-gordon text-cream text-xs md:text-sm uppercase tracking-[0.2em] cursor-pointer bg-transparent shadow-[0_4px_12px_rgba(0,0,0,0.4)] transition-all duration-300 ease-out hover:bg-cream hover:text-forest hover:scale-105 hover:shadow-[0_6px_20px_rgba(0,0,0,0.5)] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:bg-transparent disabled:hover:text-cream"
              >
                {loading ? "Logging in..." : "Log In"}
              </button>
            </div>

            {error && (
              <p className="font-benguiat text-red-400 text-sm md:text-base mt-3 ml-1">
                {error}
              </p>
            )}

            <button
              onClick={resetToLanding}
              className="mt-4 font-gordon text-cream/60 text-xs uppercase tracking-[0.15em] cursor-pointer bg-transparent border-none hover:text-cream transition-colors duration-200"
            >
              ← Back
            </button>
          </>
        )}
      </div>

      {/* Right Image */}
      <div className="relative w-[45%] self-stretch overflow-hidden">
        <Image
          src="/landingicon.svg"
          alt="Doppelgänger illustration"
          fill
          className="object-contain object-right"
          priority
        />
      </div>
    </main>
  );
}
