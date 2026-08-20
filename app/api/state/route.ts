import { NextResponse } from "next/server";
import { getAuthenticatedMember } from "@/lib/member-auth.server";
import { getCancellationNotice, getDemoEvent, setCancellationNotice, setDemoEvent } from "@/lib/demo-store";
import { getSupabaseAdmin, hasSupabaseConfig } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type EventPayload = {
  id?: string;
  prompt?: string;
  optionSource?: "crowd" | "manual";
  planningMode?: "decision" | "schedule";
  category?: string;
  options?: string[];
  phase?: string;
  ideas?: Array<{ id?: string; authorId?: string; text?: string }>;
  placeIdeas?: Array<{ id?: string; authorId?: string; text?: string }>;
  organizerId?: string;
  organizerMessage?: string;
  organizerDetail?: string;
  roundEndsAt?: number;
  lockedAt?: string;
  winnerId?: string;
  voteRound?: number;
  joined?: string[];
  participants?: string[];
  [key: string]: unknown;
};

async function groupId(client: NonNullable<ReturnType<typeof getSupabaseAdmin>>) {
  const { data, error } = await client.from("groups").select("id").eq("slug", "unkan").single();
  if (error) throw new Error(`UNKAN group bulunamadı: ${error.message}`);
  return data.id as string;
}

async function persistentEvent() {
  const client = getSupabaseAdmin();
  if (!client) return null;
  const id = await groupId(client);
  const { data, error } = await client.from("events").select("id, client_state, created_at").eq("group_id", id).not("client_key", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Event okunamadı: ${error.message}`);
  return data?.client_state as EventPayload | null;
}

async function persistRelations(client: NonNullable<ReturnType<typeof getSupabaseAdmin>>, eventId: string, event: EventPayload) {
  const joined = event.joined ?? [];
  if (joined.length) {
    const { error } = await client.from("event_joins").upsert(joined.map((member_id) => ({ event_id: eventId, member_id })), { onConflict: "event_id,member_id", ignoreDuplicates: true });
    if (error) throw new Error(`Katılımcılar yazılamadı: ${error.message}`);
  }
  if (joined.length) {
    const { data: members } = await client.from("members").select("id, name").in("id", joined);
    if (members?.length) {
      const { error } = await client.from("event_members").upsert(members.map((member) => ({ event_id: eventId, member_id: member.id, snapshot_name: member.name })), { onConflict: "event_id,member_id" });
      if (error) throw new Error(`Üye snapshot'ı yazılamadı: ${error.message}`);
    }
  }
}

async function persistEvent(event: EventPayload, memberId: string) {
  const client = getSupabaseAdmin();
  if (!client) {
    setDemoEvent(event);
    setCancellationNotice(null);
    return;
  }
  const id = await groupId(client);
  const base = {
    group_id: id,
    prompt: event.prompt ?? "Bu gece ne yapıyoruz?",
    option_source: event.optionSource ?? "crowd",
    planning_mode: event.planningMode ?? "decision",
    category: event.category ?? "Özel",
    state: event.phase ?? "lobby",
    options: event.options ?? [],
    winner_id: event.winnerId ?? null,
    organizer_id: event.organizerId ?? null,
    organizer_message: event.organizerMessage ?? null,
    round_ends_at: event.roundEndsAt ? new Date(event.roundEndsAt).toISOString() : null,
    vote_round: event.voteRound ?? 1,
    created_by: memberId,
    locked_at: event.lockedAt ?? null,
    client_state: event,
  };
  const existing = await client.from("events").select("id").eq("group_id", id).eq("client_key", event.id).maybeSingle();
  if (existing.error) throw new Error(`Event aranamadı: ${existing.error.message}`);
  if (existing.data?.id) {
    const { error } = await client.from("events").update(base).eq("id", existing.data.id);
    if (error) throw new Error(`Event güncellenemedi: ${error.message}`);
    await persistRelations(client, existing.data.id, event);
  } else {
    const { data, error } = await client.from("events").insert({ ...base, client_key: event.id }).select("id").single();
    if (error) throw new Error(`Event oluşturulamadı: ${error.message}`);
    await persistRelations(client, data.id, event);
  }
  setCancellationNotice(null);
}

async function currentEvent() {
  return hasSupabaseConfig() ? persistentEvent() : getDemoEvent() as EventPayload | null;
}

function validateEvent(event: EventPayload | null) {
  if (!event || typeof event !== "object" || !event.id) return "Geçersiz event payload.";
  const single = (ideas: Array<{ authorId?: string }> | undefined, message: string) => {
    if (!ideas) return undefined;
    const authors = new Set<string>();
    for (const idea of ideas) {
      if (!idea.authorId) continue;
      if (authors.has(idea.authorId)) return message;
      authors.add(idea.authorId);
    }
    return undefined;
  };
  return single(event.ideas, "Bir üye en fazla 1 fikir atabilir.") ?? single(event.placeIdeas, "Bir üye en fazla 1 mekân önerebilir.");
}

