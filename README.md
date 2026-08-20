# UNKAN

UNKAN, sabit 8 kişilik arkadaş grubunun karar verememe problemini çözen özel karar masasıdır.

> Kaos içeri girer. Tek karar dışarı çıkar.

## Local setup

```bash
npm install
npm run dev
```

Uygulama `http://localhost:3000` adresinde açılır. Supabase env değişkenleri yoksa yalnızca local demo store kullanılır; Vercel deployunda Supabase değişkenlerini mutlaka tanımlayın.

Demo invite linkleri ana ekranda yalnızca session cookie bulunmadığında görünür. Gerçek kullanımda bu linkleri yalnızca ilgili kişiye gönderin.

## Supabase

`.env.example` dosyasını `.env.local` olarak kopyalayın:

```bash
copy .env.example .env.local
```

Gerekli değişkenler:

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
CRON_SECRET=...
```

Migration ve seed:

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
npx supabase db seed
```

Alternatif olarak Supabase SQL Editor’da sırasıyla şu dosyaları çalıştırın:

- `supabase/migrations/0001_initial.sql`
- `supabase/migrations/0002_event_snapshot.sql`
- `supabase/migrations/0003_atomic_event_snapshot.sql`
- `supabase/seed.sql`

Migration; sabit üyeler, invite session’ları, event joins, ideas, anonymous votes, availability, organizer history, decision history ve idea pool tablolarını oluşturur. `0002_event_snapshot.sql`, mevcut UI event akışını Vercel instance’ları arasında kalıcı tutan `client_state` alanını ekler. `0003_atomic_event_snapshot.sql`, farklı tarayıcılardan aynı anda gelen tam snapshot yazmalarını satır kilidiyle birleştirir; böylece fikir ve oylar birbirini ezmez. RLS açık tutulur; üretim yazmaları yalnızca server-side service role üzerinden yapılır.

## Invite links

Seed tokenları:

```text
/join/a8Fc29Lp  Burak
/join/e7Km41Qx  Emin
/join/f3Tn82Vz  Furkan
/join/r6Hy19Md  Erkut
/join/k9Pb53Ls  Kübra
/join/b2Nx74Rw  Buse
/join/z5Qc68Va  Beyza
/join/c4Jm27Tk  Kerim
```

Üretimde tokenlar düz metin olarak değil, SHA-256 hash olarak veritabanında tutulmalıdır. Invite route yalnızca server session cookie üretir; client member seçemez.

## Vercel

1. Supabase’te `0001_initial.sql`, `0002_event_snapshot.sql`, `0003_atomic_event_snapshot.sql` ve `seed.sql` dosyalarını bu sırayla çalıştırın.
2. Repository’yi Vercel’e import edin.
3. Vercel Environment Variables’a `.env.local` içindeki değişkenleri ekleyin. `SUPABASE_SERVICE_ROLE_KEY` yalnızca server env olarak tanımlanmalı, `NEXT_PUBLIC_` ile başlamamalıdır.
4. `MEMBER_SESSION_SECRET` için uzun ve rastgele bir değer kullanın.
5. Production build komutu `npm run build` olarak çalışır.
6. Supabase Realtime gerekiyorsa `events`, `event_joins`, `ideas`, `votes` ve `decision_history` tablolarını yayın listesine ekleyin.

## Test ve kalite

```bash
npm run typecheck
npm run build
```

UI; 8/8 lobby gate, fikir havuzu, gizli approval voting, fiziksel sonuç reveal’i, organizer roulette, otomatik lock, final plan ve tıklanabilir Instagram kapanışını içerir.
