import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { verifyMessage } from "viem";

export interface AuthHeaders {
  address: string;
  signature: string;
  message: string;
  timestamp: string;
}

/**
 * Extract and validate auth headers from request
 */
export function getAuthHeaders(request: Request): AuthHeaders | null {
  const address = request.headers.get("x-wallet-address");
  const signature = request.headers.get("x-wallet-signature");
  const message = request.headers.get("x-auth-message");
  const timestamp = request.headers.get("x-auth-timestamp");

  if (!address || !signature || !message || !timestamp) {
    return null;
  }

  return { address, signature, message, timestamp };
}

/**
 * Verify EVM wallet signature
 */
export async function verifyEVMSignature(
  address: string,
  message: string,
  signature: string,
): Promise<boolean> {
  try {
    const recovered = await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
    return recovered;
  } catch {
    return false;
  }
}

/**
 * Verify Solana wallet signature
 */
export function verifySolanaSignature(
  address: string,
  message: string,
  signature: string,
): boolean {
  try {
    const publicKey = new PublicKey(address);
    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = bs58.decode(signature);
    return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKey.toBytes());
  } catch {
    return false;
  }
}

/**
 * Verify wallet owns the address (EVM or Solana)
 */
export async function verifyWalletOwnership(
  auth: AuthHeaders,
  chain: "solana" | string,
): Promise<{ valid: boolean; error?: string }> {
  // Check timestamp is recent (within 5 minutes)
  const timestamp = parseInt(auth.timestamp, 10);
  const now = Date.now();
  if (Number.isNaN(timestamp) || Math.abs(now - timestamp) > 5 * 60 * 1000) {
    return { valid: false, error: "Signature expired or invalid timestamp" };
  }

  // Verify the message contains expected content
  const expectedMessagePrefix = "Authorize OTC action at ";
  if (!auth.message.startsWith(expectedMessagePrefix)) {
    return { valid: false, error: "Invalid message format" };
  }

  // Verify signature
  const isValid =
    chain === "solana"
      ? verifySolanaSignature(auth.address, auth.message, auth.signature)
      : await verifyEVMSignature(auth.address, auth.message, auth.signature);

  if (!isValid) {
    return { valid: false, error: "Invalid signature" };
  }

  return { valid: true };
}
