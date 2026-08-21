"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight, CalendarPlus, Check, ChevronLeft, CircleHelp, ClipboardCheck, House, Instagram, MapPin, MessageCircle, Send, Share2, Sparkles, Users, Volume2, VolumeX, X, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Member } from "@/lib/demo-data";
import { MEMBERS } from "@/lib/demo-data";
import { motionTokens } from "@/lib/motion";

type OptionSource = "crowd" | "manual";
type PlanningMode = "decision" | "schedule";
type Phase = "home" | "create" | "lobby" | "ideas" | "voting" | "result" | "dayRound" | "dayResult" | "timeRound" | "timeVoting" | "timeResult" | "placeIdeas" | "placeVoting" | "placeResult" | "organizer" | "final" | "cancelled" | "noDecision";
type ResultStep = "opening" | "counting" | "eliminating" | "vader" | "winner";
type SoundEffect = "card" | "vote" | "eliminate" | "roulette" | "lock";
type CancellationNotice = { id: string; message: string; cancelledAt: string };
type EventMeta = { acknowledged: string[]; reactions: Record<string, string> };

let uiAudioContext: AudioContext | null = null;

type Idea = { id: string; text: string; authorId: string };
type Schedule = {
  availability: Record<string, string[]>;
  time: Record<string, string>;
  timeVotes?: Record<string, string>;
  dayOptions?: string[];
  selectedDay?: string;
  selectedTime?: string;
};
type EventData = {
  id: string;
  prompt: string;
  optionSource: OptionSource;
  planningMode: PlanningMode;
  category: string;
  options: string[];
  phase: Exclude<Phase, "home" | "create">;
  joined: string[];
  ideas: Idea[];
  ideasRevealed: boolean;
  votes: Record<string, string[]>;
  winnerId?: string;
  organizerId?: string;
  organizerMessage?: string;
  organizerDetail?: string;
  placeIdeas?: Idea[];
  placeVotes?: Record<string, string>;
  placeWinnerId?: string;
  schedule?: Schedule;
  participants?: string[];
  roundEndsAt?: number;
  voteRound?: number;
  failedRound?: "decision" | "day" | "timeSuggestion" | "timeVoting";
  createdAt: string;
  lockedAt?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  updatedAt?: number;
};

const CURRENT_EVENT_KEY = "unkan-current-event-v3";
const SOUND_SETTING_KEY = "unkan-sound-enabled";
const MAX_IDEAS_PER_MEMBER = 1;
const PROMPT_TEMPLATES = ["Bu gece ne yapıyoruz?", "Nerede buluşuyoruz?", "Ne izliyoruz?", "Ne oynuyoruz?", "Özel karar"];
const REACTION_OPTIONS = ["HAHA", "İYİ SEÇİM", "GEÇMİŞ OLSUN", "BEN VARIM"];
const REACTION_EMOJIS: Record<string, string> = { "HAHA": "😂", "İYİ SEÇİM": "👍", "GEÇMİŞ OLSUN": "😅", "BEN VARIM": "🙌" };

const copyForCount = (count: number) => {
  if (count === 0) return "Masa boş. Kaos kimse olmadan kaos değil.";
  if (count < 3) return "Millet toplanıyor.";
  if (count < 5) return "Üç kişi hâlâ gerçek hayatta.";
  if (count < 8) return "Bir kişi yüzünden demokrasi başlayamıyor.";
  return "TAM KADRO. Burak düğmeye bassın.";
};

function stageStatus(phase?: EventData["phase"]) {
  const labels: Partial<Record<EventData["phase"], string>> = {
    lobby: "Millet toplanıyor",
    ideas: "Fikirler masaya düşüyor",
    voting: "Oylar gizlice veriliyor",
    result: "Alternatifler eleniyor",
    dayRound: "Tarih havuzu açıldı",
    dayResult: "Tarih masada kalıyor",
    timeRound: "Saatler masaya geliyor",
    timeVoting: "Saatler gizlice oylanıyor",
    timeResult: "Saat belli oluyor",
    placeIdeas: "Mekân fikirleri düşüyor",
    placeVoting: "Mekânlar gizlice oylanıyor",
    placeResult: "Mekân masada kaldı",
    organizer: "Organizer seçiliyor",
    final: "Plan başladı",
    noDecision: "Masa yeni tur bekliyor",
  };
  return labels[phase ?? "lobby"] ?? "Karar masası";
}

const resultCopy = ["ELENDİ.", "BU GİTTİ.", "YOK.", "BURAYA KADAR."];
const PLACE_VOTE_CATEGORIES = new Set(["Buluşma", "Yemek", "Aktivite"]);

function randomId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatPlanDay(value?: string) {
  if (!value) return "—";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Intl.DateTimeFormat("tr-TR", { weekday: "long", day: "numeric", month: "long" })
    .format(new Date(`${value}T12:00:00`))
    .toLocaleUpperCase("tr-TR");
}

function formatDayCard(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return {
    weekday: new Intl.DateTimeFormat("tr-TR", { weekday: "long" }).format(date).toLocaleUpperCase("tr-TR"),
    date: new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long" }).format(date).toLocaleUpperCase("tr-TR"),
  };
}

function createDayOptions(count = 7) {
  const result: string[] = [];
  const today = new Date();
  for (let offset = 0; offset < count; offset += 1) {
    const day = new Date(today);
    day.setDate(today.getDate() + offset);
    result.push(new Date(day.getTime() - day.getTimezoneOffset() * 60_000).toISOString().slice(0, 10));
  }
  return result;
}

function chooseTop<T extends { count: number }>(items: T[]) {
  const sorted = [...items].sort((a, b) => b.count - a.count);
  const highest = sorted[0]?.count ?? 0;
  if (!highest) return undefined;
  const tied = sorted.filter((item) => item.count === highest);
  if (tied.length === 1) return tied[0];
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  return tied[random[0] % tied.length];
}

function percentageWinner(votes: Record<string, string[]>, optionIds: string[], participantCount = MEMBERS.length) {
  const counts = optionIds.map((id) => ({ id, count: Object.values(votes).filter((vote) => vote.includes(id)).length }));
  counts.sort((a, b) => b.count - a.count);
  const threshold = Math.floor(Math.max(1, participantCount) / 2) + 1;
  return { counts, threshold, winner: counts[0]?.count >= threshold ? counts[0].id : undefined };
}

function planExpiresAt(event: EventData) {
  const selectedDay = event.schedule?.selectedDay;
  if (selectedDay && /^\d{4}-\d{2}-\d{2}$/.test(selectedDay)) return new Date(`${selectedDay}T23:59:59.999`).getTime();
  if (event.lockedAt) {
    const locked = new Date(event.lockedAt);
    locked.setHours(23, 59, 59, 999);
    return locked.getTime();
  }
  return Number.POSITIVE_INFINITY;
}

function planStartsAt(event: EventData) {
  const selectedDay = event.schedule?.selectedDay;
  const selectedTime = event.schedule?.selectedTime;
  if (!selectedDay || !selectedTime) return undefined;
  const value = new Date(`${selectedDay}T${selectedTime}:00`).getTime();
  return Number.isFinite(value) ? value : undefined;
}

function waitingMemberNames(memberIds: string[], completedIds: string[]) {
  const completed = new Set(completedIds);
  return MEMBERS.filter((person) => memberIds.includes(person.id) && !completed.has(person.id)).map((person) => person.name);
}

function possessiveName(name: string) {
  const lower = name.toLocaleLowerCase("tr-TR");
  const lastVowel = [...lower].reverse().find((letter) => "aeıioöuü".includes(letter)) ?? "i";
  const suffix = "aı".includes(lastVowel) ? "ın" : "ei".includes(lastVowel) ? "in" : "ou".includes(lastVowel) ? "un" : "ün";
  const buffer = "aeıioöuü".includes(lower.at(-1) ?? "") ? "n" : "";
  return `${name}'${buffer}${suffix}`;
}

