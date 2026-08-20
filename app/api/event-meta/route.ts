import { NextResponse } from "next/server";
import { getAuthenticatedMember } from "@/lib/member-auth.server";
import { getDemoEvent, getDemoEventMeta, setDemoEventMeta } from "@/lib/demo-store";
import { getSupabaseAdmin, hasSupabaseConfig } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

const REACTIONS = ["HAHA", "İYİ SEÇİM", "GEÇMİŞ OLSUN", "BEN VARIM"] as const;
type Reaction = typeof REACTIONS[number];
type EventShape = { id?: string; phase?: string; joined?: string[] };

async function getCurrentEventRecord() {
  const client = getSupabaseAdmin();
  if (!client) return { event: getDemoEvent() as EventShape | null, dbId: undefined as string | undefined };
  const { data: group, error: groupError } = await client.from("groups").select("id").eq("slug", "unkan").single();
  if (groupError) throw new Error(`UNKAN group bulunamadı: ${groupError.message}`);
  const { data, error } = await client.from("events").select("id, client_state").eq("group_id", group.id).not("client_key", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Event okunamadı: ${error.message}`);
  return { event: data?.client_state as EventShape | null, dbId: data?.id as string | undefined };
}

function responseMeta(meta: { acknowledged: string[]; reactions: Record<string, string> }) {
  return NextResponse.json(meta, { headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  const member = await getAuthenticatedMember();
  if (!member) return NextResponse.json({ error: "Oturum bulunamadı." }, { status: 401 });
  try {
    const { event, dbId } = await getCurrentEventRecord();
    if (!event?.id || !dbId && hasSupabaseConfig()) return responseMeta({ acknowledged: [], reactions: {} });
    if (!event.joined?.includes(member.id)) return NextResponse.json({ error: "Bu masaya katılmadın." }, { status: 403 });
    if (hasSupabaseConfig()) {
      const client = getSupabaseAdmin();
      if (!client || !dbId) return responseMeta({ acknowledged: [], reactions: {} });
      const [ack, reactions] = await Promise.all([
        client.from("event_acknowledgements").select("member_id").eq("event_id", dbId),
        client.from("event_reactions").select("member_id, reaction").eq("event_id", dbId),
      ]);
      if (ack.error) throw new Error(`Görüldü durumu okunamadı: ${ack.error.message}`);
      if (reactions.error) throw new Error(`Tepkiler okunamadı: ${reactions.error.message}`);
      return responseMeta({ acknowledged: (ack.data ?? []).map((row) => row.member_id), reactions: Object.fromEntries((reactions.data ?? []).map((row) => [row.member_id, row.reaction])) });
    }
    return responseMeta(getDemoEventMeta(event.id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Event bilgileri okunamadı." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const member = await getAuthenticatedMember();
  if (!member) return NextResponse.json({ error: "Oturum bulunamadı." }, { status: 401 });
  const body = await request.json().catch(() => null) as { action?: "acknowledge" | "react"; reaction?: string } | null;
  try {
    const { event, dbId } = await getCurrentEventRecord();
    if (!event?.id || !event.joined?.includes(member.id)) return NextResponse.json({ error: "Bu masaya katılmadın." }, { status: 403 });
    const isFinal = event.phase === "final";
    const canReact = isFinal || event.phase === "result" || event.phase === "organizer";
    if (body?.action === "acknowledge" && !isFinal) return NextResponse.json({ error: "Plan henüz final değil." }, { status: 409 });
    if (body?.action === "react" && !canReact) return NextResponse.json({ error: "Tepki için sonuç ekranını bekle." }, { status: 409 });
    if (body?.action === "react" && !REACTIONS.includes(body.reaction as Reaction)) return NextResponse.json({ error: "Geçersiz tepki." }, { status: 400 });

    if (hasSupabaseConfig()) {
      const client = getSupabaseAdmin();
      if (!client || !dbId) throw new Error("Event kimliği bulunamadı.");
      if (body?.action === "acknowledge") {
        const { error } = await client.from("event_acknowledgements").upsert({ event_id: dbId, member_id: member.id }, { onConflict: "event_id,member_id" });
        if (error) throw new Error(`Görüldü durumu yazılamadı: ${error.message}`);
      } else if (body?.action === "react") {
        const { error } = await client.from("event_reactions").upsert({ event_id: dbId, member_id: member.id, reaction: body.reaction, updated_at: new Date().toISOString() }, { onConflict: "event_id,member_id" });
        if (error) throw new Error(`Tepki yazılamadı: ${error.message}`);
      }
      const [ack, reactions] = await Promise.all([
        client.from("event_acknowledgements").select("member_id").eq("event_id", dbId),
        client.from("event_reactions").select("member_id, reaction").eq("event_id", dbId),
      ]);
      return responseMeta({ acknowledged: (ack.data ?? []).map((row) => row.member_id), reactions: Object.fromEntries((reactions.data ?? []).map((row) => [row.member_id, row.reaction])) });
    }

    const meta = getDemoEventMeta(event.id);
    if (body?.action === "acknowledge" && !meta.acknowledged.includes(member.id)) meta.acknowledged.push(member.id);
    if (body?.action === "react") meta.reactions[member.id] = body.reaction as Reaction;
    return responseMeta(setDemoEventMeta(event.id, meta));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Event bilgileri kaydedilemedi." }, { status: 500 });
  }
}
