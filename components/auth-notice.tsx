"use client";

import { useEffect, useState } from "react";

const messages: Record<string, string> = {
  configuration: "Spotify connection isn’t configured yet. Check the server’s Spotify settings and session encryption key.",
  state: "We couldn’t verify this sign-in attempt. Please connect again from this browser. Starting another login tab also replaces the previous attempt.",
  denied: "Spotify connection was cancelled. You can try again whenever you’re ready.",
  callback: "Spotify sign-in couldn’t be completed. Please try again and check that the callback URL matches your app settings.",
  expired: "Your session has ended. Connect with Spotify again to continue.",
};

export function AuthNotice() {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("auth_error");
    if (code) {
      setMessage(messages[code] || messages.callback);
      url.searchParams.delete("auth_error");
      window.history.replaceState(null, "", url);
    }
  }, []);
  return message ? <div className="auth-notice container" role="alert"><span>{message}</span><button onClick={() => setMessage(null)} aria-label="Dismiss sign-in message">×</button></div> : null;
}
