"use client";

import { useEffect } from "react";
import { resumeFreshAuth } from "@/utils/x-share";

export function XShareResume() {
  useEffect(() => {
    // Best-effort resume for any pending X share
    // Non-critical: failures are logged but don't block page load
    resumeFreshAuth().catch((err) => {
      console.error("[XShareResume] Failed to resume X share:", err);
    });
  }, []);
  return null;
}
