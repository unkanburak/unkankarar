import { timingSafeEqual } from "node:crypto";

const passwordEnvByMember: Record<string, string | undefined> = {
  member_burak: process.env.MEMBER_PASSWORD_BURAK,
  member_emin: process.env.MEMBER_PASSWORD_EMIN,
  member_furkan: process.env.MEMBER_PASSWORD_FURKAN,
  member_erkut: process.env.MEMBER_PASSWORD_ERKUT,
  member_kubra: process.env.MEMBER_PASSWORD_KUBRA,
  member_buse: process.env.MEMBER_PASSWORD_BUSE,
  member_beyza: process.env.MEMBER_PASSWORD_BEYZA,
  member_kerim: process.env.MEMBER_PASSWORD_KERIM,
};

export function verifyMemberPassword(memberId: string, suppliedPassword: string) {
  const expectedPassword = passwordEnvByMember[memberId];
  if (!expectedPassword || expectedPassword.length !== suppliedPassword.length) return false;

  return timingSafeEqual(
    Buffer.from(expectedPassword, "utf8"),
    Buffer.from(suppliedPassword, "utf8"),
  );
}
