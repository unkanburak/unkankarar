import { NextResponse } from "next/server";
import { getMemberByToken } from "@/lib/demo-data";
import { setMemberSession } from "@/lib/member-auth.server";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const member = getMemberByToken(token);
  const response = NextResponse.redirect(new URL("/", request.url));

  if (!member) {
    return NextResponse.redirect(new URL("/?error=invite", request.url));
  }

  await setMemberSession(member);
  return response;
}
