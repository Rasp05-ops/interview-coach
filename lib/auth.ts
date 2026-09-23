import { promisify } from "node:util";
import { scrypt as scryptCallback, timingSafeEqual, createHmac, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";

const scrypt = promisify(scryptCallback);
const COOKIE = "ic_auth";
const MAX_AGE = 60 * 60 * 24 * 7;
export type AuthUser = { id: string; email: string };

export function assertAuthConfigured() { secret(); }
function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) throw new Error("AUTH_SECRET must be set to a random value of at least 32 characters.");
  return value;
}
function sign(payload: string) { return createHmac("sha256", secret()).update(payload).digest("base64url"); }
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [salt, expectedHex] = stored.split(":");
  if (!salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = await scrypt(password, salt, expected.length) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function setAuthCookie(res: NextResponse, user: AuthUser) {
  const payload = Buffer.from(JSON.stringify({ ...user, exp: Math.floor(Date.now() / 1000) + MAX_AGE })).toString("base64url");
  res.cookies.set(COOKIE, `${payload}.${sign(payload)}`, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: MAX_AGE });
}
export function clearAuthCookie(res: NextResponse) {
  res.cookies.set(COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
}
export function getAuthUser(req: NextRequest): AuthUser | null {
  try {
    const token = req.cookies.get(COOKIE)?.value || "";
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return null;
    const expected = Buffer.from(sign(payload));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!data.id || !data.email || data.exp < Date.now() / 1000) return null;
    return { id: data.id, email: data.email };
  } catch { return null; }
}
export function requireUser(req: NextRequest) {
  const user = getAuthUser(req);
  return user ? { user } : { response: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
}
export async function registerUser(email: string, password: string): Promise<AuthUser> {
  const id = randomBytes(16).toString("hex");
  const normalizedEmail = email.trim().toLowerCase();
  await q.user.create.run({ id, email: normalizedEmail, password_hash: await hashPassword(password) });
  return { id, email: normalizedEmail };
}
export async function authenticateUser(email: string, password: string): Promise<AuthUser | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await q.user.getByEmail.get(normalizedEmail) as any;
  if (!user || !(await verifyPassword(password, user.password_hash))) return null;
  return { id: user.id, email: user.email };
}
