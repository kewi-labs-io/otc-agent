/**
 * Consolidated blob storage utilities for caching images
 *
 * Uses Vercel Blob storage to cache token logos for reliable serving.
 * Falls back gracefully when blob storage is not available.
 */

import crypto from "node:crypto";
import { head, put } from "@vercel/blob";

/**
 * Check if blob storage is available (BLOB_READ_WRITE_TOKEN is set)
 */
export function isBlobStorageAvailable(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

/**
 * Get file extension from URL
 * FAIL-FAST: Throws if URL is invalid or extension cannot be determined
 */
export function getExtensionFromUrl(url: string): string {
  // new URL() throws TypeError if invalid - let it propagate
  const parsedUrl = new URL(url);
  const pathname = parsedUrl.pathname;
  const match = pathname.match(/\.([a-zA-Z0-9]+)$/);
  if (!match) {
    throw new Error(`Unable to determine file extension from URL: ${url}`);
  }

  const ext = match[1].toLowerCase();
  if (!["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) {
    throw new Error(`Unsupported file extension: ${ext} (from URL: ${url})`);
  }

  return ext;
}

/**
 * Generate blob path from image URL
 * FAIL-FAST: Throws if extension cannot be determined
 */
export function getBlobPath(imageUrl: string): string {
  const urlHash = crypto.createHash("md5").update(imageUrl).digest("hex");
  // getExtensionFromUrl now throws if extension cannot be determined
  const extension = getExtensionFromUrl(imageUrl);
  return `token-images/${urlHash}.${extension}`;
}

/**
 * Alternative IPFS gateways to try if main one fails
 */
const IPFS_GATEWAYS = [
  "https://cloudflare-ipfs.com",
  "https://dweb.link",
  "https://gateway.pinata.cloud",
  "https://ipfs.io",
];

/**
 * Extract IPFS hash from various URL formats
 */
function extractIpfsHash(imageUrl: string): string | null {
  const patterns = [
    /ipfs\.io\/ipfs\/([a-zA-Z0-9]+)/,
    /\.mypinata\.cloud\/ipfs\/([a-zA-Z0-9]+)/,
    /cloudflare-ipfs\.com\/ipfs\/([a-zA-Z0-9]+)/,
    /dweb\.link\/ipfs\/([a-zA-Z0-9]+)/,
    /gateway\.pinata\.cloud\/ipfs\/([a-zA-Z0-9]+)/,
  ];

  for (const pattern of patterns) {
    const match = imageUrl.match(pattern);
    if (match) {
      return match[1];
    }
  }
  return null;
}

/**
 * Try to fetch image from multiple IPFS gateways
 * FAIL-FAST: Throws if all gateways fail or fetch fails
 */
export async function fetchWithIpfsGatewayFallback(
  imageUrl: string,
  timeout = 8000,
): Promise<Response> {
  const ipfsHash = extractIpfsHash(imageUrl);

  // If it's an IPFS URL, try multiple gateways
  if (ipfsHash) {
    const ipfsPath = `/ipfs/${ipfsHash}`;
    const errors: Error[] = [];

    for (const gateway of IPFS_GATEWAYS) {
      const gatewayUrl = `${gateway}${ipfsPath}`;
      const response = await fetch(gatewayUrl, {
        headers: { "User-Agent": "OTC-Desk/1.0" },
        signal: AbortSignal.timeout(timeout),
      });
      if (response.ok) {
        console.log(`[Blob Storage] IPFS fetched from ${gateway}`);
        return response;
      }
      errors.push(new Error(`Gateway ${gateway} returned HTTP ${response.status}`));
    }
    throw new Error(
      `Failed to fetch IPFS content from all gateways: ${errors.map((e) => e.message).join(", ")}`,
    );
  }

  // For non-IPFS URLs, just fetch directly
  const response = await fetch(imageUrl, {
    headers: { "User-Agent": "OTC-Desk/1.0" },
    signal: AbortSignal.timeout(timeout),
  });

  // FAIL-FAST: Check response status
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${imageUrl} (HTTP ${response.status})`);
  }

  return response;
}

/**
 * Check if image URL is from an unreliable source (IPFS, etc.)
 */
export function isUnreliableImageUrl(url: string): boolean {
  return (
    url.includes("ipfs.io/ipfs/") ||
    url.includes("storage.auto.fun") ||
    url.includes(".mypinata.cloud")
  );
}

/**
 * Check if an image is already cached in blob storage
 * Returns null if blob doesn't exist (cache miss) - this is a non-error state
 * FAIL-FAST: Throws for any error other than "not found"
 */
export async function checkBlobCache(imageUrl: string): Promise<string | null> {
  if (!isBlobStorageAvailable()) return null;

  const blobPath = getBlobPath(imageUrl);
  let existing;
  try {
    existing = await head(blobPath);
  } catch (err) {
    // Check if error is "not found" (expected cache miss) vs other error
    const errorMessage = err instanceof Error ? err.message : String(err);
    if (errorMessage.includes("not found") || errorMessage.includes("404")) {
      // Blob doesn't exist - this is expected, return null
      return null;
    }
    // Any other error should propagate
    throw err;
  }

  // FAIL-FAST: If head() succeeded, existing.url MUST exist (required field in Vercel Blob response)
  if (!existing.url) {
    throw new Error(`Blob head() succeeded but missing url field for ${blobPath}`);
  }
  return existing.url;
}

/**
 * Cache an image URL to Vercel Blob storage
 * Returns the cached blob URL
 *
 * @param imageUrl - The original image URL to cache
 */
export async function cacheImageToBlob(imageUrl: string | null): Promise<string | null> {
  if (!imageUrl) return null;

  // Skip if already a blob URL
  if (imageUrl.includes("blob.vercel-storage.com")) {
    return imageUrl;
  }

  // If blob storage isn't configured, throw error
  if (!isBlobStorageAvailable()) {
    throw new Error("Blob storage is not configured");
  }

  const blobPath = getBlobPath(imageUrl);

  // Check if already cached in blob storage
  // FAIL-FAST: head() throws if blob doesn't exist - handle "not found" explicitly
  let existing;
  try {
    existing = await head(blobPath);
  } catch (err) {
    // Blob doesn't exist - this is expected (cache miss), continue to download
    // FAIL-FAST: Only catch "not found" errors, let other errors propagate
    const errorMessage = err instanceof Error ? err.message : String(err);
    if (errorMessage.includes("not found") || errorMessage.includes("404")) {
      existing = null;
    } else {
      // Any other error should propagate (network errors, auth errors, etc.)
      throw err;
    }
  }

  // FAIL-FAST: If head() succeeded, existing.url MUST exist (required field in Vercel Blob response)
  if (existing) {
    if (!existing.url) {
      throw new Error(`Blob head() succeeded but missing url field for ${blobPath}`);
    }
    return existing.url;
  }

  // Download image with IPFS gateway fallback
  // FAIL-FAST: fetchWithIpfsGatewayFallback throws on failure
  const response = await fetchWithIpfsGatewayFallback(imageUrl);

  // FAIL-FAST: content-type header is required for blob storage
  const contentType = response.headers.get("content-type");
  if (!contentType) {
    throw new Error(`Response missing content-type header for ${imageUrl}`);
  }
  const imageBuffer = await response.arrayBuffer();

  const blob = await put(blobPath, imageBuffer, {
    access: "public",
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  console.log(`[Blob Storage] Cached image to blob: ${blob.url}`);
  return blob.url;
}

/**
 * Batch check blob cache for multiple URLs
 */
export async function batchCheckBlobCache(imageUrls: string[]): Promise<Record<string, string>> {
  if (!isBlobStorageAvailable() || imageUrls.length === 0) return {};

  const results = await Promise.all(
    imageUrls.map(async (url) => {
      const blobUrl = await checkBlobCache(url);
      return { url, blobUrl };
    }),
  );

  const cache: Record<string, string> = {};
  for (const { url, blobUrl } of results) {
    if (blobUrl) {
      cache[url] = blobUrl;
    }
  }

  return cache;
}

/**
 * Get reliable logo URL: blob cache > reliable URL > null
 */
export function getReliableLogoUrl(
  rawLogoUrl: string | null,
  cachedBlobUrls: Record<string, string>,
): string | null {
  if (!rawLogoUrl) return null;

  // Already a blob URL
  if (rawLogoUrl.includes("blob.vercel-storage.com")) {
    return rawLogoUrl;
  }

  // Check blob cache
  if (cachedBlobUrls[rawLogoUrl]) {
    return cachedBlobUrls[rawLogoUrl];
  }

  // Not from unreliable source, use directly
  if (!isUnreliableImageUrl(rawLogoUrl)) {
    return rawLogoUrl;
  }

  // Unreliable source with no cache, return null
  return null;
}
