/**
 * Runtime E2E test for quote XML flow
 * Tests that quotes are created and XML is properly returned to frontend
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { walletToEntityId } from "../src/lib/entityId";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
const TEST_WALLET = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb";

describe("Quote XML Flow E2E", () => {
  let roomId: string;

  beforeAll(async () => {
    // Ensure server is running
    const health = await fetch(`${API_BASE}/api/health`);
    expect(health.ok).toBe(true);
  });

  test("should create room for wallet address", async () => {
    const response = await fetch(`${API_BASE}/api/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityId: TEST_WALLET }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.roomId).toBeDefined();
    roomId = data.roomId;
    
    console.log(`✓ Created room: ${roomId}`);
  });

  test("should send message and receive quote with XML", async () => {
    expect(roomId).toBeDefined();

    // Send quote request
    const response = await fetch(`${API_BASE}/api/rooms/${roomId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entityId: TEST_WALLET,
        text: "I want to buy 100,000 ElizaOS at 10% discount",
      }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    
    console.log(`✓ Sent message, message ID: ${data.message?.id}`);

    // Poll for agent response
    await new Promise((r) => setTimeout(r, 3000));

    const messagesResponse = await fetch(
      `${API_BASE}/api/rooms/${roomId}/messages`,
    );
    expect(messagesResponse.ok).toBe(true);
    
    const messagesData = await messagesResponse.json();
    const messages = messagesData.messages || [];
    
    // Find agent response
    const agentMessage = messages.find((m: any) => m.entityId === m.agentId);
    expect(agentMessage).toBeDefined();
    
    const messageText = agentMessage.content?.text || agentMessage.text || "";
    console.log(`\n✓ Agent response received:\n${messageText.substring(0, 200)}...\n`);

    // Verify XML is present
    expect(messageText).toContain("<!-- XML_START -->");
    expect(messageText).toContain("<!-- XML_END -->");
    expect(messageText).toContain("<quote>");
    expect(messageText).toContain("</quote>");
    expect(messageText).toContain("<quoteId>");
    
    console.log("✓ XML properly included in response");

    // Extract XML
    const xmlMatch = messageText.match(/<!-- XML_START -->([\s\S]*?)<!-- XML_END -->/);
    expect(xmlMatch).toBeDefined();
    
    const xmlContent = xmlMatch![1].trim();
    expect(xmlContent).toContain("<quote>");
    expect(xmlContent).toContain("<discountBps>1000</discountBps>");
    
    console.log(`✓ XML extracted successfully:\n${xmlContent.substring(0, 300)}...\n`);
  });

  test("should verify quote is stored in runtime cache", async () => {
    const entityId = walletToEntityId(TEST_WALLET);
    
    const response = await fetch(
      `${API_BASE}/api/quote/latest?entityId=${TEST_WALLET}`,
    );
    
    expect(response.ok).toBe(true);
    const data = await response.json();
    
    expect(data.quote).toBeDefined();
    expect(data.quote.entityId).toBe(entityId);
    expect(data.quote.beneficiary).toBe(TEST_WALLET.toLowerCase());
    expect(data.quote.discountBps).toBe(1000);
    
    console.log(`✓ Quote verified in runtime cache:`);
    console.log(`  Entity ID (UUID): ${data.quote.entityId}`);
    console.log(`  Beneficiary (wallet): ${data.quote.beneficiary}`);
    console.log(`  Quote ID: ${data.quote.quoteId}`);
  });
});
