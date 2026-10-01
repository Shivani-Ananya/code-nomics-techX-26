import { env } from "cloudflare:workers";

export type Session = { id: string; role: "host" | "participant"; exp: number };
const encoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function base64url(value: string) {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  return atob(padded);
}

export function randomSalt() {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
}

export async function hashPassword(password: string, salt: string) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: encoder.encode(salt), iterations: 120000, hash: "SHA-256" },
    material,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

function secret() {
  const value = (env as unknown as Record<string, string>).SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters");
  return value;
}

async function signature(payload: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return base64url(String.fromCharCode(...new Uint8Array(sig)));
}

export async function createSession(id: string, role: Session["role"]) {
  const payload = base64url(JSON.stringify({ id, role, exp: Date.now() + 12 * 60 * 60 * 1000 }));
  return payload + "." + (await signature(payload));
}

export async function readSession(request: Request): Promise<Session | null> {
  const cookie = request.headers.get("cookie") || "";
  const token = cookie.match(/(?:^|;\s*)ca_session=([^;]+)/)?.[1];
  if (!token) return null;
  const [payload, supplied] = token.split(".");
  if (!payload || !supplied || !safeEqual(await signature(payload), supplied)) return null;
  try {
    const session = JSON.parse(fromBase64url(payload)) as Session;
    return session.exp > Date.now() ? session : null;
  } catch {
    return null;
  }
}

export function sessionCookie(token: string, request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return "ca_session=" + token + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200" + secure;
}

export function clearSessionCookie(request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return "ca_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" + secure;
}

export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