function formatCalendarStamp(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`;
}

function googleCalendarUrl(event: EventData, activity: string, organizerName: string) {
  const startsAt = planStartsAt(event);
  if (!startsAt) return undefined;
  const start = new Date(startsAt);
  const end = new Date(startsAt + 2 * 60 * 60 * 1000);
  const place = getPlaceWinner(event)?.text;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `UNKAN · ${activity}`,
    dates: `${formatCalendarStamp(start)}/${formatCalendarStamp(end)}`,
    details: [`Organizatör: ${organizerName}`, place ? `Mekân: ${place}` : "", event.organizerDetail ? `${possessiveName(organizerName)} ek mesajı: ${event.organizerDetail}` : "", "UNKAN'da karar verildi."].filter(Boolean).join("\n"),
    ctz: "Europe/Istanbul",
  });
  if (place || event.organizerDetail) params.set("location", [place, event.organizerDetail].filter(Boolean).join(" · "));
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function playUiSound(effect: SoundEffect, enabled: boolean) {
  if (!enabled || typeof window === "undefined") return;
  const AudioContextClass = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;
  uiAudioContext ??= new AudioContextClass();
  const context = uiAudioContext;
  if (context.state === "suspended") void context.resume();
  const profiles: Record<SoundEffect, Array<[number, number, number, OscillatorType, number]>> = {
    card: [[0, 190, .07, "triangle", .055], [.045, 120, .08, "sine", .035]],
    vote: [[0, 420, .045, "sine", .04], [.04, 610, .055, "triangle", .035]],
    eliminate: [[0, 180, .09, "sawtooth", .035], [.07, 82, .16, "triangle", .06]],
    roulette: [[0, 520, .04, "triangle", .035], [.06, 410, .05, "triangle", .04], [.13, 260, .1, "sine", .055]],
    lock: [[0, 150, .06, "square", .035], [.055, 92, .12, "triangle", .065]],
  };
  const now = context.currentTime;
  for (const [delay, frequency, duration, type, volume] of profiles[effect]) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now + delay);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(55, frequency * .72), now + delay + duration);
    gain.gain.setValueAtTime(.0001, now + delay);
    gain.gain.exponentialRampToValueAtTime(volume, now + delay + .008);
    gain.gain.exponentialRampToValueAtTime(.0001, now + delay + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now + delay);
    oscillator.stop(now + delay + duration + .01);
  }
  if (navigator.vibrate) navigator.vibrate(effect === "lock" ? 16 : 8);
}

function getOptionList(event: EventData) {
  return event.optionSource === "crowd"
    ? event.ideas.map((idea) => ({ id: idea.id, text: idea.text }))
    : event.options.map((text, index) => ({ id: `option_${index}`, text }));
}

function getPlaceWinner(event: EventData) {
  return event.placeIdeas?.find((idea) => idea.id === event.placeWinnerId);
}

function nextRound<T extends EventData>(event: T, phase: EventData["phase"]): T {
  return { ...event, phase, roundEndsAt: Date.now() + 60_000 };
}

function getOrganizerCandidates(event: EventData) {
  const eligibleIds = event.planningMode === "schedule" && event.participants?.length ? event.participants : event.joined;
  return MEMBERS.filter((member) => eligibleIds.includes(member.id));
}

function getOrganizer(event: EventData) {
  const safeCandidates = getOrganizerCandidates(event);
  if (!safeCandidates.length) return undefined;
  const previous = event.organizerId;
  const filtered = safeCandidates.length > 1 ? safeCandidates.filter((member) => member.id !== previous) : safeCandidates;
  const pool = filtered.length ? filtered : safeCandidates;
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  return pool[random[0] % pool.length];
}

export default function UnkanApp() {
  const [member, setMember] = useState<Member | null>(null);
  const [event, setEvent] = useState<EventData | null>(null);
  const [phase, setPhase] = useState<Phase>("home");
  const [quickStart, setQuickStart] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmExit, setConfirmExit] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [eventMeta, setEventMeta] = useState<EventMeta>({ acknowledged: [], reactions: {} });
  const seenCancellationId = useRef<string | null>(null);
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lastSaveRef = useRef<{ fingerprint: string; at: number } | null>(null);
  const metaWriteRef = useRef(0);
  const cancelInFlightRef = useRef(false);
  const localRevisionRef = useRef(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    let active = true;
    const savedSoundSetting = window.localStorage.getItem(SOUND_SETTING_KEY);
    setSoundEnabled(savedSoundSetting === null ? true : savedSoundSetting === "true");
    fetch("/api/me", { credentials: "include", cache: "no-store" }).then((response) => response.json()).then((data) => { if (active) setMember(data.member); });
    const saved = window.localStorage.getItem(CURRENT_EVENT_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as EventData;
        setEvent(parsed);
        localRevisionRef.current = parsed.updatedAt ?? 0;
        setPhase(parsed.phase === "final" ? "home" : parsed.phase);
      } catch { window.localStorage.removeItem(CURRENT_EVENT_KEY); }
    }
    const applyRemoteEvent = (parsed: EventData) => {
      if (!active) return false;
      const remoteRevision = parsed.updatedAt ?? 0;
      if (remoteRevision && localRevisionRef.current > remoteRevision) return false;
      localRevisionRef.current = Math.max(localRevisionRef.current, remoteRevision);
      setEvent((current) => {
        if (current?.id === parsed.id && current.updatedAt && remoteRevision && remoteRevision < current.updatedAt) return current;
        return current && JSON.stringify(current) === JSON.stringify(parsed) ? current : parsed;
      });
      setPhase((current) => current === "home" || current === "create" ? current : (parsed.phase === "final" ? "final" : parsed.phase));
      const serialized = JSON.stringify(parsed);
      if (window.localStorage.getItem(CURRENT_EVENT_KEY) !== serialized) window.localStorage.setItem(CURRENT_EVENT_KEY, serialized);
      return true;
    };
    fetch("/api/state").then((response) => response.json()).then((data: { event?: EventData | null; cancellation?: CancellationNotice | null }) => {
      if (!active) return;
      if (data.event) {
        const parsed = data.event;
        applyRemoteEvent(parsed);
      } else {
        setEvent(null);
        setPhase("home");
        window.localStorage.removeItem(CURRENT_EVENT_KEY);
        if (data.cancellation) {
          seenCancellationId.current = data.cancellation.id;
          showToast(data.cancellation.message);
        }
      }
    }).catch(() => { /* local fallback remains available when the demo server is unavailable */ }).finally(() => { if (active) setHydrated(true); });
    const sync = () => {
      if (!active) return;
      fetch("/api/state").then((response) => response.json()).then((data: { event?: EventData | null; cancellation?: CancellationNotice | null }) => {
        if (!active) return;
        if (data.event) {
          const parsed = data.event;
          applyRemoteEvent(parsed);
          return;
        }

        if (localRevisionRef.current && !data.cancellation) return;
        const isNewCancellation = Boolean(data.cancellation?.id && data.cancellation.id !== seenCancellationId.current);
        if (data.cancellation?.id) seenCancellationId.current = data.cancellation.id;
        setEvent(null);
        window.localStorage.removeItem(CURRENT_EVENT_KEY);
        if (isNewCancellation) {
          setConfirmExit(false);
          setConfirmCancel(false);
          setPhase("home");
          showToast(data.cancellation?.message ?? "Burak masayı bozdu.");
        } else {
          setPhase((current) => current === "create" ? current : "home");
        }
      }).catch(() => { /* local fallback remains available */ });
    };
    window.addEventListener("storage", sync);
    const interval = window.setInterval(sync, 1000);
    return () => { active = false; window.removeEventListener("storage", sync); window.clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (!member || !event || !["result", "organizer", "final"].includes(event.phase)) {
      setEventMeta({ acknowledged: [], reactions: {} });
      return;
    }
    let active = true;
    const loadMeta = () => fetch("/api/event-meta", { credentials: "include", cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((data: EventMeta | null) => { if (active && data) setEventMeta(data); }).catch(() => undefined);
    void loadMeta();
    const interval = window.setInterval(loadMeta, 1800);
    return () => { active = false; window.clearInterval(interval); };
  }, [member?.id, event?.id, event?.phase]);

  useEffect(() => {
    if (!hydrated || !member || !event || event.phase === "final" || event.phase === "cancelled") return;
    if (!event.joined.includes(member.id)) {
      const next = { ...event, joined: [...event.joined, member.id] };
      saveEvent(next);
    }
  }, [hydrated, member, event]);

  useEffect(() => {
    if (!event || event.phase !== "result" || event.winnerId || member?.role !== "ADMIN") return;
    const timer = window.setTimeout(() => {
      const ids = getOptionList(event).map((option) => option.id);
      const result = percentageWinner(event.votes, ids, event.joined.length);
      const winnerId = result.winner ?? result.counts[0]?.id;
      const next = { ...event, winnerId, phase: "result" as const };
      saveEvent(next);
    }, event.planningMode === "schedule" ? 20 : (reducedMotion ? 20 : 2350));
    return () => window.clearTimeout(timer);
  }, [event, member?.role, reducedMotion]);

  useEffect(() => {
    if (!event || event.phase !== "result" || !event.winnerId || member?.role !== "ADMIN") return;
    const timer = window.setTimeout(() => {
      if (event.planningMode === "schedule" && !event.schedule?.selectedDay) {
        const schedule = event.schedule ?? { availability: {}, time: {}, dayOptions: createDayOptions() };
        saveEvent(nextRound({ ...event, schedule: { ...schedule, dayOptions: schedule.dayOptions?.length ? schedule.dayOptions : createDayOptions() } }, "dayRound"));
        return;
      }
      const organizer = getOrganizer(event);
      if (!organizer) return;
      saveEvent({ ...event, phase: "organizer", organizerId: organizer.id, organizerMessage: "Bu organizeyi sen yapacaksın, sana güveniyorum. Lütfen görevini aksatma :)", roundEndsAt: Date.now() + 15_000 });
    }, event.planningMode === "schedule" ? 20 : (reducedMotion ? 5000 : 7000));
    return () => window.clearTimeout(timer);
  }, [event, member?.role, reducedMotion]);

  useEffect(() => {
    if (!event || member?.role !== "ADMIN") return;
    const timer = window.setInterval(() => {
      const expired = Boolean(event.roundEndsAt && Date.now() >= event.roundEndsAt);

      if (event.phase === "ideas") {
        const completed = new Set(event.ideas.map((idea) => idea.authorId)).size;
        const eligibleCount = Math.max(1, event.joined.length);
        if (!event.ideasRevealed && (completed >= eligibleCount || expired)) {
          if (event.ideas.length < 2) {
            saveEvent({ ...event, phase: "noDecision", failedRound: "decision", roundEndsAt: undefined });
          } else {
            saveEvent({ ...event, ideasRevealed: true, roundEndsAt: Date.now() + 2_000 });
          }
        } else if (event.ideasRevealed && expired) {
          saveEvent(nextRound({ ...event, votes: {}, voteRound: 1 }, "voting"));
        }
      }

      if (event.phase === "voting") {
        const validVotes = Object.keys(event.votes).length;
        const eligibleCount = Math.max(1, event.joined.length);
        const quorum = Math.floor(eligibleCount / 2) + 1;
        if (validVotes >= eligibleCount || expired) {
          if (validVotes < quorum) {
            if ((event.voteRound ?? 1) < 2) {
              saveEvent(nextRound({ ...event, votes: {}, voteRound: 2 }, "voting"));
            } else {
              saveEvent({ ...event, phase: "noDecision", failedRound: "decision", roundEndsAt: undefined });
            }
          } else {
            saveEvent({ ...event, phase: "result", roundEndsAt: undefined });
          }
        }
      }

      if (event.phase === "dayRound") {
        const schedule = event.schedule ?? { availability: {}, time: {}, dayOptions: createDayOptions() };
        const completed = Object.keys(schedule.availability).length;
        const eligibleCount = Math.max(1, event.joined.length);
        if (expired && completed < eligibleCount) {
          saveEvent({ ...event, phase: "noDecision", failedRound: "day", roundEndsAt: undefined });
        } else if (completed >= eligibleCount) {
          const dayOptions = schedule.dayOptions?.length ? schedule.dayOptions : createDayOptions();
          const selectedDay = chooseTop(dayOptions.map((day) => ({ day, count: Object.values(schedule.availability).filter((days) => days.includes(day)).length })))?.day;
          if (!selectedDay) saveEvent({ ...event, phase: "noDecision", failedRound: "day", roundEndsAt: undefined });
          else saveEvent({ ...event, phase: "dayResult", schedule: { ...schedule, dayOptions, selectedDay }, roundEndsAt: undefined });
        }
      }

      if (event.phase === "timeRound") {
        const schedule = event.schedule ?? { availability: {}, time: {} };
        const completed = Object.keys(schedule.time).length;
        const eligibleIds = event.joined;
        const eligibleCount = Math.max(1, eligibleIds.length);
        if (expired && completed < eligibleCount) {
          saveEvent({ ...event, phase: "noDecision", failedRound: "timeSuggestion", roundEndsAt: undefined });
        } else if (completed >= eligibleCount) {
          const uniqueTimes = [...new Set(Object.values(schedule.time).filter(Boolean))];
          if (!uniqueTimes.length || !schedule.selectedDay) {
            saveEvent({ ...event, phase: "noDecision", failedRound: "timeSuggestion", roundEndsAt: undefined });
          } else {
            saveEvent(nextRound({ ...event, phase: "timeVoting", schedule: { ...schedule, timeVotes: {} } }, "timeVoting"));
          }
        }
      }

      if (event.phase === "timeVoting") {
        const schedule = event.schedule ?? { availability: {}, time: {}, timeVotes: {} };
        const timeVotes = schedule.timeVotes ?? {};
        const completed = Object.keys(timeVotes).length;
        const eligibleIds = event.joined;
        const eligibleCount = Math.max(1, eligibleIds.length);
        if (expired && completed < eligibleCount) {
          saveEvent({ ...event, phase: "noDecision", failedRound: "timeVoting", roundEndsAt: undefined });
        } else if (completed >= eligibleCount) {
          const uniqueTimes = [...new Set(Object.values(schedule.time).filter(Boolean))];
          const selectedTime = chooseTop(uniqueTimes.map((time) => ({ time, count: Object.values(timeVotes).filter((vote) => vote === time).length })))?.time;
          if (!selectedTime || !schedule.selectedDay) {
            saveEvent({ ...event, phase: "noDecision", failedRound: "timeVoting", roundEndsAt: undefined });
          } else {
            const organizerEligibleIds = eligibleIds.filter((memberId) => schedule.availability[memberId]?.includes(schedule.selectedDay ?? ""));
            saveEvent({
              ...event,
              phase: "timeResult",
              schedule: { ...schedule, selectedTime },
              participants: organizerEligibleIds,
              roundEndsAt: undefined,
            });
          }
        }
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [event, member?.role]);

  useEffect(() => {
    if (!event || event.phase !== "dayResult" || !event.schedule?.selectedDay || member?.role !== "ADMIN") return;
    const schedule = event.schedule;
    const timer = window.setTimeout(() => saveEvent(nextRound({ ...event, schedule: { ...schedule, time: {} } }, "timeRound")), reducedMotion ? 20 : 2600);
    return () => window.clearTimeout(timer);
  }, [event, member?.role, reducedMotion]);

  useEffect(() => {
    if (!event || event.phase !== "timeResult" || !event.schedule?.selectedTime || member?.role !== "ADMIN") return;
    const timer = window.setTimeout(() => {
      if (PLACE_VOTE_CATEGORIES.has(event.category)) {
        saveEvent(nextRound({ ...event, placeIdeas: [], placeVotes: {}, placeWinnerId: undefined }, "placeIdeas"));
        return;
      }
      const organizer = getOrganizer(event);
      if (!organizer) return;
      saveEvent({ ...event, phase: "organizer", organizerId: organizer.id, organizerMessage: "Bu organizeyi sen yapacaksın, sana güveniyorum. Lütfen görevini aksatma :)", roundEndsAt: Date.now() + 15_000 });
    }, reducedMotion ? 20 : 2600);
    return () => window.clearTimeout(timer);
  }, [event, member?.role, reducedMotion]);

  useEffect(() => {
    if (!event || member?.role !== "ADMIN") return;
    if (event.phase === "placeIdeas") {
      const eligibleIds = event.participants?.length ? event.participants : event.joined;
      const completed = new Set((event.placeIdeas ?? []).map((idea) => idea.authorId)).size;
      if (completed >= eligibleIds.length && eligibleIds.length) {
        if ((event.placeIdeas ?? []).length === 1) {
          saveEvent({ ...event, phase: "placeResult", placeWinnerId: event.placeIdeas?.[0]?.id, roundEndsAt: undefined });
        } else {
          saveEvent(nextRound({ ...event, placeVotes: {} }, "placeVoting"));
        }
      }
    }
    if (event.phase === "placeVoting") {
      const eligibleIds = event.participants?.length ? event.participants : event.joined;
      const completed = Object.keys(event.placeVotes ?? {}).length;
      if (completed >= eligibleIds.length && eligibleIds.length) {
        const winner = chooseTop((event.placeIdeas ?? []).map((idea) => ({ id: idea.id, count: Object.values(event.placeVotes ?? {}).filter((vote) => vote === idea.id).length })));
        if (winner) saveEvent({ ...event, phase: "placeResult", placeWinnerId: winner.id, roundEndsAt: undefined });
      }
    }
  }, [event, member?.role]);

  useEffect(() => {
    if (!event || event.phase !== "placeResult" || !event.placeWinnerId || member?.role !== "ADMIN") return;
    const timer = window.setTimeout(() => {
      const organizer = getOrganizer(event);
      if (!organizer) return;
      saveEvent({ ...event, phase: "organizer", organizerId: organizer.id, organizerMessage: "Bu organizeyi sen yapacaksın, sana güveniyorum. Lütfen görevini aksatma :)", roundEndsAt: Date.now() + 15_000 });
    }, reducedMotion ? 5000 : 7000);
    return () => window.clearTimeout(timer);
  }, [event, member?.role, reducedMotion]);

  useEffect(() => {
    if (!event || event.phase !== "organizer" || member?.role !== "ADMIN") return;
    const eligibleIds = getOrganizerCandidates(event).map((person) => person.id);
    if (!event.organizerId || !eligibleIds.includes(event.organizerId)) {
      const organizer = getOrganizer({ ...event, organizerId: undefined });
      if (organizer) saveEvent({ ...event, organizerId: organizer.id, organizerMessage: "Bu organizeyi sen yapacaksın, sana güveniyorum. Lütfen görevini aksatma :)", roundEndsAt: Date.now() + 15_000 });
      return;
    }
    if (!event.roundEndsAt) {
      saveEvent({ ...event, roundEndsAt: Date.now() + 15_000 });
      return;
    }
    const waitTime = event.organizerDetail ? 80 : Math.max(0, event.roundEndsAt - Date.now());
    const timer = window.setTimeout(() => {
      saveEvent({ ...event, phase: "final", roundEndsAt: undefined, lockedAt: event.lockedAt ?? new Date().toISOString() });
    }, reducedMotion && !event.organizerDetail ? Math.min(waitTime, 15_000) : waitTime);
    return () => window.clearTimeout(timer);
  }, [event, member?.role, reducedMotion]);

  function saveEvent(next: EventData) {
    const { updatedAt: _ignoredUpdatedAt, ...eventWithoutRevision } = next;
    const fingerprint = JSON.stringify(eventWithoutRevision);
    const now = Date.now();
    if (lastSaveRef.current?.fingerprint === fingerprint && now - lastSaveRef.current.at < 900) return;
    lastSaveRef.current = { fingerprint, at: now };
    const updatedAt = Math.max(Date.now(), localRevisionRef.current + 1, next.updatedAt ?? 0);
    localRevisionRef.current = updatedAt;
    const savedEvent = { ...next, updatedAt };
    setEvent(savedEvent);
    setPhase(savedEvent.phase);
    window.localStorage.setItem(CURRENT_EVENT_KEY, JSON.stringify(savedEvent));
    const send = async () => {
      let lastError = "State kaydedilemedi.";
      const reconcile = async () => {
        if (localRevisionRef.current !== savedEvent.updatedAt) return;
        try {
          const response = await fetch("/api/state", { credentials: "include", cache: "no-store" });
          const data = await response.json() as { event?: EventData | null };
          if (!data.event) return;
          if (localRevisionRef.current !== savedEvent.updatedAt) return;
          if (data.event.updatedAt && savedEvent.updatedAt && data.event.updatedAt < savedEvent.updatedAt) return;
          localRevisionRef.current = Math.max(localRevisionRef.current, data.event.updatedAt ?? 0);
          setEvent(data.event);
          setPhase(data.event.phase);
          window.localStorage.setItem(CURRENT_EVENT_KEY, JSON.stringify(data.event));
        } catch {
          // Keep the optimistic state when the browser is offline.
        }
      };
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await fetch("/api/state", {
            method: "POST",
            credentials: "include",
            cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ event: savedEvent }),
          });
          if (response.ok) {
            const data = await response.json().catch(() => ({})) as { event?: EventData | null };
            if (data.event && localRevisionRef.current === savedEvent.updatedAt && (data.event.updatedAt ?? 0) >= (savedEvent.updatedAt ?? 0)) {
              localRevisionRef.current = data.event.updatedAt ?? localRevisionRef.current;
              setEvent(data.event);
              setPhase(data.event.phase);
              window.localStorage.setItem(CURRENT_EVENT_KEY, JSON.stringify(data.event));
            }
            return;
          }
          if (response.status === 409) {
            await reconcile();
            return;
          }
          const data = await response.json().catch(() => ({})) as { error?: string };
          lastError = data.error ?? lastError;
        } catch {
          lastError = "Sunucuya bağlanılamadı.";
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, 200 * (attempt + 1)));
      }
      await reconcile();
      showToast(`${lastError} Tekrar dene.`);
    };
    writeQueueRef.current = writeQueueRef.current.then(send).catch(() => undefined);
  }

  async function cancelTable() {
    if (cancelInFlightRef.current) return;
    cancelInFlightRef.current = true;
    setConfirmCancel(false);
    try {
      const response = await fetch("/api/state", { method: "DELETE", credentials: "include", cache: "no-store" });
      const data = await response.json() as { cancellation?: CancellationNotice; error?: string };
      if (!response.ok) {
        showToast(data.error ?? "Masa dağıtılamadı.");
        return;
      }
      if (data.cancellation) seenCancellationId.current = data.cancellation.id;
      setEvent(null);
      setPhase("home");
      window.localStorage.removeItem(CURRENT_EVENT_KEY);
      showToast(data.cancellation?.message ?? "Burak masayı bozdu.");
    } finally {
      cancelInFlightRef.current = false;
    }
  }

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 3000);
  }

  async function updateEventMeta(action: "acknowledge" | "react", reaction?: string) {
    if (action === "acknowledge" && Date.now() - metaWriteRef.current < 900) return;
    if (action === "acknowledge") metaWriteRef.current = Date.now();
    try {
      const response = await fetch("/api/event-meta", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, reaction }) });
      const data = await response.json() as EventMeta & { error?: string };
      if (!response.ok) return showToast(data.error ?? "Masa bilgisi güncellenemedi.");
      setEventMeta({ acknowledged: data.acknowledged ?? [], reactions: data.reactions ?? {} });
      if (action === "acknowledge") playUiSound("vote", soundEnabled);
      else playUiSound("card", soundEnabled);
    } catch {
      showToast("Sunucuya bağlanılamadı.");
    }
  }

  function requestHome() {
    if (phase === "home") return;
    setConfirmExit(true);
  }

  function leaveToHome() {
    setConfirmExit(false);
    setPhase("home");
  }

  function toggleSound() {
    const next = !soundEnabled;
    setSoundEnabled(next);
    window.localStorage.setItem(SOUND_SETTING_KEY, String(next));
    if (next) playUiSound("vote", true);
  }

  if (!hydrated) return <div className="app-shell" />;

  return (
    <main className="app-shell">
      <div className="grain" />
      <div className="container">
        <header className="topbar">
          <button className="brand" onClick={requestHome} aria-label="UNKAN ana sayfa">
            <span className="brand-mark"><span>U</span></span> UNKAN
          </button>
          {member ? <div className="topbar-actions">{phase !== "home" ? <button className="home-link" onClick={requestHome}><House size={15} /> Ana sayfa</button> : null}{member.role === "ADMIN" && event && phase !== "home" && phase !== "create" && phase !== "cancelled" ? <button className="cancel-table-button" aria-label="Masayı dağıt" title="Masayı dağıt" onClick={() => setConfirmCancel(true)}><X size={14} /> Masayı dağıt</button> : null}<button className={`sound-toggle ${soundEnabled ? "active" : ""}`} onClick={toggleSound} aria-label={soundEnabled ? "Sesleri kapat" : "Sesleri aç"} title={soundEnabled ? "Sesler açık" : "Sesler kapalı"}>{soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}</button><div className="member-pill"><span className="member-dot" />{member.name}{member.role === "ADMIN" && <span className="admin-tag">ADMIN</span>}</div></div> : null}
        </header>

        {member && event && phase !== "home" && phase !== "create" ? <div className="stage-status-pill"><span className="member-dot" />{stageStatus(event.phase)}</div> : null}

        {!member ? <Welcome /> : phase === "home" ? <Home member={member} event={event} onCreate={(isQuick) => { setQuickStart(isQuick); setPhase("create"); }} onOpen={() => setPhase(event ? event.phase : "home")} /> : null}
        {member && phase === "create" ? <CreateScreen member={member} quick={quickStart} onBack={requestHome} onCreate={(created) => { saveEvent(created); }} /> : null}
        {member && event && phase === "lobby" ? <Lobby event={event} member={member} onStart={() => {
          saveEvent(nextRound({ ...event, voteRound: 1 }, event.optionSource === "manual" ? "voting" : "ideas"));
        }} onBack={requestHome} /> : null}
        {member && event && phase === "ideas" ? <IdeasStage event={event} member={member} onBack={requestHome} onSubmit={(text) => {
          if (event.ideas.filter((idea) => idea.authorId === member.id).length >= MAX_IDEAS_PER_MEMBER) return showToast("Tek fikir hakkını kullandın.");
          playUiSound("card", soundEnabled);
          saveEvent({ ...event, ideas: [...event.ideas, { id: randomId("idea"), text, authorId: member.id }] });
        }} onReveal={() => saveEvent({ ...event, ideasRevealed: true, roundEndsAt: Date.now() + 7_000 })} onOpenVoting={() => saveEvent(nextRound({ ...event, votes: {}, voteRound: 1 }, "voting"))} /> : null}
        {member && event && phase === "voting" ? <VotingStage event={event} member={member} onVote={(selected) => {
          playUiSound("vote", soundEnabled);
          const votes = { ...event.votes, [member.id]: selected };
          const complete = Object.keys(votes).length >= event.joined.length;
          saveEvent({ ...event, votes, phase: complete ? "result" : event.phase, roundEndsAt: complete ? undefined : event.roundEndsAt });
        }} onClose={() => {
          const validVotes = Object.keys(event.votes).length;
          const quorum = Math.floor(Math.max(1, event.joined.length) / 2) + 1;
          if (validVotes >= quorum) saveEvent({ ...event, phase: "result", roundEndsAt: undefined });
          else if ((event.voteRound ?? 1) < 2) saveEvent(nextRound({ ...event, votes: {}, voteRound: 2 }, "voting"));
          else saveEvent({ ...event, phase: "noDecision", roundEndsAt: undefined });
        }} /> : null}
        {member && event && phase === "result" && event.planningMode === "decision" ? <ResultStage event={event} reducedMotion={reducedMotion ?? false} soundEnabled={soundEnabled} meta={eventMeta} onReact={(reaction) => void updateEventMeta("react", reaction)} /> : null}
        {member && event && phase === "dayRound" ? <DayRoundStage event={event} member={member} onSubmit={(days) => { playUiSound("vote", soundEnabled); saveEvent({ ...event, schedule: { ...(event.schedule ?? { availability: {}, time: {} }), availability: { ...(event.schedule?.availability ?? {}), [member.id]: days } } }); }} /> : null}
        {member && event && phase === "dayResult" ? <SchedulePoolResult event={event} kind="day" meta={eventMeta} onReact={(reaction) => void updateEventMeta("react", reaction)} /> : null}
        {member && event && phase === "timeRound" ? <TimeRoundStage event={event} member={member} onSubmit={(time) => { playUiSound("card", soundEnabled); saveEvent({ ...event, schedule: { ...(event.schedule ?? { availability: {}, time: {} }), time: { ...(event.schedule?.time ?? {}), [member.id]: time } } }); }} /> : null}
        {member && event && phase === "timeVoting" ? <TimeVotingStage event={event} member={member} onVote={(time) => { playUiSound("vote", soundEnabled); saveEvent({ ...event, schedule: { ...(event.schedule ?? { availability: {}, time: {} }), timeVotes: { ...(event.schedule?.timeVotes ?? {}), [member.id]: time } } }); }} /> : null}
        {member && event && phase === "timeResult" ? <SchedulePoolResult event={event} kind="time" meta={eventMeta} onReact={(reaction) => void updateEventMeta("react", reaction)} /> : null}
        {member && event && phase === "placeIdeas" ? <PlaceIdeasStage event={event} member={member} onSubmit={(text) => { playUiSound("card", soundEnabled); saveEvent({ ...event, placeIdeas: [...(event.placeIdeas ?? []), { id: randomId("place"), text, authorId: member.id }] }); }} /> : null}
        {member && event && phase === "placeVoting" ? <PlaceVotingStage event={event} member={member} onVote={(placeId) => { playUiSound("vote", soundEnabled); saveEvent({ ...event, placeVotes: { ...(event.placeVotes ?? {}), [member.id]: placeId } }); }} /> : null}
        {member && event && phase === "placeResult" ? <PlaceResultStage event={event} soundEnabled={soundEnabled} meta={eventMeta} onReact={(reaction) => void updateEventMeta("react", reaction)} /> : null}
        {member && event && phase === "organizer" ? <OrganizerStage event={event} member={member} soundEnabled={soundEnabled} meta={eventMeta} onReact={(reaction) => void updateEventMeta("react", reaction)} onSubmit={(detail) => saveEvent({ ...event, organizerDetail: detail.trim() })} /> : null}
        {member && event && phase === "final" ? <FinalStage event={event} member={member} soundEnabled={soundEnabled} meta={eventMeta} onAcknowledge={() => void updateEventMeta("acknowledge")} onReact={(reaction) => void updateEventMeta("react", reaction)} onBack={() => setPhase("home")} /> : null}
        {member && event && phase === "cancelled" ? <CancelledStage member={member} onBack={() => setPhase("home")} onCreate={() => { setQuickStart(false); setPhase("create"); }} /> : null}
        {member && event && phase === "noDecision" ? <NoDecisionStage member={member} failedRound={event.failedRound} onRetry={() => {
          if (event.failedRound === "day") return saveEvent(nextRound({ ...event, failedRound: undefined, schedule: { ...(event.schedule ?? { availability: {}, time: {}, dayOptions: createDayOptions() }), availability: {}, selectedDay: undefined } }, "dayRound"));
          if (event.failedRound === "timeSuggestion") return saveEvent(nextRound({ ...event, failedRound: undefined, schedule: { ...(event.schedule ?? { availability: {}, time: {} }), time: {}, timeVotes: {}, selectedTime: undefined } }, "timeRound"));
          if (event.failedRound === "timeVoting") return saveEvent(nextRound({ ...event, failedRound: undefined, schedule: { ...(event.schedule ?? { availability: {}, time: {} }), timeVotes: {}, selectedTime: undefined } }, "timeVoting"));
          saveEvent(nextRound({ ...event, failedRound: undefined, votes: {}, voteRound: 1 }, event.optionSource === "manual" ? "voting" : "ideas"));
        }} onBack={requestHome} /> : null}
        <div className="footer-note">Kaos içeri girer · tek karar dışarı çıkar</div>
      </div>
      {toast ? <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="toast">{toast}</motion.div> : null}
      <AnimatePresence>{confirmExit ? <ExitConfirm onCancel={() => setConfirmExit(false)} onConfirm={leaveToHome} /> : null}</AnimatePresence>
      <AnimatePresence>{confirmCancel && event ? <CancelTableConfirm onCancel={() => setConfirmCancel(false)} onConfirm={() => { void cancelTable(); }} /> : null}</AnimatePresence>
    </main>
  );
}

function Welcome() {
  return <section className="hero">
    <div className="eyebrow">Özel karar masası · 8 kişi</div>
    <h1>Kaos içeri girer.<br /><span style={{ color: "var(--acid)" }}>Karar</span> dışarı çıkar.</h1>
    <p>UNKAN, karar veremeyen arkadaş grupları için küçük bir party game. Burak masayı açar, herkes girer, tek seçenek hayatta kalır.</p>
    <div className="hero-rule">Devam etmek için ismine dokun ve kişisel şifreni gir.</div>
    <MemberLoginPanel />
  </section>;
}

function Home({ member, event, onCreate, onOpen }: { member: Member; event: EventData | null; onCreate: (isQuick: boolean) => void; onOpen: () => void }) {
  const activeEvent = event?.phase === "final" || event?.phase === "cancelled" ? null : event;
  const lastPlan = event?.phase === "final" && planExpiresAt(event) >= Date.now() ? event : null;
  const lastWinner = lastPlan ? getOptionList(lastPlan).find((option) => option.id === lastPlan.winnerId) : undefined;
  const lastOrganizer = lastPlan ? MEMBERS.find((person) => person.id === lastPlan.organizerId) : undefined;
  return <section className="home-section">
    <div className="hero" style={{ paddingBottom: 40 }}>
      <div className="eyebrow">Hoş geldin</div>
      <h1>Ne<br /><span style={{ color: "var(--acid)" }}>yapıyoruz?</span></h1>
      <p>Kaosu masaya bırak. Sonra geri kalanını UNKAN halleder.</p>
    </div>
    {activeEvent ? <button className="surface calm-card" style={{ width: "100%", color: "inherit", textAlign: "left" }} onClick={onOpen}>
      <div><div className="eyebrow">Aktif masa · {activeEvent.joined.length}/8</div><h2>{activeEvent.prompt}</h2><p className="muted">Millet masaya oturuyor.</p></div>
      <div className="action-row"><span className="button ghost">Masaya dön <ArrowUpRight size={16} /></span></div>
    </button> : <><div className="surface calm-card">
      <div><div className="eyebrow">Şu an</div><h2>{member.role === "ADMIN" ? "ORTALIK SAKİN." : "BURAK BEKLENİYOR."}</h2><p className="muted">{member.role === "ADMIN" ? "Yeni kaos için masa hazır." : "Yeni masayı Burak açacak."}</p></div>
      {member.role === "ADMIN" ? <div className="action-row"><button className="button primary" onClick={() => onCreate(false)}><Zap size={16} /> + KARAR BAŞLAT</button><button className="button ghost" onClick={() => onCreate(true)}>🆘 Biz yine karar veremiyoruz</button></div> : <p className="small muted">Şimdilik beklemedeyiz.</p>}
    </div>{lastPlan && lastWinner ? <button className="surface last-plan-card" onClick={onOpen}>
      <div className="last-plan-copy"><div className="eyebrow">Son plan · tarihi geçince buradan kalkar</div><h3>{lastWinner.text}</h3><p>{lastPlan.schedule?.selectedDay ? formatPlanDay(lastPlan.schedule.selectedDay) : "BU GECE"}{lastPlan.schedule?.selectedTime ? ` · ${lastPlan.schedule.selectedTime}` : ""}</p><PlanCountdown event={lastPlan} /></div>
      <div className="last-plan-organizer"><span>ORGANİZATÖR</span><strong>{lastOrganizer?.name ?? "—"}</strong><small>Planı aç <ArrowUpRight size={14} /></small></div>
    </button> : null}</>}
    <MemberLoginPanel currentMember={member} />
  </section>;
}

function PlanCountdown({ event }: { event: EventData }) {
  const [now, setNow] = useState(Date.now());
  const startsAt = planStartsAt(event);
  useEffect(() => {
    if (!startsAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [startsAt]);
  if (!startsAt) return <span className="plan-countdown">BU GECE.</span>;
  const remaining = startsAt - now;
  if (remaining <= 0) return <span className="plan-countdown live">PLAN BAŞLADI.</span>;
  const totalMinutes = Math.max(1, Math.ceil(remaining / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [days ? `${days} gün` : "", hours ? `${hours} saat` : "", !days && minutes ? `${minutes} dakika` : ""].filter(Boolean);
  return <span className="plan-countdown">{parts.join(" ")} KALDI.</span>;
}

function WaitingLine({ memberIds, completedIds }: { memberIds: string[]; completedIds: string[] }) {
  const waiting = waitingMemberNames(memberIds, completedIds);
  return <span className={`waiting-line ${waiting.length ? "" : "complete"}`}>{waiting.length ? `${waiting.join(", ")} bekleniyor.` : "Herkes tamam."}</span>;
}

function ExitConfirm({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return <motion.div className="exit-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onCancel}>
    <motion.div role="dialog" aria-modal="true" aria-labelledby="exit-title" className="exit-dialog" initial={{ opacity: 0, y: 22, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: .97 }} transition={motionTokens.spring.card} onMouseDown={(event) => event.stopPropagation()}>
      <button className="exit-close" onClick={onCancel} aria-label="Kapat"><X size={17} /></button>
      <div className="eyebrow">Masadan ayrıl</div>
      <h2 id="exit-title">ÇIKMAK İSTEDİĞİNE<br />EMİN MİSİN?</h2>
      <p>İlerlemen kaybolmaz. Ana sayfadan aynı masaya tekrar dönebilirsin.</p>
      <div className="exit-actions"><button className="button ghost" onClick={onCancel}>MASADA KAL</button><button className="button primary" onClick={onConfirm}><House size={15} /> ANA SAYFAYA ÇIK</button></div>
    </motion.div>
  </motion.div>;
}

function CancelTableConfirm({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return <motion.div className="exit-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onCancel}>
    <motion.div role="dialog" aria-modal="true" aria-labelledby="cancel-table-title" className="exit-dialog cancel-table-dialog" initial={{ opacity: 0, y: 22, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: .97 }} transition={motionTokens.spring.card} onMouseDown={(event) => event.stopPropagation()}>
      <button className="exit-close" onClick={onCancel} aria-label="Kapat"><X size={17} /></button>
      <div className="eyebrow">Admin müdahalesi</div>
      <h2 id="cancel-table-title">MASAYI GERÇEKTEN<br />DAĞITALIM MI?</h2>
      <p>Bu karar oturumu duracak. Herkesin ekranında “Burak masayı bozdu.” yazacak. Oylar ve fikirler bu masa için devam etmeyecek.</p>
      <div className="exit-actions"><button className="button ghost" onClick={onCancel}>VAZGEÇ</button><button className="button danger" onClick={onConfirm}><X size={15} /> MASAYI DAĞIT</button></div>
    </motion.div>
  </motion.div>;
}

function CancelledStage({ member, onBack, onCreate }: { member: Member; onBack: () => void; onCreate: () => void }) {
  return <section className="screen"><motion.div className="surface cancelled-stage" initial={{ opacity: 0, scale: .98 }} animate={{ opacity: 1, scale: 1 }} transition={motionTokens.spring.card}><div className="cancelled-mark"><X size={34} /></div><div className="eyebrow">Masa dağıldı</div><h1>BURAK MASAYI<br /><span>BOZDU.</span></h1><p>{member.role === "ADMIN" ? "Bu oturumu kapattın. Yanlış ayarları düzeltip yeni bir masa kurabilirsin." : "Bu karar oturumu Burak tarafından kapatıldı. Yeni masa açılmasını bekliyoruz."}</p><div className="action-row"><button className="button ghost" onClick={onBack}><House size={15} /> ANA SAYFA</button>{member.role === "ADMIN" ? <button className="button primary" onClick={onCreate}><Zap size={15} /> YENİ MASA KUR</button> : null}</div></motion.div></section>;
}

function MemberLoginPanel({ currentMember }: { currentMember?: Member }) {
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const close = () => {
    setSelectedMember(null);
    setPassword("");
    setError("");
  };

  const login = async () => {
    if (!selectedMember || password.length !== 6 || submitting) return;
    setSubmitting(true);
    setError("");
    const response = await fetch("/api/member-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberId: selectedMember.id, password }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(data.error ?? "Giriş olmadı. Tekrar dene.");
      setSubmitting(false);
      return;
    }
    window.location.assign("/");
  };

  return <>
    <div className="surface test-switcher">
      <div><div className="eyebrow">Üye girişi</div><h3>BAŞKA BİR ÜYE MİSİN?</h3><p className="small muted">Adına dokun, kişisel şifreni gir. Bu cihaz bir sonraki gelişinde seni hatırlar.</p></div>
      <div className="test-member-grid">{MEMBERS.map((person) => <button key={person.id} className={`test-member ${person.id === currentMember?.id ? "current" : ""}`} onClick={() => { setSelectedMember(person); setPassword(""); setError(""); }}><span>{person.initials}</span><strong>{person.name}{person.role === "ADMIN" ? " (ADMIN)" : ""}</strong><small>{person.id === currentMember?.id ? "ŞU AN SENSİN" : "GİRİŞ YAP"}</small></button>)}</div>
    </div>
    <AnimatePresence>{selectedMember ? <motion.div className="exit-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={close}>
      <motion.form className="exit-dialog member-login-dialog" initial={{ opacity: 0, y: 22, scale: .96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: .97 }} transition={motionTokens.spring.card} onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); void login(); }}>
        <button type="button" className="exit-close" onClick={close} aria-label="Kapat"><X size={17} /></button>
        <div className="member-login-avatar">{selectedMember.initials}</div>
        <div className="eyebrow">{selectedMember.name}{selectedMember.role === "ADMIN" ? " · ADMIN" : ""}</div>
        <h2>ŞİFRENİ GİR.</h2>
        <p>Bu cihaz seni hatırlayacak. Başka bir üyeye geçmek istediğinde yine buradan giriş yapabilirsin.</p>
        <input autoFocus className="password-input" type="password" inputMode="text" autoComplete="current-password" maxLength={6} value={password} onChange={(event) => { setPassword(event.target.value); setError(""); }} placeholder="••••••" aria-label={`${selectedMember.name} şifresi`} />
        {error ? <div className="login-error">{error}</div> : <div className="password-hint">6 karakter · büyük/küçük harfe duyarlı</div>}
        <button className="button primary login-submit" disabled={password.length !== 6 || submitting}>{submitting ? "KONTROL EDİLİYOR..." : `${selectedMember.name.toLocaleUpperCase("tr-TR")} OLARAK GİR`}</button>
      </motion.form>
    </motion.div> : null}</AnimatePresence>
  </>;
}

function CreateScreen({ member, quick, onBack, onCreate }: { member: Member; quick: boolean; onBack: () => void; onCreate: (event: EventData) => void }) {
  const [step, setStep] = useState(1);
  const [prompt, setPrompt] = useState("Bu gece ne yapıyoruz?");
  const [optionSource, setOptionSource] = useState<OptionSource>("crowd");
  const [planningMode, setPlanningMode] = useState<PlanningMode>("decision");
  const [category, setCategory] = useState("Oyun");
  const [options, setOptions] = useState<string[]>([]);
  const [newOption, setNewOption] = useState("");
  const totalSteps = optionSource === "manual" ? 5 : 4;
  const create = () => onCreate({ id: randomId("event"), prompt: prompt.trim() || "Bu gece ne yapıyoruz?", optionSource, planningMode, category, options: options.filter(Boolean), phase: "lobby", joined: [member.id], ideas: [], ideasRevealed: false, votes: {}, voteRound: 1, schedule: planningMode === "schedule" ? { availability: {}, time: {}, dayOptions: createDayOptions() } : undefined, createdAt: new Date().toISOString() });
  const addOption = () => {
    if (!newOption.trim() || options.length >= 6) return;
    setOptions([...options, newOption.trim()]);
    setNewOption("");
  };

  const title = quick || step === 1 ? "NEYİ ÇÖZÜYORUZ?" : step === 2 ? "SEÇENEKLER NASIL GELSİN?" : step === 3 ? "BU NE MESELESİ?" : step === 4 ? "GÜN-SAAT NE OLACAK?" : "SEÇENEKLERİ BIRAK.";
  const canContinue = step === 1 ? Boolean(prompt.trim()) : step === 5 ? options.length >= 2 : true;

  if (quick) {
    return <section className="screen wizard-screen"><WizardHeader step={1} total={1} onBack={onBack} label="Hızlı karar · 3–5 dakika" /><div className="wizard-stage"><div className="eyebrow">Tek soru. Direkt masa.</div><h1 className="wizard-title">{title}</h1><input autoFocus className="wizard-input" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Bu gece ne yapıyoruz?" /><div className="prompt-templates">{PROMPT_TEMPLATES.map((item) => <button key={item} className={`prompt-chip ${prompt === item ? "selected" : ""}`} onClick={() => setPrompt(item)}>{item}</button>)}</div><div className="quick-time-toggle"><button className={`button ghost ${planningMode === "schedule" ? "selected" : ""}`} onClick={() => setPlanningMode(planningMode === "schedule" ? "decision" : "schedule")}>{planningMode === "schedule" ? "GÜN & SAAT OYLAMASI AÇIK" : "+ GÜN & SAATİ OYLAYALIM"}</button>{planningMode === "schedule" ? <p className="small muted">Aktivite sonucu gizlenir; tarih oylanır, herkes saat önerir, sonra saat seçenekleri ayrıca oylanır.</p> : null}</div><button className="button primary wizard-cta" disabled={!prompt.trim()} onClick={create}><Users size={17} /> HIZLI MASAYI AÇ</button></div></section>;
  }

  return <section className="screen wizard-screen"><WizardHeader step={step} total={totalSteps} onBack={() => step === 1 ? onBack() : setStep(step - 1)} label="Yeni karar masası" /><AnimatePresence mode="wait"><motion.div key={step} className="wizard-stage" initial={{ opacity: 0, x: 26 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: motionTokens.duration.card, ease: motionTokens.ease.standard }}><div className="eyebrow">{step} / {totalSteps}</div><h1 className="wizard-title">{title}</h1>
    {step === 1 ? <><input autoFocus className="wizard-input" value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && prompt.trim()) setStep(2); }} placeholder="Bu gece ne yapıyoruz?" /><div className="prompt-templates">{PROMPT_TEMPLATES.map((item) => <button key={item} className={`prompt-chip ${prompt === item ? "selected" : ""}`} onClick={() => setPrompt(item)}>{item}</button>)}</div></> : null}
    {step === 2 ? <div className="wizard-choices"><button className={`wizard-choice ${optionSource === "crowd" ? "selected" : ""}`} onClick={() => setOptionSource("crowd")}><span className="choice-index">A</span><strong>HERKES FİKİR ATSIN</strong><p>Masaya herkes bir şey bıraksın.</p></button><button className={`wizard-choice ${optionSource === "manual" ? "selected" : ""}`} onClick={() => setOptionSource("manual")}><span className="choice-index">B</span><strong>SEÇENEKLER BELLİ</strong><p>Ne arasında kaldığımız belli.</p></button></div> : null}
    {step === 3 ? <div className="wizard-category">{["Oyun", "Film", "Buluşma", "Yemek", "Aktivite", "Özel"].map((item, index) => <button key={item} className={`wizard-choice compact ${category === item ? "selected" : ""}`} onClick={() => setCategory(item)}><span className="choice-index">0{index + 1}</span><strong>{item}</strong></button>)}</div> : null}
    {step === 4 ? <div className="wizard-choices"><button className={`wizard-choice ${planningMode === "decision" ? "selected" : ""}`} onClick={() => setPlanningMode("decision")}><span className="choice-index">A</span><strong>GEREKMİYOR</strong><p>Sadece ana karar çıksın.</p></button><button className={`wizard-choice ${planningMode === "schedule" ? "selected" : ""}`} onClick={() => setPlanningMode("schedule")}><span className="choice-index">B</span><strong>TARİH + SAAT OYLAMASI</strong><p>Tarih oylansın. Sonra herkes saat önersin ve saatlere ayrıca oy versin.</p></button></div> : null}
    {step === 5 ? <div className="wizard-options"><div className="option-input"><input autoFocus className="input" placeholder="Örn. The Thing" value={newOption} maxLength={80} onChange={(e) => setNewOption(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addOption(); }} /><button className="button ghost" disabled={!newOption.trim() || options.length >= 6} onClick={addOption}>Ekle</button></div><div className="option-list">{options.map((item, index) => <motion.div layout className="option-row" key={`${item}-${index}`}><span><small>0{index + 1}</small>{item}</span><button onClick={() => setOptions(options.filter((_, i) => i !== index))}><X size={15} /></button></motion.div>)}</div><p className="small muted">Minimum 2 · maksimum 6 seçenek</p></div> : null}
    <div className="wizard-actions">{step < totalSteps ? <button className="button primary wizard-cta" disabled={!canContinue} onClick={() => setStep(step + 1)}>DEVAM <ArrowUpRight size={16} /></button> : <button className="button primary wizard-cta" disabled={!canContinue} onClick={create}><Users size={17} /> MASAYI AÇ</button>}</div>
  </motion.div></AnimatePresence></section>;
}

function WizardHeader({ step, total, onBack, label }: { step: number; total: number; onBack: () => void; label: string }) {
  return <div className="wizard-header"><button className="icon-button" onClick={onBack}><ChevronLeft size={18} /></button><div><div className="eyebrow">{label}</div><div className="wizard-dots">{Array.from({ length: total }).map((_, index) => <span key={index} className={index + 1 <= step ? "active" : ""} />)}</div></div><div className="member-pill"><span className="member-dot" />Burak kontrol ediyor</div></div>;
}

function Lobby({ event, member, onStart, onBack }: { event: EventData; member: Member; onStart: () => void; onBack: () => void }) {
  const joinedCount = event.joined.length;
  const missing = MEMBERS.filter((person) => !event.joined.includes(person.id)).map((person) => person.name);
  const nudgeMissing = async () => {
    const text = `UNKAN masası seni bekliyor${missing.length ? `: ${missing.join(", ")}` : ""}. Bir gir de demokrasi başlayabilsin :)`;
    try {
      if (navigator.share) await navigator.share({ title: "UNKAN masası", text, url: window.location.origin });
      else window.open(`https://wa.me/?text=${encodeURIComponent(`${text}\n${window.location.origin}`)}`, "_blank", "noopener,noreferrer");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
    }
  };
  return <section className="screen"><div className="screen-head"><div><button className="icon-button" onClick={onBack}><ChevronLeft size={18} /></button><div className="eyebrow" style={{ marginTop: 22 }}>Masa kuruluyor · {event.prompt}</div><h1 className="screen-title">HERKESİ<br /><span style={{ color: "var(--acid)" }}>TOPLUYORUZ.</span></h1></div><div className="member-pill"><span className="member-dot" />{joinedCount} / 8</div></div>
    <div className="surface lobby-wrap"><div className={`lobby-center ${joinedCount === 8 ? "ready" : ""}`}><div className="table-mark"><span>{joinedCount === 8 ? "✓" : joinedCount}</span></div><h2>{joinedCount === 8 ? "TAM KADRO." : `${joinedCount} / 8`}</h2><p>{copyForCount(joinedCount)}</p></div>{MEMBERS.map((person, index) => <motion.div key={`${person.id}-${event.joined.includes(person.id) ? "joined" : "empty"}`} className={`seat ${event.joined.includes(person.id) ? "joined" : ""}`} initial={{ opacity: 0, scale: .8, x: "-50%", y: "-80%", rotate: index % 2 ? 7 : -6 }} animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%", rotate: 0 }} transition={{ ...motionTokens.spring.card, delay: index * .04 }}><div className="seat-avatar">{event.joined.includes(person.id) ? person.initials : "·"}</div><div className="seat-name">{person.name}</div><div className="seat-status">{event.joined.includes(person.id) ? "MASADA" : "BEKLENİYOR"}</div></motion.div>)}</div>
    <div className="lobby-footer"><div><div className="progress-line"><span style={{ width: `${joinedCount / 8 * 100}%` }} /></div><WaitingLine memberIds={MEMBERS.map((person) => person.id)} completedIds={event.joined} />{member.role === "ADMIN" && joinedCount < 8 ? <span className="admin-start-note">Admin masayı erken açabilir · şu an {joinedCount} kişi var</span> : null}{joinedCount < 8 ? <button className="button ghost nudge-button" onClick={() => void nudgeMissing()}><MessageCircle size={15} /> EKSİKLERİ ÇAĞIR</button> : null}</div>{member.role === "ADMIN" ? <button className="button primary" onClick={onStart}>KAOSU BAŞLAT <ArrowUpRight size={16} /></button> : <span className="small muted">Burak düğmeye bassın da başlayalım.</span>}</div>
  </section>;
}

function IdeasStage({ event, member, onBack, onSubmit, onReveal, onOpenVoting }: { event: EventData; member: Member; onBack: () => void; onSubmit: (text: string) => void; onReveal: () => void; onOpenVoting: () => void }) {
  const [text, setText] = useState("");
  const myCount = event.ideas.filter((idea) => idea.authorId === member.id).length;
  const positions = [[50, 30, -3], [22, 38, 5], [77, 37, -7], [30, 63, -4], [69, 66, 6], [47, 65, 2], [87, 55, -5], [13, 58, 5]];
  const completed = new Set(event.ideas.map((idea) => idea.authorId)).size;
  const participantCount = Math.max(1, event.joined.length);
  return <section className="screen"><div className="screen-head"><div><button className="icon-button" onClick={onBack}><ChevronLeft size={18} /></button><div className="eyebrow" style={{ marginTop: 22 }}>Round 1 · fikir havuzu</div></div><div className="round-meta"><RoundTimer endsAt={event.roundEndsAt} /><div className="member-pill idea-limit"><Sparkles size={14} color="var(--acid)" /> {myCount} / {MAX_IDEAS_PER_MEMBER} fikir</div></div></div>
    <div className="surface idea-stage"><div className="stage-title"><div className="eyebrow stage-progress">{event.ideasRevealed ? "Alternatifler masada" : `${completed} / ${participantCount} FİKRİNİ ATTI`}</div><h2>{event.ideasRevealed ? "TAMAM. ŞİMDİ GERÇEKTEN SEÇİN." : "DÖKÜLÜN BAKALIM."}</h2><p>{event.ideasRevealed ? "Kartlar iki saniye masada. Oylama otomatik açılıyor." : "Tek fikir hakkın var. Yazıp gönderdiğinde cevabın sayılır."}</p></div><AnimatePresence>{event.ideas.map((idea, index) => <motion.div key={idea.id} className={`idea-card ${event.ideasRevealed ? "revealed" : ""}`} style={{ ["--x" as string]: `${positions[index % positions.length][0]}%`, ["--y" as string]: `${positions[index % positions.length][1]}%`, ["--r" as string]: `${positions[index % positions.length][2]}deg` }} initial={{ opacity: 0, scale: .5, x: "-50%", y: "-120%", rotate: 18 }} animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%", rotate: positions[index % positions.length][2] }} exit={{ opacity: 0, x: "-50%", y: "120%", rotate: 25 }}><strong>{event.ideasRevealed ? idea.text : "?"}</strong></motion.div>)}</AnimatePresence>{!event.ideasRevealed ? <div className="idea-console"><input className="input" value={text} maxLength={80} placeholder="Tek fikrini yaz..." onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) { onSubmit(text.trim()); setText(""); } }} /><button className="button primary" disabled={!text.trim() || myCount >= MAX_IDEAS_PER_MEMBER} onClick={() => { onSubmit(text.trim()); setText(""); }}><Send size={15} /> AT</button></div> : null}</div>
    <div className="action-row stage-waiting" style={{ marginTop: 14 }}>{member.role === "ADMIN" && !event.ideasRevealed ? <button className="button primary" disabled={!event.ideas.length} onClick={onReveal}>DÖKÜN BAKALIM <Sparkles size={15} /></button> : null}{member.role === "ADMIN" && event.ideasRevealed ? <button className="button primary" onClick={onOpenVoting}>TAMAM · OYLAMAYI AÇ <ArrowUpRight size={15} /></button> : null}{!event.ideasRevealed ? <WaitingLine memberIds={event.joined} completedIds={[...new Set(event.ideas.map((idea) => idea.authorId))]} /> : null}</div>
  </section>;
}

function VotingStage({ event, member, onVote, onClose }: { event: EventData; member: Member; onVote: (selected: string[]) => void; onClose: () => void }) {
  const optionList = getOptionList(event);
  const [selected, setSelected] = useState(event.votes[member.id] ?? []);
  const [submitting, setSubmitting] = useState(false);
  const votedCount = Object.keys(event.votes).length;
  const participants = MEMBERS.filter((person) => event.joined.includes(person.id));
  const threshold = Math.floor(Math.max(1, participants.length) / 2) + 1;
  useEffect(() => { if (event.votes[member.id]) setSubmitting(false); }, [event.votes, member.id]);
  function submitVote() {
    if (submitting || !selected.length || event.votes[member.id]) return;
    setSubmitting(true);
    onVote(selected);
    window.setTimeout(() => setSubmitting(false), 2000);
  }
  return <section className="screen"><div className="screen-head"><div><div className="eyebrow">Round {event.optionSource === "crowd" ? 2 : 1} · gizli approval voting</div><h1 className="screen-title">HANGİLERİNE<br /><span style={{ color: "var(--acid)" }}>OK'SİN?</span></h1><p className="screen-subtitle">Uyanların hepsini seç. Kimin neye bastığı görünmeyecek.</p></div><div className="round-meta"><RoundTimer endsAt={event.roundEndsAt} /><div className="vote-progress">{votedCount} / {participants.length} OY GELDİ.</div></div></div><div className="surface vote-stage"><div className="vote-header"><div><span className="eyebrow">En az {threshold} kabul gerekli</span><h2>{event.prompt}</h2></div><CircleHelp size={20} color="var(--muted)" /></div><div className="vote-grid">{optionList.map((option, index) => <motion.button key={option.id} whileTap={{ scale: .98 }} transition={motionTokens.spring.button} className={`vote-card ${selected.includes(option.id) ? "selected" : ""}`} disabled={Boolean(event.votes[member.id]) || submitting} onClick={() => setSelected((items) => items.includes(option.id) ? items.filter((id) => id !== option.id) : [...items, option.id])}><span className="card-symbol">0{index + 1}</span><strong>{option.text}</strong><span className="check" /></motion.button>)}</div><div className="voter-row" aria-label="Oy ilerlemesi">{participants.map((person) => <span key={person.id} className={event.votes[person.id] ? "voter joined" : "voter"} title={event.votes[person.id] ? `${person.name} oy verdi` : `${person.name} bekleniyor`}>{event.votes[person.id] ? person.initials : ""}</span>)}</div><div className="vote-footer"><WaitingLine memberIds={event.joined} completedIds={Object.keys(event.votes)} /><div className="action-row"><button className="button primary" disabled={!selected.length || Boolean(event.votes[member.id]) || submitting} onClick={submitVote}>{event.votes[member.id] || submitting ? "OYUN GİDİYOR…" : "OYU GÖNDER"} <Check size={15} /></button>{member.role === "ADMIN" ? <button className="button ghost" onClick={onClose}>OYLAMAYI KAPAT</button> : null}</div></div></div></section>;
}

function ResultStage({ event, reducedMotion, soundEnabled, meta, onReact }: { event: EventData; reducedMotion: boolean; soundEnabled: boolean; meta: EventMeta; onReact: (reaction: string) => void }) {
  const optionList = getOptionList(event);
  const result = percentageWinner(event.votes, optionList.map((item) => item.id), event.joined.length);
  const winner = optionList.find((item) => item.id === event.winnerId) ?? optionList.find((item) => item.id === result.counts[0]?.id);
  const [step, setStep] = useState<ResultStep>("opening");
  const [videoMuted, setVideoMuted] = useState(!soundEnabled);
  const [videoAudioBlocked, setVideoAudioBlocked] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => { const timers = [window.setTimeout(() => setStep("counting"), reducedMotion ? 150 : 800), window.setTimeout(() => setStep("eliminating"), reducedMotion ? 300 : 1700), window.setTimeout(() => setStep("vader"), reducedMotion ? 500 : 2350), window.setTimeout(() => setStep("winner"), reducedMotion ? 4500 : 8000)]; return () => timers.forEach(window.clearTimeout); }, [reducedMotion]);
  useEffect(() => { if (step === "eliminating") playUiSound("eliminate", soundEnabled); }, [step, soundEnabled]);
  useEffect(() => {
    if (step !== "vader" || !videoRef.current) return;
    const video = videoRef.current;
    video.muted = !soundEnabled;
    setVideoMuted(!soundEnabled);
    setVideoAudioBlocked(false);
    void video.play().then(() => setVideoAudioBlocked(false)).catch(() => {
      video.muted = true;
      setVideoMuted(true);
      setVideoAudioBlocked(soundEnabled);
      void video.play();
    });
  }, [step, soundEnabled]);
  function toggleVideoSound() {
    const video = videoRef.current;
    if (!video) return;
    const nextMuted = !videoMuted;
    video.muted = nextMuted;
    setVideoMuted(nextMuted);
    if (!nextMuted) void video.play().then(() => setVideoAudioBlocked(false)).catch(() => { video.muted = true; setVideoMuted(true); setVideoAudioBlocked(true); });
  }
  const losers = optionList.filter((item) => item.id !== winner?.id);
  return <section className="screen"><div className="surface reveal-stage"><div className="reveal-title"><div className="eyebrow">{step === "winner" ? "Karar masada" : "Sonuç sahnesi"}</div><h2>{step === "winner" ? "BİTTİ." : step === "vader" ? "KARARSIZLIK ÖLDÜ." : "OYLAMA BİTTİ."}</h2><p>{step === "winner" ? "Bu gece bu." : step === "vader" ? "UNKAN masaya el koydu." : "Bakalım ne saçmaladınız."}</p></div><AnimatePresence>{step === "vader" ? <motion.div className="vader-scene" initial={{ opacity: 0, scale: .92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? .05 : .35 }}><video ref={videoRef} className="vader-video" autoPlay muted={videoMuted} playsInline preload="auto" onEnded={() => setStep("winner")}><source src="/unkan.mp4" type="video/mp4" /></video><button type="button" className="vader-sound-button" onClick={toggleVideoSound}>{videoMuted ? "🔇 SESİ AÇ" : "🔊 SESİ KAPAT"}</button>{videoAudioBlocked ? <span className="vader-sound-hint">Tarayıcı otomatik sesi engelledi. Açmak için dokun.</span> : null}</motion.div> : null}</AnimatePresence><AnimatePresence>{step !== "winner" && step !== "vader" ? losers.map((item, index) => <motion.div key={item.id} className="eliminated-card" style={{ ["--x" as string]: `${17 + (index * 19) % 70}%`, ["--y" as string]: `${29 + (index % 3) * 19}%`, ["--r" as string]: `${index % 2 ? 5 : -5}deg` }} initial={{ opacity: 0, scale: .6, x: "-50%", y: "-80%" }} animate={{ opacity: step === "eliminating" && index < losers.length - 1 ? .12 : .72, scale: 1, x: "-50%", y: "-50%" }} exit={{ opacity: 0, scale: .86, x: "-50%", y: "170%", rotate: index % 2 ? 16 : -16, transition: { duration: reducedMotion ? .05 : motionTokens.duration.elimination, ease: motionTokens.ease.exit } }} transition={{ ...motionTokens.spring.card, delay: index * .12 }}><strong>{item.text}</strong><span>{step === "eliminating" ? resultCopy[index % resultCopy.length] : "oylar geliyor"}</span></motion.div>) : null}</AnimatePresence><AnimatePresence mode="wait">{winner && step !== "vader" ? <motion.div layoutId="winner-card" key={step === "winner" ? "winner" : "center"} className="result-card" initial={{ opacity: 0, scale: .75, x: "-50%", y: "-50%", rotate: -4 }} animate={{ opacity: 1, scale: step === "winner" ? 1.08 : 1, x: "-50%", y: "-50%", rotate: 0 }} transition={{ ...motionTokens.spring.heavy, duration: reducedMotion ? .05 : undefined }}><div className="result-chip">{step === "winner" ? "TEK SEÇENEK KALDI" : "OY TOKENLARI"}</div><h3>{winner.text}</h3><p>{step === "winner" ? "Diğer seçenekler başka bir gün." : "Sonuçlar hesaplanıyor..."}</p></motion.div> : null}</AnimatePresence></div>{step === "winner" ? <ReactionBar meta={meta} onReact={onReact} /> : null}</section>;
}

function DayRoundStage({ event, member, onSubmit }: { event: EventData; member: Member; onSubmit: (days: string[]) => void }) {
  const current = event.schedule ?? { availability: {}, time: {}, dayOptions: createDayOptions() };
  const dayOptions = current.dayOptions?.length ? current.dayOptions : createDayOptions();
  const eligibleMembers = MEMBERS.filter((person) => event.joined.includes(person.id));
  const [selected, setSelected] = useState<string[]>(current.availability[member.id] ?? []);
  const submitted = eligibleMembers.filter((person) => Object.prototype.hasOwnProperty.call(current.availability, person.id)).length;
  const alreadySubmitted = Object.prototype.hasOwnProperty.call(current.availability, member.id);
  return <section className="screen"><div className="screen-head"><div><div className="eyebrow">Plan roundu 1/2 · tarih havuzu</div><h1 className="screen-title">HANGİ TARİHLER<br /><span style={{ color: "var(--acid)" }}>UYUYOR?</span></h1><p className="screen-subtitle">Uygun olduğun bütün tarihleri seç. Hiçbiri uymuyorsa boş cevap gönder; cevabın sayılır ama organizatör havuzuna girmezsin.</p></div><div className="round-meta"><RoundTimer endsAt={event.roundEndsAt} /><div className="vote-progress">{submitted} / {eligibleMembers.length} TARİH GELDİ</div></div></div><div className="surface pad"><div className="day-card-grid">{dayOptions.map((day, index) => { const label = formatDayCard(day); return <motion.button key={day} whileTap={{ scale: .98 }} className={`day-card ${selected.includes(day) ? "selected" : ""}`} disabled={alreadySubmitted} onClick={() => setSelected((items) => items.includes(day) ? items.filter((item) => item !== day) : [...items, day])}><span>0{index + 1}</span><strong>{label.weekday}</strong><small>{label.date}</small></motion.button>; })}</div><div className="voter-row">{eligibleMembers.map((person) => <span key={person.id} className={Object.prototype.hasOwnProperty.call(current.availability, person.id) ? "voter joined" : "voter"}>{Object.prototype.hasOwnProperty.call(current.availability, person.id) ? person.initials : ""}</span>)}</div><div className="vote-footer"><WaitingLine memberIds={eligibleMembers.map((person) => person.id)} completedIds={Object.keys(current.availability)} /><button className={`button ${selected.length ? "primary" : "ghost"}`} disabled={alreadySubmitted} onClick={() => onSubmit(selected)}>{alreadySubmitted ? "CEVABIN GİTTİ" : selected.length ? "TARİHLERİ GÖNDER" : "HİÇBİRİ UYMUYOR"}</button></div></div></section>;
}

function TimeRoundStage({ event, member, onSubmit }: { event: EventData; member: Member; onSubmit: (time: string) => void }) {
  const current = event.schedule ?? { availability: {}, time: {} };
  const [selected, setSelected] = useState(current.time[member.id] ?? "");
  const eligibleMembers = MEMBERS.filter((person) => event.joined.includes(person.id));
  const submitted = eligibleMembers.filter((person) => Object.prototype.hasOwnProperty.call(current.time, person.id)).length;
  const alreadySubmitted = Object.prototype.hasOwnProperty.call(current.time, member.id);
  return <section className="screen"><div className="screen-head"><div><div className="eyebrow">Saat roundu 1/2 · öneri havuzu · {formatPlanDay(current.selectedDay)}</div><h1 className="screen-title">SAATİNİ<br /><span style={{ color: "var(--acid)" }}>YAZ.</span></h1><p className="screen-subtitle">Masadaki herkes bir başlangıç saati önersin. Öneriler tamamlanınca ayrı saat oylaması açılacak.</p></div><div className="round-meta"><RoundTimer endsAt={event.roundEndsAt} /><div className="vote-progress">{submitted} / {eligibleMembers.length} SAAT ÖNERİLDİ</div></div></div><div className="surface pad time-entry-stage"><label className="time-entry"><span>SAAT ÖNERİN</span><input type="time" step="1800" value={selected} disabled={alreadySubmitted} onChange={(event) => setSelected(event.target.value)} /></label><p className="muted">Örnek: 20:30. Girilen saatler öneri aşamasında diğer kişilere görünmez.</p><div className="voter-row">{eligibleMembers.map((person) => <span key={person.id} className={Object.prototype.hasOwnProperty.call(current.time, person.id) ? "voter joined" : "voter"}>{Object.prototype.hasOwnProperty.call(current.time, person.id) ? person.initials : ""}</span>)}</div><div className="vote-footer"><WaitingLine memberIds={eligibleMembers.map((person) => person.id)} completedIds={Object.keys(current.time)} /><button className="button primary" disabled={!selected || alreadySubmitted} onClick={() => onSubmit(selected)}>{alreadySubmitted ? "ÖNERİN GİTTİ" : "SAATİ ÖNER"}</button></div></div></section>;
}

function TimeVotingStage({ event, member, onVote }: { event: EventData; member: Member; onVote: (time: string) => void }) {
  const current = event.schedule ?? { availability: {}, time: {}, timeVotes: {} };
  const options = [...new Set(Object.values(current.time).filter(Boolean))].sort();
  const timeVotes = current.timeVotes ?? {};
  const [selected, setSelected] = useState(timeVotes[member.id] ?? "");
  const eligibleMembers = MEMBERS.filter((person) => event.joined.includes(person.id));
  const submitted = eligibleMembers.filter((person) => Object.prototype.hasOwnProperty.call(timeVotes, person.id)).length;
  const alreadySubmitted = Object.prototype.hasOwnProperty.call(timeVotes, member.id);
  return <section className="screen"><div className="screen-head"><div><div className="eyebrow">Saat roundu 2/2 · gizli oylama</div><h1 className="screen-title">HANGİ<br /><span style={{ color: "var(--acid)" }}>SAAT?</span></h1><p className="screen-subtitle">Herkesin önerdiği saatler havuzda. Sana en uygun tek saati seç.</p></div><div className="round-meta"><RoundTimer endsAt={event.roundEndsAt} /><div className="vote-progress">{submitted} / {eligibleMembers.length} OY GELDİ</div></div></div><div className="surface vote-stage"><div className="vote-header"><div><span className="eyebrow">{formatPlanDay(current.selectedDay)}</span><h2>Saat havuzu</h2></div><CircleHelp size={20} color="var(--muted)" /></div><div className="time-vote-grid">{options.map((time) => <motion.button key={time} whileTap={{ scale: .98 }} className={`time-vote-card ${selected === time ? "selected" : ""}`} disabled={alreadySubmitted} onClick={() => setSelected(time)}><span className="time-dot" /><strong>{time}</strong><small>SAAT SEÇENEĞİ</small></motion.button>)}</div><div className="voter-row">{eligibleMembers.map((person) => <span key={person.id} className={Object.prototype.hasOwnProperty.call(timeVotes, person.id) ? "voter joined" : "voter"}>{Object.prototype.hasOwnProperty.call(timeVotes, person.id) ? person.initials : ""}</span>)}</div><div className="vote-footer"><WaitingLine memberIds={eligibleMembers.map((person) => person.id)} completedIds={Object.keys(timeVotes)} /><button className="button primary" disabled={!selected || alreadySubmitted} onClick={() => onVote(selected)}>{alreadySubmitted ? "OYUN GİTTİ" : "SAATE OY VER"}</button></div></div></section>;
}

function PlaceIdeasStage({ event, member, onSubmit }: { event: EventData; member: Member; onSubmit: (text: string) => void }) {
  const [text, setText] = useState("");
  const eligibleIds = event.participants?.length ? event.participants : event.joined;
  const isEligible = eligibleIds.includes(member.id);
  const ideas = event.placeIdeas ?? [];
  const alreadySubmitted = ideas.some((idea) => idea.authorId === member.id);
  const completedIds = [...new Set(ideas.map((idea) => idea.authorId))];
  return <section className="screen"><div className="screen-head"><div><div className="eyebrow">Mekân roundu 1/2 · tek öneri</div><h1 className="screen-title">NEREYE<br /><span style={{ color: "var(--acid)" }}>GİDİYORUZ?</span></h1><p className="screen-subtitle">Kazanan tarihe uygun herkes tek bir yer önersin. Öneri sahipleri gizli kalır.</p></div><div className="round-meta"><RoundTimer endsAt={event.roundEndsAt} /><div className="vote-progress">{completedIds.length} / {eligibleIds.length} YER GELDİ</div></div></div><div className="surface pad place-stage"><div className="place-question"><MapPin size={25} /><h2>Masaya bir yer bırak.</h2><p className="muted">Mekân, semt veya net bir buluşma noktası olabilir.</p></div>{isEligible ? <div className="place-entry"><input className="input" value={text} maxLength={100} disabled={alreadySubmitted} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && text.trim() && !alreadySubmitted) { onSubmit(text.trim()); setText(""); } }} placeholder="Örn. Kadıköy · şu kafe" /><button className="button primary" disabled={!text.trim() || alreadySubmitted} onClick={() => { onSubmit(text.trim()); setText(""); }}>{alreadySubmitted ? "YERİN GİTTİ" : "YERİ AT"}</button></div> : <p className="place-observer">Kazanan tarihi seçmediğin için bu turu izliyorsun.</p>}<WaitingLine memberIds={eligibleIds} completedIds={completedIds} /></div></section>;
}

