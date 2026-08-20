import { NextResponse } from "next/server";
import { z } from "zod";
import { getMember } from "@/lib/demo-data";
import { verifyMemberPassword } from "@/lib/member-passwords.server";
import { setMemberSession } from "@/lib/member-auth.server";

const loginSchema = z.object({
  memberId: z.string().min(1),
  password: z.string().length(6),
});

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Geçersiz giriş." }, { status: 400 });
  }

  const member = getMember(parsed.data.memberId);
  if (!member || !verifyMemberPassword(member.id, parsed.data.password)) {
    return NextResponse.json({ error: "Şifre yanlış. Bir daha dene." }, { status: 401 });
  }

  await setMemberSession(member);

  return NextResponse.json({ member: { id: member.id, name: member.name, role: member.role } });
}
