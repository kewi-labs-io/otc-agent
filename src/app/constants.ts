export const siteConfig = {
  name: "AI Trading Desk",
  url:
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://tradingdesk.ai/" ||
    "http://localhost:4444",
  description:
    "AI Trading Desk is an autonomous OTC trading platform powered by AI agents for seamless token deals.",
  ogImage: "/og.png",
  creator: "Trading Desk",
  icons: [
    {
      rel: "icon",
      type: "image/png",
      url: "/favicon.ico",
      media: "(prefers-color-scheme: dark)",
    },
  ],
};