function PlaceVotingStage({ event, member, onVote }: { event: EventData; member: Member; onVote: (placeId: string) => void }) {
  const ideas = event.placeIdeas ?? [];
  const votes = event.placeVotes ?? {};
  const eligibleIds = event.participants?.length ? event.participants : event.joined;
  const isEligible = eligibleIds.includes(member.id);
  const [selected, setSelected] = useState(votes[member.id] ?? "");
  const alreadySubmitted = Boolean(votes[member.id]);
  return <section className="screen"><div className="screen-head"><div><div className="eyebrow">Mekân roundu 2/2 · gizli oylama</div><h1 className="screen-title">ŞİMDİ<br /><span style={{ color: "var(--acid)" }}>YERİ SEÇ.</span></h1><p className="screen-subtitle">Öneriler masada. Sana uyan tek yeri seç.</p></div><div className="round-meta"><RoundTimer endsAt={event.roundEndsAt} /><div className="vote-progress">{Object.keys(votes).length} / {eligibleIds.length} OY GELDİ</div></div></div><div className="surface vote-stage"><div className="vote-grid">{ideas.map((idea, index) => <motion.button key={idea.id} whileTap={{ scale: .98 }} className={`vote-card ${selected === idea.id ? "selected" : ""}`} disabled={!isEligible || alreadySubmitted} onClick={() => setSelected(idea.id)}><span className="card-symbol">0{index + 1}</span><strong>{idea.text}</strong><span className="check" /></motion.button>)}</div><div className="vote-footer"><WaitingLine memberIds={eligibleIds} completedIds={Object.keys(votes)} />{isEligible ? <button className="button primary" disabled={!selected || alreadySubmitted} onClick={() => onVote(selected)}>{alreadySubmitted ? "OYUN GİTTİ" : "YERİ SEÇ"}</button> : <span className="place-observer">Bu turu izliyorsun.</span>}</div></div></section>;
}

