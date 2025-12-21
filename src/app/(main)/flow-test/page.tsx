"use client";

import dynamic from "next/dynamic";
import { PageLoading } from "@/components/ui/loading-spinner";

// Dynamic import to prevent SSR issues with wallet hooks
const FlowTestClient = dynamic(() => import("./FlowTestClient"), {
  ssr: false,
  loading: () => <PageLoading message="Loading flow test..." />,
});

export default function FlowTestPage() {
  return <FlowTestClient />;
}
