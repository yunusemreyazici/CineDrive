# Geliştirme

[Dokümantasyon](../README.tr.md#dokümantasyon) · [English](DEVELOPMENT.md)

Yerel ortam ve veritabanı hazırlığı için [Kurulum](INSTALLATION.tr.md#yerel-geliştirme) belgesine bakın.

## Mimari

| Katman  | Teknoloji                                                            |
| ------- | -------------------------------------------------------------------- |
| Web     | React 19, Vite, React Router, TanStack Query, Zustand, Tailwind CSS  |
| API     | Node.js, TypeScript, Fastify, Zod, Pino                              |
| Veri    | Sürümlenmiş migration'larla Prisma ve SQLite                         |
| Medya   | Google Drive API, FFmpeg/HLS, `music-metadata`, Chromaprint/AcoustID |
| Testler | Vitest, Testing Library, Playwright                                  |

```text
CineDrive/
├── apps/
│   ├── server/
│   │   ├── prisma/          # Şema ve migration geçmişi
│   │   ├── scripts/         # Bakım araçları
│   │   └── src/
│   │       ├── routes/      # Fastify HTTP API
│   │       ├── services/    # Drive, tarama, metadata, oynatma, müzik, sözler
│   │       ├── plugins/     # Kimlik doğrulama ve Prisma
│   │       └── utils/
│   └── web/
│       └── src/
│           ├── pages/       # Route düzeyindeki ekranlar
│           ├── features/    # Video ve müzik oynatıcıları
│           ├── components/  # Ortak arayüz bileşenleri
│           └── i18n/        # Türkçe ve İngilizce sözlükler
├── packages/shared/         # Ortak tipler, Zod şemaları ve ayrıştırıcılar
├── e2e/                     # İzole Playwright ortamı
├── nginx/                   # Production reverse proxy
├── scripts/install-vps.sh   # Etkileşimli Debian/Ubuntu kurucusu
└── docker-compose.yml
```

Temel sahiplik yolu:

```text
User ──< Library ──< DriveFile ──< Movie / Episode / MusicTrack
  └──< GoogleConnection ──< DriveScanSource
  └──< Favourites / History / Playlists / PlaybackState
```

Bütün medya ve aktarım endpoint'leri, istenen dosyanın giriş yapan kullanıcının kütüphanelerinden biri üzerinden erişilebilir olduğunu doğrular.

## Komutlar

```bash
pnpm typecheck      # Tüm workspace paketlerinde TypeScript kontrolü
pnpm lint           # ESLint, React hooks, JSX erişilebilirlik, React Refresh
pnpm test           # Shared, web ve server Vitest paketleri
pnpm test:e2e       # Chromium ve WebKit Playwright senaryoları
pnpm build          # Shared, server ve web production derlemeleri
pnpm db:backup      # Saklama politikası uygulanan doğrulamalı SQLite snapshot'ı
pnpm db:restore     # Yedeği doğrular; geri yüklemek için --apply gerekir
pnpm release:check  # Birlikte ilerleyen SemVer ve changelog metadatasını doğrular
pnpm format         # TypeScript, JSON ve Markdown dosyalarını Prettier ile biçimlendirir
```

İlk yerel koşudan önce iki E2E tarayıcısını da kurun:

```bash
pnpm exec playwright install --with-deps chromium webkit
```

Tek tarayıcıyı `pnpm test:e2e --project=chromium` veya `pnpm test:e2e --project=webkit` ile çalıştırabilirsiniz.

## Test kapsamı

Vitest; ortak ayrıştırıcı ve şemaları, React bileşen ve hook'larını, API route ve servislerini, migration'ları, backup/restore davranışını ve güvenlik regresyonlarını kapsar. Release araçları ve doküman bağlantıları ayrı Node.js test paketleriyle doğrulanır (`pnpm release:test` ve `pnpm docs:test`).

Playwright izole API, medya fixture'ı, SQLite veritabanı ve çalışma dizinine özel önbellekler kullanır. Şunları doğrular:

- giriş ve korunan route'lar;
- kütüphane gezintisi, arama, detaylar, ayarlar ve dialog erişilebilirliği;
- gerçek video ve müzik oynatma;
- ileri/geri sarma ve yenileme sonrası devam etme;
- HLS manifestleri, segmentleri, seek pencereleri ve encoder yaşam döngüsü;
- kontrollü aktarım kesintisi ve sınırlı HLS toparlanması;
- Chromium ve WebKit tarayıcı yolları.

HLS hata proxy'si yalnızca teste özeldir; native WebKit medya trafiği dahil gerçek HLS isteklerine HTTP 503 yanıtı ekler. Production endpoint'i veya tarayıcı medya mock'u oluşturmaz. Bunlar kontrollü aktarım hatalarıdır; gerçek Wi-Fi ya da hücresel ağ geçişi testleri değildir.

## Sürekli entegrasyon

HLS senaryolarını `pnpm test:e2e e2e/hls.spec.ts` ile çalıştırın. Uyumluluk oynatımını sınamak için H.264/PCM MKV fixture'ı kullanılır. CI, Chromium'u Linux'ta, WebKit'i macOS'te çalıştırır; codec desteği tarayıcıya ve işletim sistemine bağlıdır. [Playwright WebKit](https://playwright.dev/docs/browsers#webkit), branded Safari veya fiziksel iOS cihazı testi değildir.

`pnpm docs:check`, kök Markdown dosyaları ve `docs/` altındaki yerel dosya, görsel ve başlık bağlantılarını kontrol eder; dış URL'lere istek göndermez. Kontrol aracını değiştirirken `pnpm docs:test` çalıştırın.

CI; desteklenen en düşük Node 22.13 sürümünde ve Node 24 hattında typecheck, test ve production derlemelerini çalıştırır. Production Docker Compose stack'ini başlatıp API'yi Nginx üzerinden kontrol eder; ardından Chromium ve WebKit E2E işlerini çalıştırır.

Üretim bağımlılığı taraması, audit adımı için beş dakikalık sınır ve pnpm'in yerleşik istek tekrarlarıyla bağımsız çalışır. Audit servisi kesintileri iş bağımlılıkları üzerinden doğrulama, Docker smoke veya tarayıcı testlerini engellemez; paket kurulumu için yine registry erişimi ya da önbellekteki paketler gerekir. Mevcut zorunlu `e2e` kontrolü birleşik bir sonuç kapısıdır: doğrulama, iki tarayıcı ve audit başarılı olmalıdır. Audit başarısız, iptal edilmiş veya atlanmışsa bu kapı kırmızı kalır; registry hataları başarı sayılmaz. Registry düzeldiğinde başarısız CI işlerini yeniden çalıştırın. `pnpm ci:test`, bu bağımlılıkları ve önceki işlerin success/failure/cancelled/skipped/boş sonuçlarının 125 birleşimini doğrular.

Ayrı least-privilege workflow iki production image'ını düzeltmesi bulunan high/critical açıklar için tarar ve CycloneDX SBOM'larını saklar. CodeQL JavaScript ve TypeScript'i tarar. Release PR'ları iki hedef mimariyi dry-run ile derler; `v*` etiketleri provenance attestation'lı ve keyless imzalı GHCR image'larını SBOM ve immutable digest manifestleriyle yayınlar. Dependabot digest ile sabitlenen base image'ları ve SHA ile sabitlenen action'ları günceller.

## Katkı akışı

Düzenleme yapmadan önce [CONTRIBUTING.md](../CONTRIBUTING.md) dosyasını okuyun. Değişiklikleri odaklı tutun, davranış değişikliklerine regression kapsamı ekleyin, belgelenen kontrolleri çalıştırın ve kullanıcıya görünen davranış değiştiğinde İngilizce/Türkçe belgeleri birlikte güncelleyin.

Sürüm çalışmaları ayrıca [CineDrive Sürümleme](RELEASING.tr.md) belgesini izlemeli ve [CHANGELOG.md](../CHANGELOG.md) dosyasını güncellemelidir.