function DecisionVideo({ soundEnabled }: { soundEnabled: boolean }) {
  const [muted, setMuted] = useState(!soundEnabled);
  const [blocked, setBlocked] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    video.muted = !soundEnabled;
    void video.play().catch(() => { video.muted = true; setMuted(true); setBlocked(soundEnabled); void video.play(); });
  }, [soundEnabled]);
  function toggleSound() {
    const video = videoRef.current;
    if (!video) return;
    const next = !muted;
    video.muted = next;
    setMuted(next);
    if (!next) void video.play().then(() => setBlocked(false)).catch(() => { video.muted = true; setMuted(true); setBlocked(true); });
  }
  return <div className="vader-scene static-vader-scene"><video ref={videoRef} className="vader-video" autoPlay muted={muted} playsInline preload="auto"><source src="/unkan.mp4" type="video/mp4" /></video><div className="vader-progress"><div className="vader-progress-track"><span /></div><div className="vader-progress-steps"><span className="done">✓ FİKİR</span><span className="done">✓ GÜN</span><span className="done">✓ SAAT</span><span className="active">ORGANİZATÖR SEÇİLİYOR...</span></div></div><button type="button" className="vader-sound-button" onClick={toggleSound}>{muted ? "🔇 SESİ AÇ" : "🔊 SESİ KAPAT"}</button>{blocked ? <span className="vader-sound-hint">Tarayıcı otomatik sesi engelledi. Açmak için dokun.</span> : null}</div>;
}

