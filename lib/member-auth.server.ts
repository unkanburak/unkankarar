import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getMember, type Member } from "@/lib/demo-data";

const COOKIE_NAME = "unkan_member";
function signingSecret() {
  const secret = process.env.MEMBER_SESSION_SECRET ?? process.env.CRYPTO_SECRET ?? process.env.CRON_SECRET;
  if (process.env.NODE_ENV === "production" && !secret) throw new Error("MEMBER_SESSION_SECRET production ortamında zorunludur.");
  return secret ?? "local-unkan-session-secret";
}

function signature(memberId: string) {
  return createHmac("sha256", signingSecret()).update(memberId).digest("hex");
}

function encode(memberId: string) {
  return `${memberId}.${signature(memberId)}`;
}

function decode(value: string | undefined) {
  if (!value) return null;
  const separator = value.lastIndexOf(".");
  if (separator < 1) return null;
  const memberId = value.slice(0, separator);
  const supplied = value.slice(separator + 1);
  const expected = signature(memberId);
  if (supplied.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return null;
  return getMember(memberId);
}

export async function getAuthenticatedMember() {
  const cookieStore = await cookies();
  return decode(cookieStore.get(COOKIE_NAME)?.value);
}

export async function setMemberSession(member: Member) {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, encode(member.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
}
