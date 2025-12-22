"use client";

import { useEffect, useState } from "react";
import type { OAuthResponse, StoredCredentials } from "@/types";

const STORAGE_KEY = "twitter-oauth-token";
const OAUTH_REDIRECT_ORIGIN_KEY = "OAUTH_REDIRECT_ORIGIN";

export default function CallbackPage() {
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState<Record<string, string>>({});

  useEffect(() => {
    async function run() {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || window.location.origin;
      const urlParams = new URLSearchParams(window.location.search);
      const oauthToken = urlParams.get("oauth_token");
      const oauthVerifier = urlParams.get("oauth_verifier");
      const code = urlParams.get("code");
      const state = urlParams.get("state");
      const err = urlParams.get("error");
      const errorDescription = urlParams.get("error_description");

      setDebug({
        oauthToken: oauthToken || "Missing",
        oauthVerifier: oauthVerifier || "Missing",
        code: code ? "Received" : "Missing",
        state: state || "Missing",
        error: err || "None",
        errorDescription: errorDescription || "None",
      });

      if (err) {
        setError(errorDescription || err);
        return;
      }

      // OAuth 1.0a
      if (oauthToken && oauthVerifier) {
        const resp = await fetch(
          `${apiUrl}/api/share/oauth1/callback?oauth_token=${encodeURIComponent(oauthToken)}&oauth_verifier=${encodeURIComponent(oauthVerifier)}`,
          { credentials: "include" },
        );
        if (!resp.ok) throw new Error(await resp.text());
        const data = (await resp.json()) as OAuthResponse;
        if (!data.oauth1_token || !data.oauth1_token_secret) {
          throw new Error("Missing oauth1 tokens in response");
        }
        // FAIL-FAST: Required OAuth fields must be present
        if (!data.access_token) {
          throw new Error("OAuth response missing access_token");
        }
        if (!data.refresh_token) {
          throw new Error("OAuth response missing refresh_token");
        }
        if (!data.user_id && !data.entityId) {
          throw new Error("OAuth response missing user_id or entityId");
        }

        // entityId is required - we already validated that one exists above
        const entityId =
          data.user_id !== undefined && data.user_id !== null && data.user_id !== ""
            ? data.user_id
            : data.entityId !== undefined && data.entityId !== null && data.entityId !== ""
              ? data.entityId
              : undefined;
        if (!entityId) {
          throw new Error("OAuth response missing both user_id and entityId");
        }
        // username is optional - use undefined if not present
        const username =
          data.screen_name !== undefined && data.screen_name !== null && data.screen_name !== ""
            ? data.screen_name
            : data.username !== undefined && data.username !== null && data.username !== ""
              ? data.username
              : undefined;
        const credentials: StoredCredentials = {
          entityId,
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresAt: Date.now() + 86400000,
          username,
          oauth1Token: data.oauth1_token,
          oauth1TokenSecret: data.oauth1_token_secret,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(credentials));
        redirectToOrigin();
        return;
      }

      // OAuth 2.0
      if (code && state) {
        const resp = await fetch(
          `${apiUrl}/api/share/oauth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
          { credentials: "include" },
        );
        if (!resp.ok) throw new Error(await resp.text());
        const tok = (await resp.json()) as OAuthResponse;
        if (!tok.access_token || !tok.refresh_token || !tok.user_id) {
          throw new Error("Incomplete OAuth 2.0 token data");
        }
        const creds: StoredCredentials = {
          entityId: tok.user_id,
          accessToken: tok.access_token,
          refreshToken: tok.refresh_token,
          expiresAt: Date.now() + (tok.expires_in || 3600) * 1000,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
        redirectToOrigin();
        return;
      }

      setError("Missing required OAuth parameters");
    }

    function redirectToOrigin() {
      const origin = localStorage.getItem(OAUTH_REDIRECT_ORIGIN_KEY) || "/";
      localStorage.removeItem(OAUTH_REDIRECT_ORIGIN_KEY);
      const u = new URL(origin, window.location.origin);
      u.searchParams.set("fresh_auth", "true");
      window.location.href = u.toString();
    }

    run().catch((e) => setError(e instanceof Error ? e.message : "OAuth failed"));
  }, []);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-lg w-full space-y-3 text-sm">
          <div className="text-xl font-semibold">Authentication Error</div>
          <div className="text-red-500">{error}</div>
          <pre className="bg-zinc-900 text-zinc-300 p-3 overflow-x-auto rounded">
            {JSON.stringify(debug, null, 2)}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="text-sm text-zinc-400">Authenticating with X…</div>
    </div>
  );
}