function notice(cancelledAt = new Date().toISOString()) {
  return { id: `cancel_${cancelledAt}`, message: "Burak masayı bozdu.", cancelledAt };
}

const phaseRank: Record<string, number> = {
  lobby: 1,
  ideas: 2,
  voting: 3,
  result: 4,
  dayRound: 5,
  dayResult: 6,
  timeRound: 7,
  timeVoting: 8,
  timeResult: 9,
  placeIdeas: 10,
  placeVoting: 11,
  placeResult: 12,
  organizer: 13,
  final: 14,
  noDecision: 15,
  cancelled: 99,
};

export async function GET() {
  try {
    const event = await currentEvent();
    if (event?.phase === "cancelled") {
      const cancelled = notice(typeof event.cancelledAt === "string" ? event.cancelledAt : undefined);
      setDemoEvent(null);
      setCancellationNotice(cancelled);
      return NextResponse.json({ event: null, cancellation: cancelled }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ event, cancellation: getCancellationNotice() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "State okunamadı." }, { status: 500 });
  }
}

export async function DELETE() {
  const member = await getAuthenticatedMember();
  if (member?.role !== "ADMIN") return NextResponse.json({ error: "Masayı yalnızca Burak dağıtabilir." }, { status: 403 });
  const event = await currentEvent();
  if (!event) return NextResponse.json({ event: null });
  await persistEvent({ ...event, phase: "cancelled", cancelledAt: new Date().toISOString(), cancelledBy: member.id, roundEndsAt: undefined }, member.id);
  const cancelled = notice(new Date().toISOString());
  setCancellationNotice(cancelled);
  return NextResponse.json({ event: null, cancellation: cancelled });
}

export async function POST(request: Request) {
  const member = await getAuthenticatedMember();
  if (!member) return NextResponse.json({ error: "Oturum bulunamadı." }, { status: 401 });
  const body = await request.json().catch(() => null) as { event?: EventPayload } | null;
  const event = body?.event ?? null;
  const validationError = validateEvent(event);
  if (!event || validationError) return NextResponse.json({ error: validationError ?? "Geçersiz event payload." }, { status: 400 });
  const previousEvent = await currentEvent();
  if (previousEvent?.id && previousEvent.id === event.id && previousEvent.phase === "final" && event.phase !== "final") return NextResponse.json({ error: "Kapanmış plan yeniden açılamaz." }, { status: 409 });
  if (previousEvent?.id && previousEvent.id === event.id && previousEvent.phase !== "noDecision" && phaseRank[previousEvent.phase ?? ""] > phaseRank[event.phase ?? ""]) return NextResponse.json({ error: "Eski bir ekran state'i geri alamaz." }, { status: 409 });
  if (previousEvent?.id && previousEvent.id === event.id && previousEvent.organizerDetail !== event.organizerDetail) {
    if (previousEvent.phase !== "organizer" || member.id !== previousEvent.organizerId) return NextResponse.json({ error: "Ek mesajı yalnızca seçilmiş organizatör yazabilir." }, { status: 403 });
    if (!previousEvent.roundEndsAt || Date.now() > previousEvent.roundEndsAt) return NextResponse.json({ error: "15 saniyelik ek mesaj süresi doldu." }, { status: 409 });
  }
  if (!previousEvent && member.role !== "ADMIN") return NextResponse.json({ error: "Yeni masayı yalnızca Burak açabilir." }, { status: 403 });
  if (previousEvent?.id && previousEvent.id !== event.id && member.role !== "ADMIN") return NextResponse.json({ error: "Bu masayı yalnızca Burak değiştirebilir." }, { status: 403 });
  if (previousEvent?.id === event.id && member.role !== "ADMIN" && !(event.joined ?? []).includes(member.id)) return NextResponse.json({ error: "Önce bu karar masasına katılmalısın." }, { status: 403 });
  if (event.phase === "cancelled" && member.role !== "ADMIN") return NextResponse.json({ error: "Masayı yalnızca Burak dağıtabilir." }, { status: 403 });
  if (event.organizerId && (event.phase === "organizer" || event.phase === "final")) {
    const eligibleIds = event.planningMode === "schedule" && event.participants?.length ? event.participants : (event.joined ?? []);
    if (!eligibleIds.includes(event.organizerId)) return NextResponse.json({ error: "Organizatör yalnızca gerçek katılımcılar arasından seçilebilir." }, { status: 400 });
  }
  try {
    await persistEvent(event, member.id);
    return NextResponse.json({ event });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Event kaydedilemedi." }, { status: 500 });
  }
}