function FinalIntroVideo({ soundEnabled, onDone }: { soundEnabled: boolean; onDone: () => void }) {
  const [muted, setMuted] = useState(!soundEnabled);
  const [blocked, setBlocked] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const startedAtRef = useRef<number | null>(null);
  const finishedRef = useRef(false);
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  const markStarted = () => {
    if (startedAtRef.current === null) startedAtRef.current = Date.now();
  };

  const finish = () => {
    if (finishedRef.current || startedAtRef.current === null) return;
    const elapsed = Date.now() - startedAtRef.current;
    if (elapsed < 900) {
      window.setTimeout(finish, 900 - elapsed);
      return;
    }
    finishedRef.current = true;
    onDoneRef.current();
  };

  useEffect(() => {
    // Some browsers can emit `ended` immediately when the source failed to
    // decode. Never let that event skip the scene before playback really ran.
    const fallback = window.setTimeout(() => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      onDoneRef.current();
    }, 10000);
    const video = videoRef.current;
    if (video) {
      video.muted = !soundEnabled;
      void video.play().then(markStarted).catch(() => {
        video.muted = true;
        setMuted(true);
        setBlocked(soundEnabled);
        void video.play().then(markStarted).catch(() => setBlocked(true));
      });
    }
    return () => window.clearTimeout(fallback);
  }, [soundEnabled]);
  function toggleSound() {
    const video = videoRef.current;
    if (!video) return;
    const next = !muted;
    video.muted = next;
    setMuted(next);
    if (!next) void video.play().then(() => setBlocked(false)).catch(() => { video.muted = true; setMuted(true); setBlocked(true); });
  }
  return <div className="vader-scene static-vader-scene final-intro-video"><video ref={videoRef} className="vader-video" autoPlay muted={muted} playsInline preload="auto" onPlay={markStarted} onEnded={finish} onError={() => setBlocked(true)}><source src="/unkan.mp4" type="video/mp4" /></video><div className="vader-progress"><div className="vader-progress-track"><span /></div><div className="vader-progress-steps"><span className="done">✓ FİKİR</span><span className="done">✓ GÜN</span><span className="done">✓ SAAT</span><span className="active">ORGANİZATÖR SEÇİLİYOR...</span></div></div><button type="button" className="vader-sound-button" onClick={toggleSound}>{muted ? "🔇 SESİ AÇ" : "🔊 SESİ KAPAT"}</button>{blocked ? <span className="vader-sound-hint">Video veya ses otomatik başlatılamadı. Sahne kısa süre içinde devam edecek.</span> : null}</div>;
}

