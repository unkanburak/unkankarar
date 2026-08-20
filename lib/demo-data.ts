export type Member = { id: string; name: string; initials: string; role: "ADMIN" | "MEMBER" };

export const MEMBERS: Member[] = [
  { id: "member_burak", name: "Burak", initials: "BU", role: "ADMIN" },
  { id: "member_emin", name: "Emin", initials: "EM", role: "MEMBER" },
  { id: "member_furkan", name: "Furkan", initials: "FU", role: "MEMBER" },
  { id: "member_erkut", name: "Erkut", initials: "ER", role: "MEMBER" },
  { id: "member_kubra", name: "Kübra", initials: "KÜ", role: "MEMBER" },
  { id: "member_buse", name: "Buse", initials: "BU", role: "MEMBER" },
  { id: "member_beyza", name: "Beyza", initials: "BE", role: "MEMBER" },
  { id: "member_kerim", name: "Kerim", initials: "KE", role: "MEMBER" },
];

export const INVITE_TOKENS: Record<string, string> = {
  "a8Fc29Lp": "member_burak",
  "e7Km41Qx": "member_emin",
  "f3Tn82Vz": "member_furkan",
  "r6Hy19Md": "member_erkut",
  "k9Pb53Ls": "member_kubra",
  "b2Nx74Rw": "member_buse",
  "z5Qc68Va": "member_beyza",
  "c4Jm27Tk": "member_kerim",
};

export function getMember(id: string) { return MEMBERS.find((member) => member.id === id) ?? null; }
export function getMemberByToken(token: string) { return getMember(INVITE_TOKENS[token] ?? ""); }
