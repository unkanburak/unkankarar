import { NextResponse } from "next/server";
import { getAuthenticatedMember } from "@/lib/member-auth.server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ member: await getAuthenticatedMember() }, { headers: { "Cache-Control": "no-store" } });
}