function PlaceResultStage({ event, soundEnabled, meta, onReact }: { event: EventData; soundEnabled: boolean; meta: EventMeta; onReact: (reaction: string) => void }) {
  const winner = getPlaceWinner(event);
  useEffect(() => { playUiSound("eliminate", soundEnabled); }, [soundEnabled]);
  return <section className="screen"><div className="surface schedule-result-stage"><div className="schedule-result-title"><div className="eyebrow">Son detay da masada</div><h1>MASA KAPANIYOR.</h1><p>Kararsızlıklar bitti. Plan toparlanıyor.</p></div><DecisionVideo soundEnabled={soundEnabled} /><div className="place-winner compact-place-winner"><MapPin size={18} /><strong>{winner?.text ?? "Mekân"}</strong></div><ReactionBar meta={meta} onReact={onReact} /></div></section>;
}

function SchedulePoolResult({ event, kind, meta, onReact }: { event: EventData; kind: "day" | "time"; meta: EventMeta; onReact: (reaction: string) => void }) {
  const schedule = event.schedule ?? { availability: {}, time: {} };
  const items = kind === "day"
    ? (schedule.dayOptions ?? []).map((value) => ({ value, count: Object.values(schedule.availability).filter((days) => days.includes(value)).length }))
    : [...new Set(Object.values(schedule.time).filter(Boolean))].map((value) => ({ value, count: Object.values(schedule.timeVotes ?? {}).filter((time) => time === value).length }));
  const winner = kind === "day" ? schedule.selectedDay : schedule.selectedTime;
  return <section className="screen"><div className="surface schedule-result-stage"><div className="schedule-result-title"><div className="eyebrow">{kind === "day" ? "Tarih havuzu kapandı" : "Saat havuzu kapandı"}</div><h1>{kind === "day" ? "TARİH ÇIKTI." : "SAAT ÇIKTI."}</h1><p>{kind === "day" ? "Sırada bu tarihe uyanların saat havuzu var." : "Planın zamanı belli."}</p></div><div className="schedule-result-pool">{items.sort((a, b) => b.count - a.count).map((item, index) => <motion.div key={item.value} className={`schedule-result-card ${item.value === winner ? "winner" : "loser"}`} initial={{ opacity: 0, y: -18, rotate: index % 2 ? 2 : -2 }} animate={{ opacity: item.value === winner ? 1 : .28, y: item.value === winner ? 0 : 20, rotate: 0, scale: item.value === winner ? 1.04 : .94 }} transition={{ ...motionTokens.spring.card, delay: index * .09 }}><span>{item.count} TOKEN</span><strong>{kind === "day" ? formatPlanDay(item.value) : item.value}</strong><small>{item.value === winner ? "KAZANDI" : "ELENDİ"}</small></motion.div>)}</div><ReactionBar meta={meta} onReact={onReact} /></div></section>;
}

function RoundTimer({ endsAt }: { endsAt?: number }) {
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.ceil(((endsAt ?? Date.now()) - Date.now()) / 1000)));
  useEffect(() => {
    const update = () => setRemaining(Math.max(0, Math.ceil(((endsAt ?? Date.now()) - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [endsAt]);
  const minutes = Math.floor(remaining / 60).toString().padStart(2, "0");
  const seconds = (remaining % 60).toString().padStart(2, "0");
  return <div className={`round-timer ${remaining <= 10 ? "urgent" : ""}`}><span className="timer-ring" />{minutes}:{seconds}</div>;
}

function NoDecisionStage({ member, failedRound, onRetry, onBack }: { member: Member; failedRound?: "decision" | "day" | "timeSuggestion" | "timeVoting"; onRetry: () => void; onBack: () => void }) {
  const isTimeRound = failedRound === "timeSuggestion" || failedRound === "timeVoting";
  const label = failedRound === "day" ? "TARİH ÇIKMADI." : isTimeRound ? "SAAT ÇIKMADI." : "KARAR ÇIKMADI.";
  const detail = failedRound === "day" ? "Bütün katılımcılar tarih seçimini tamamlamadı." : failedRound === "timeSuggestion" ? "Bütün katılımcılar saat önermedi." : failedRound === "timeVoting" ? "Bütün katılımcılar saat oyunu kullanmadı." : "Yeterli geçerli cevap gelmedi.";
  return <section className="screen"><div className="surface no-decision"><div className="eyebrow">Masa kısa bir mola verdi</div><h1>KİMSE BUNU<br /><span style={{ color: "var(--acid)" }}>YETERİNCE İSTEMEDİ.</span></h1><p>{detail} İstersen aynı havuzu bir tur daha açıp tekrar deneyebilirsiniz.</p><div className="action-row">{member.role === "ADMIN" ? <button className="button primary" onClick={onRetry}>YENİ TUR ATALIM</button> : <span className="small muted">Burak isterse yeni turu başlatabilir.</span>}<button className="button ghost" onClick={onBack}>Ana masa</button></div></div></section>;
}

function ReactionBar({ meta, onReact }: { meta: EventMeta; onReact: (reaction: string) => void }) {
  const [bubbles, setBubbles] = useState<Array<{ id: string; memberId: string; reaction: string }>>([]);
  const [cooldown, setCooldown] = useState(false);
  const previousReactions = useRef<Record<string, string> | null>(null);

  useEffect(() => {
    const previous = previousReactions.current;
    previousReactions.current = meta.reactions;
    if (!previous) return;
    const changed = Object.entries(meta.reactions).filter(([memberId, reaction]) => previous[memberId] !== reaction);
    if (!changed.length) return;
    const additions = changed.map(([memberId, reaction]) => ({ id: `${memberId}-${reaction}-${Date.now()}-${Math.random()}`, memberId, reaction }));
    setBubbles((current) => [...current, ...additions].slice(-6));
    additions.forEach((bubble) => window.setTimeout(() => setBubbles((current) => current.filter((item) => item.id !== bubble.id)), 2800));
  }, [meta.reactions]);

  function handleReact(reaction: string) {
    if (cooldown) return;
    setCooldown(true);
    onReact(reaction);
    window.setTimeout(() => setCooldown(false), 900);
  }

  return <>
    <div className="reaction-bubbles" aria-live="polite"><AnimatePresence>{bubbles.map((bubble) => <motion.div key={bubble.id} className="reaction-bubble" initial={{ opacity: 0, x: 42, y: 24, scale: .72 }} animate={{ opacity: 1, x: 0, y: 0, scale: 1 }} exit={{ opacity: 0, x: 12, y: -34, scale: .84 }} transition={{ duration: .45, ease: "easeOut" }}><span className="reaction-bubble-emoji">{REACTION_EMOJIS[bubble.reaction]}</span><strong>{MEMBERS.find((person) => person.id === bubble.memberId)?.name ?? "Birisi"}</strong></motion.div>)}</AnimatePresence></div>
    <div className="reaction-bar"><span className="eyebrow">MASA TEPKİSİ</span><div className="reaction-list">{REACTION_OPTIONS.map((reaction) => <button key={reaction} aria-label={reaction} title={reaction} disabled={cooldown} className={`reaction-button ${Object.values(meta.reactions).filter((item) => item === reaction).length ? "has-reaction" : ""}`} onClick={() => handleReact(reaction)}><span className="reaction-emoji">{REACTION_EMOJIS[reaction]}</span><small>{Object.values(meta.reactions).filter((item) => item === reaction).length || ""}</small></button>)}</div></div>
  </>;
}

function OrganizerStage({ event, member, soundEnabled, meta, onReact, onSubmit }: { event: EventData; member: Member; soundEnabled: boolean; meta: EventMeta; onReact: (reaction: string) => void; onSubmit: (detail: string) => void }) {
  const [detail, setDetail] = useState("");
  const organizer = MEMBERS.find((person) => person.id === event.organizerId);
  const isOrganizer = member.id === event.organizerId;
  useEffect(() => { playUiSound("roulette", soundEnabled); }, [soundEnabled]);
  return <section className="screen"><div className="surface organizer-stage"><div className="organizer-stage-inner"><div><div className="eyebrow">Adil rotation · final görev</div><h2>TAMAM DA<br /><span style={{ color: "var(--acid)" }}>BUNU KİM TOPARLAYACAK?</span></h2><p className="muted">Kurban seçildi.</p><motion.div className="roulette-name" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>{organizer?.name ?? "..."}</motion.div><p className="organizer-copy">{event.organizerMessage ?? "Kaçış yok."}</p></div><div className="organizer-wait organizer-message-round"><div><span className="eyebrow">{isOrganizer ? "Son söz sende" : `${possessiveName(organizer?.name ?? "Organizatör")} ek mesajı bekleniyor`}</span><p>{isOrganizer ? "Yer, buluşma notu veya herkese söylemek istediğin kısa mesajı ekleyebilirsin." : `${organizer?.name ?? "Organizatör"} isterse son bir yer veya mesaj ekleyebilir.`}</p></div><div className="organizer-message-timer"><RoundTimer endsAt={event.roundEndsAt} /><span>SANİYE İÇİNDE PLAN KAPANIR</span></div>{isOrganizer ? <div className="organizer-message-form"><input className="input" autoFocus value={detail} maxLength={180} onChange={(inputEvent) => setDetail(inputEvent.target.value)} placeholder="Örn. Yer Viaport, saat 20.15. Herkese selam." /><button className="button primary" disabled={!detail.trim()} onClick={() => onSubmit(detail)}>MESAJI EKLE</button></div> : null}</div><ReactionBar meta={meta} onReact={onReact} /></div></div></section>;
}

function FinalStage({ event, member, soundEnabled, meta, onAcknowledge, onReact, onBack }: { event: EventData; member: Member; soundEnabled: boolean; meta: EventMeta; onAcknowledge: () => void; onReact: (reaction: string) => void; onBack: () => void }) {
  const [showIntro, setShowIntro] = useState(true);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [shareState, setShareState] = useState<"idle" | "shared" | "error">("idle");
  const [now, setNow] = useState(Date.now());
  const optionList = getOptionList(event);
  const winner = optionList.find((item) => item.id === event.winnerId) ?? optionList[0];
  const participantIds = event.planningMode === "schedule" && event.participants?.length ? event.participants : event.joined;
  const participants = MEMBERS.filter((person) => participantIds.includes(person.id));
  const organizer = MEMBERS.find((person) => person.id === event.organizerId);
  const place = getPlaceWinner(event)?.text;
  const activity = winner?.text ?? "Karar";
  const organizerName = organizer?.name ?? "—";
  const planDate = event.planningMode === "decision" ? "Bu gece" : formatPlanDay(event.schedule?.selectedDay);
  const planTime = event.planningMode === "decision" ? "BU GECE" : `${formatPlanDay(event.schedule?.selectedDay)} · ${event.schedule?.selectedTime ?? "—"}`;
  const calendarUrl = googleCalendarUrl(event, activity, organizerName);
  const plainText = `${planDate}${event.schedule?.selectedTime ? ` · ${event.schedule.selectedTime}` : ""} — ${activity}${place ? ` · ${place}` : ""}. Organizasyonu ${organizerName} üstlenecek.${event.organizerDetail ? ` ${possessiveName(organizerName)} ek mesajı: ${event.organizerDetail}` : ""}`;
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  const planStarted = Boolean(planStartsAt(event) && planStartsAt(event)! <= now);
  const nextStep = planStarted ? "Plan başladı." : event.organizerDetail ? "Planı uygulamak." : `${organizerName}'dan son detay bekleniyor.`;
  useEffect(() => { playUiSound("lock", soundEnabled); }, [soundEnabled]);
  const copyPlan = async () => {
    const markdown = [
      "# UNKAN PLANI",
      "",
      `- **Etkinlik:** ${activity}`,
      `- **Tarih:** ${planDate}`,
      ...(event.schedule?.selectedTime ? [`- **Saat:** ${event.schedule.selectedTime}`] : []),
      ...(place ? [`- **Mekân:** ${place}`] : []),
      `- **Organizatör:** ${organizerName}`,
      ...(event.organizerDetail ? [`- **${possessiveName(organizerName)} ek mesajı:** ${event.organizerDetail}`] : []),
      `- **Katılımcı:** ${participants.length} kişi`,
      "",
      `> ${planDate} tarihinde${event.schedule?.selectedTime ? `, saat ${event.schedule.selectedTime}` : ""} **${activity}** yapılacak.${place ? ` Mekân: **${place}**.` : ""} Organizasyonu **${organizerName}** üstlenecek.`,
    ].join("\n");

    try {
      await navigator.clipboard.writeText(markdown);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2200);
    } catch {
      setCopyState("error");
      window.setTimeout(() => setCopyState("idle"), 2200);
    }
  };
  const sharePlan = async () => {
    try {
      if (navigator.share) await navigator.share({ title: "UNKAN Planı", text: plainText });
      else await navigator.clipboard.writeText(plainText);
      setShareState("shared");
      window.setTimeout(() => setShareState("idle"), 2200);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setShareState("error");
      window.setTimeout(() => setShareState("idle"), 2200);
    }
  };
  const shareWhatsApp = () => { window.open(`https://wa.me/?text=${encodeURIComponent(`${plainText}\n\n${window.location.origin}`)}`, "_blank", "noopener,noreferrer"); };
  const feedback = copyState === "copied" ? "Markdown plan panoya kopyalandı." : copyState === "error" ? "Kopyalanamadı. Tarayıcı iznini kontrol et." : shareState === "shared" ? "Paylaşım hazır." : shareState === "error" ? "Paylaşım açılamadı." : "Karar herkes için görünür.";
  if (showIntro) return <section className="screen final-video-screen"><div className="surface reveal-stage"><div className="reveal-title"><div className="eyebrow">UNKAN · KARAR FİŞİ HAZIRLANIYOR</div><h2>KARAR<br /><span style={{ color: "var(--acid)" }}>KAPANIYOR.</span></h2><p>Tek plan kalıyor.</p></div><FinalIntroVideo soundEnabled={soundEnabled} onDone={() => setShowIntro(false)} /></div></section>;
  return <section className="screen final-screen"><div className="screen-head final-screen-head"><div><div className="eyebrow">Final plan · hazır</div><h1 className="screen-title">PLAN<br /><span style={{ color: "var(--acid)" }}>HAZIR.</span></h1></div><button className="button ghost" onClick={onBack}><ChevronLeft size={15} /> Ana sayfa</button></div><div className="surface final-card"><div className="eyebrow">UNKAN / {event.category}</div><h2>{activity}</h2><div className="final-meta"><span className="meta-chip">{planTime}</span>{place ? <span className="meta-chip"><MapPin size={13} /> {place}</span> : null}<span className="meta-chip">{event.category}</span><span className="meta-chip">{participants.length} kişi</span></div><div className="next-step-card"><span className="eyebrow">SIRADAKİ İŞ</span><strong>{planStarted ? "PLAN BAŞLADI." : nextStep}</strong></div>{event.organizerDetail ? <div className="final-detail"><span className="eyebrow">{possessiveName(organizerName)} ek mesajı</span><p>{event.organizerDetail}</p></div> : null}{event.planningMode === "schedule" ? <div className="participant-list"><span className="eyebrow">KATILIMCILAR</span><div>{participants.map((person) => <span key={person.id}>{person.name}</span>)}</div></div> : null}<div className="organizer-block"><div className="eyebrow">ORGANİZATÖR</div><strong>{organizerName}</strong><p className="organizer-promise">{event.organizerMessage ?? "Bu organizeyi sen yapacaksın, sana güveniyorum. Lütfen görevini aksatma :)"}</p></div><div className="decision-receipt"><span>UNKAN KARAR FİŞİ</span><strong>{activity}</strong><small>{planTime}</small><small>ORGANİZATÖR · {organizerName}</small><b>PLAN KAPANDI</b></div><div className="acknowledgement"><div><span className="eyebrow">PLANI GÖRDÜN MÜ?</span><div className="ack-list">{MEMBERS.map((person) => <span key={person.id} className={meta.acknowledged.includes(person.id) ? "seen" : "waiting"}>{person.name} {meta.acknowledged.includes(person.id) ? "✓" : "…"}</span>)}</div></div><button className="button ghost" disabled={meta.acknowledged.includes(member.id)} onClick={onAcknowledge}><ClipboardCheck size={15} /> {meta.acknowledged.includes(member.id) ? "GÖRDÜN ✓" : "GÖRDÜM"}</button></div><ReactionBar meta={meta} onReact={onReact} /></div><div className="final-actions"><span className="small muted" aria-live="polite"><Check size={14} /> {feedback}</span><div className="final-action-buttons"><button className="button ghost" onClick={() => void copyPlan()}>{copyState === "copied" ? "KOPYALANDI" : "Planı kopyala"} {copyState === "copied" ? <Check size={15} /> : <ArrowUpRight size={15} />}</button><button className="button ghost" onClick={() => void sharePlan()}><Share2 size={15} /> {shareState === "shared" ? "PAYLAŞILDI" : "Paylaş"}</button><button className="button ghost" onClick={shareWhatsApp}><MessageCircle size={15} /> WhatsApp’a gönder</button>{calendarUrl ? <a className="button primary" href={calendarUrl} target="_blank" rel="noreferrer"><CalendarPlus size={16} /> Takvime ekle</a> : null}</div></div>{calendarUrl ? <p className="calendar-note">Google Calendar planı hazır açar. Kaydettiğinde kendi takvimindeki varsayılan hatırlatmalar çalışır.</p> : null}<div className="instagram-promo"><span className="eyebrow">UNKAN'ı takip et</span><div className="instagram-links"><a href="https://www.instagram.com/burakunkan/" target="_blank" rel="noreferrer" className="instagram-link"><span className="instagram-icon"><Instagram size={17} /></span><span>@burakunkan</span><ArrowUpRight size={14} /></a><a href="https://www.instagram.com/unkan.ai/" target="_blank" rel="noreferrer" className="instagram-link"><span className="instagram-icon"><Instagram size={17} /></span><span>@unkan.ai</span><ArrowUpRight size={14} /></a></div></div></section>;
}
