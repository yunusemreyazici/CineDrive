# CineDrive

Türkçe · **[English](README.md)**

CineDrive; Google Drive'da veya yerel klasörlerde bulunan film, dizi ve müzikler için kendi sunucunuzda çalışan bir medya sunucusudur. Dosyalarınızı tarar, zengin metadata içeren bir kütüphane oluşturur ve içerikleri duyarlı bir web arayüzü üzerinden yayınlar.

Tarayıcının desteklediği videolar HTTP bayt aralığı istekleriyle değiştirilmeden sunulur. Kapsayıcı veya codec desteklenmiyorsa CineDrive, FFmpeg ile isteğe bağlı HLS akışı üretir. Müzikler gömülü etiketlerinden indekslenir; albüm, sanatçı, mix, çalma listesi, şarkı sözü, dinleme geçmişi ve eşzamanlanan kuyruk özellikleriyle sunulur.

## Ekran görüntüleri

| Ana sayfa                                                     | Medya detayı                                                      |
| ------------------------------------------------------------- | ----------------------------------------------------------------- |
| ![CineDrive ana sayfası](docs/screenshots/home_dashboard.png) | ![CineDrive medya detayı](docs/screenshots/media_detail_page.png) |

> Bu görüntüler film ve dizi arayüzünü gösteriyor. Daha yeni müzik ve bakım ekranlarının görüntüleri henüz eklenmedi.

## Öne çıkanlar

### Film ve diziler

- **Google Drive ve yerel klasörler** — normal klasörleri, Ortak Sürücüleri veya sunucudaki yerel yolları tarayın. Drive erişimi salt okunur OAuth kapsamını kullanır.
- **Birden fazla Drive kaynağı** — birden fazla Google hesabı bağlayın; kaynak klasörlerini, tarama durumunu ve geçmişini ayrı ayrı yönetin.
- **Otomatik metadata** — TMDB'den görseller, özet, tür, oyuncu kadrosu, puan, yaş sınırlaması ve fragman; TMDB ayarlı değilse TVMaze yedeği.
- **Kütüphane gezintisi** — `⌘K` / `Ctrl+K` ile arama, sunucu tarafında sayfalama, tür/puan/yıl filtreleri ve rastgele içerik seçici.
- **Kişisel durum** — favoriler, izleme geçmişi, kaldığın yerden devam, tamamlandı takibi ve sonraki bölüme otomatik geçiş.
- **Altyazı** — OpenSubtitles üzerinden arama, `.srt` veya `.vtt` yükleme, zaman kaydırma ve oynatıcı içinde görünüm ayarları.

### Müzik

- **Etiket tabanlı kütüphane** — Drive veya yerel ses dosyalarından sanatçı, albüm, disk, parça, tür, yayın yılı, katkıda bulunanlar ve gömülü görselleri indeksler.
- **Keşif** — günlük ve kütüphaneye özel mix'ler, sanatçı/parça radyosu, ruh hâli ve dönem koleksiyonları, kesintisiz oynatma ve kaydedilebilir çalma listeleri.
- **Replay** — dönem ve yıla göre dinleme istatistikleri, en çok dinlenen sanatçı/albüm/parçalar ve geçmiş dinleme özetleri.
- **Kişisel oynatma** — beğeniler, geçmiş, düzenlenebilir çalma listeleri, karıştırma/tekrarlama ve hesapta eşzamanlanan kuyruk ile oynatma konumu.
- **Şarkı sözleri** — yan dosya `.lrc` içe aktarma, LRCLIB araması, senkronize veya düz sözler, zaman hizalama, revizyonlar, elle çeviri ve isteğe bağlı LibreTranslate entegrasyonu.
- **Ses ayarları** — ReplayGain ses yüksekliği normalizasyonu, boşluksuz oynatma, crossfade ve hazır ayarlı beş bant ekolayzır.
- **Kütüphane bakımı** — metadata önerileri, toplu düzenleme, mükerrerleri arşivleme, ReplayGain analizi, Chromaprint/AcoustID eşleştirmesi ve otomatik sanatçı görseli bulma.
- **İstemci eşzamanlama API'si** — mobil/çevrimdışı istemciler için ETag destekli kütüphane eşzamanlama, toplu dinleme geçmişi, indirme manifesti ve kimlik doğrulamalı parça indirme.

### Platform

- Türkçe ve İngilizce arayüz, yedi renk teması, sinema modu ve masaüstü/mobil uyumlu gezinti.
- Kullanıcıya göre ayrılmış kütüphaneler, favoriler, geçmiş, çalma listeleri ve API anahtarları; şifrelenmiş Google yenileme belirteçleri.
- Otomatik Google erişim belirteci yenileme ve geçici Drive hataları için sınırlı yeniden deneme.
- Depolama, codec, FFmpeg işi, tarama ve veritabanı bakım ekranları.
- İstek sınırlama, güvenli çerezler, CORS, Helmet başlıkları, yapılandırılmış log ve kontrollü kapanış.

## Oynatma modları

Her video tarama sırasında analiz edilir. CineDrive kapsayıcı, video codec'i, ses codec'i, boyut ve süreyi kaydeder; ardından tarayıcıya özel oynatma planı oluşturur.

| Mod      | Davranış                                                                      |
| -------- | ----------------------------------------------------------------------------- |
| `direct` | Dosya HTTP Range desteğiyle olduğu gibi yayınlanır; yeniden kodlama yapılmaz. |
| `audio`  | Video kopyalanır, yalnızca ses AAC'ye dönüştürülür.                           |
| `hls`    | İstek üzerine HLS akışı üretilir; uyumlu izler kopyalanabilir.                |
| `full`   | En yüksek uyumluluk için video ve ses H.264 + AAC'ye dönüştürülür.            |

Safari ve Chromium aynı dosya için farklı planlar alabilir. HLS eşzamanlılık ve önbellek boyutu sınırlıdır; kota dolunca en uzun süredir kullanılmayan akışlar temizlenir.

## Mimari

| Katman | Teknoloji                                                            |
| ------ | -------------------------------------------------------------------- |
| Web    | React 19, Vite, React Router, TanStack Query, Zustand, Tailwind CSS  |
| API    | Node.js, TypeScript, Fastify, Zod, Pino                              |
| Veri   | Prisma ve sürümlenmiş migration'larla SQLite                         |
| Medya  | Google Drive API, FFmpeg/HLS, `music-metadata`, Chromaprint/AcoustID |
| Test   | Vitest, Testing Library, Playwright                                  |

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
│           ├── pages/       # Rota seviyesindeki ekranlar
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

Tüm medya sorguları ve aktarım uçları, istenen dosyanın oturum açan kullanıcının kütüphanelerinden erişilebilir olduğunu doğrular.

## Hızlı başlangıç

### Gereksinimler

- Node.js 20 veya üzeri
- pnpm 11 (depo bir pnpm workspace'idir)
- Gizli anahtar üretmek için OpenSSL
- Google Drive kullanacaksanız Drive API etkin bir Google Cloud OAuth istemcisi
- Normal Node/Docker kullanımı için ayrıca FFmpeg kurulumu gerekmez; `ffmpeg-static` dahildir
- Akustik parmak izi için isteğe bağlı `fpcalc`/Chromaprint

### Yerel geliştirme

1. Bağımlılıkları kurun:

   ```bash
   pnpm install
   ```

2. Ortam dosyasını oluşturun:

   ```bash
   cp .env.example .env
   openssl rand -hex 32  # SESSION_SECRET
   openssl rand -hex 32  # TOKEN_ENCRYPTION_KEY
   ```

   Kopyalanan production adreslerini yerel geliştirme için şöyle değiştirin:

   ```dotenv
   NODE_ENV=development
   APP_URL=http://localhost:5173
   API_URL=http://localhost:3000/api
   PUBLIC_URL=http://localhost:5173
   GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
   CORS_ORIGIN=http://localhost:5173
   DATABASE_URL="file:./data/app.db"
   TRUST_PROXY=false
   ```

   Üretilen değerleri `SESSION_SECRET` ve `TOKEN_ENCRYPTION_KEY` alanlarına yapıştırın; ardından `ADMIN_EMAIL`, `ADMIN_PASSWORD` ve Google OAuth bilgilerinizi ayarlayın. Aynı yerel callback adresini Google Cloud'a da kaydedin.

3. Prisma Client'ı üretip migration'ları uygulayın:

   ```bash
   pnpm prisma:generate
   pnpm --filter @cinedrive/server prisma:deploy
   ```

   Göreli SQLite adresi `apps/server/prisma/` dizininden çözülür; yukarıdaki örnek `apps/server/prisma/data/app.db` dosyasını oluşturur.

4. API ve web uygulamasını başlatın:

   ```bash
   pnpm dev
   ```

   - Web: `http://localhost:5173`
   - API: `http://localhost:3000`
   - Sağlık kontrolü: `http://localhost:3000/api/health`

`ADMIN_EMAIL` ve `ADMIN_PASSWORD` ile tanımlanan yönetici ilk açılışta oluşturulur. Giriş yaptıktan sonra Ayarlar'dan Drive hesaplarını bağlayıp kütüphane oluşturabilirsiniz.

## Yapılandırma

`.env.example` dağıtım odaklı varsayılanları içerir. En önemli ayarlar:

| Değişken                                       | Amaç                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| `DATABASE_URL`                                 | SQLite adresi. Konteyner ve production'da mutlak yol kullanın.                 |
| `SESSION_SECRET`                               | Çerez imzalama anahtarı; en az 32 karakter.                                    |
| `TOKEN_ENCRYPTION_KEY`                         | Google yenileme belirteçlerini şifreleyen tam 64 onaltılık karakter.           |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`     | Google OAuth istemci bilgileri.                                                |
| `GOOGLE_REDIRECT_URI`                          | OAuth callback adresi; Google'da kayıtlı adresle birebir aynı olmalı.          |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`                | İlk açılışta oluşturulan yönetici.                                             |
| `METADATA_LANGUAGE`                            | Gelecek taramalarda çekilecek metadata dili; varsayılan `tr-TR`.               |
| `MUSIC_METADATA_ONLINE`                        | Eksik yerel etiketlerin tutucu MusicBrainz eşleşmeleriyle tamamlanmasını açar. |
| `HLS_MAX_ACTIVE_JOBS`                          | Aynı anda çalışabilecek HLS kodlama işi sayısı.                                |
| `HLS_CACHE_MAX_BYTES`                          | Diskteki HLS önbellek kotası.                                                  |
| `TRANSCODE_MAX_ACTIVE_SESSIONS`                | Aynı anda çalışabilecek canlı uyumluluk oturumu sayısı.                        |
| `LIBRETRANSLATE_URL`, `LIBRETRANSLATE_API_KEY` | İsteğe bağlı şarkı sözü çeviri sağlayıcısı.                                    |
| `FPCALC_PATH`, `ACOUSTID_API_KEY`              | İsteğe bağlı akustik parmak izi ayarları.                                      |

TMDB, OpenSubtitles ve AcoustID anahtarları kullanıcı başına **Ayarlar → API yönetimi** bölümünden kaydedilebilir. Dağıtım genelindeki `TMDB_API_KEY`, `OPENSUBTITLES_API_KEY` ve `ACOUSTID_API_KEY` değerleri yedek olarak kullanılır.

`METADATA_LANGUAGE`, arayüz dilinden ayrıdır. Metadata tarama sırasında veritabanına yazılır; değişkeni değiştirmek mevcut kayıtları değil, gelecek taramaları etkiler.

## Dağıtım

### Docker Compose

`.env` dosyasını production adresleri ve gizli anahtarlarla ayarlayıp çalıştırın:

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f
```

Nginx web uygulamasını sunar ve `/api` isteklerini 80 numaralı porttan sunucuya aktarır. Sunucu konteyneri başlamadan önce sürümlenmiş Prisma migration'larını uygular. Uygulama verisi, altyazı önbelleği ve Nginx logları adlandırılmış volume'larda tutulur.

### Debian/Ubuntu VPS

Yeni bir VPS için etkileşimli kurucu; özel sistem kullanıcısını, Node.js'i, pnpm'i, FFmpeg'i, systemd'yi, Nginx'i, veritabanını ve TLS'i ayarlar:

```bash
sudo bash scripts/install-vps.sh
```

Kurucu Cloudflare Origin Certificate, Certbot/Let's Encrypt veya yalnızca HTTP modlarını destekler. Mevcut bir sunucuda çalıştırmadan önce betiği inceleyin; systemd ve Nginx yapılandırmasına yazar.

### Güncelleme

Yeni sürümü çektikten sonra servisi yeniden başlatmadan önce kilitli bağımlılıkları kurun, Prisma Client'ı üretin, migration'ları uygulayın ve projeyi derleyin:

```bash
pnpm install --frozen-lockfile
pnpm prisma:generate
pnpm --filter @cinedrive/server prisma:deploy
pnpm build
```

Migration'lar sürümlüdür ve `prisma migrate deploy` ile uygulanır. Sunucu testleriyle uçtan uca ortam izole SQLite veritabanları kullanır; geliştirme veritabanına dokunmaz.

## Geliştirme komutları

```bash
pnpm typecheck      # Tüm workspace paketlerinde TypeScript kontrolü
pnpm lint           # ESLint, React hooks, JSX erişilebilirlik, React Refresh
pnpm test           # shared, web ve server Vitest takımları
pnpm test:e2e       # Playwright smoke senaryoları
pnpm build          # shared, server ve web production derlemeleri
pnpm format         # TypeScript, JSON ve Markdown dosyalarını Prettier ile biçimlendirir
```

CI her pull request'te ve `main` dalına her push'ta typecheck, lint, birim testleri ve production derlemelerini çalıştırır; Playwright bunlar başarılı olduktan sonra koşar.

## Sorun giderme

- **Yerel giriş yönlendiriliyor veya çerez kaydedilmiyor:** `NODE_ENV=development`, yukarıdaki localhost adresleri ve `TRUST_PROXY=false` ayarlarını doğrulayın.
- **Google OAuth callback'i reddediyor:** `GOOGLE_REDIRECT_URI`, `.env` ile Google Cloud OAuth istemcisinde birebir aynı olmalı.
- **Tarama bazı dosyaları bulmadan tamamlanıyor:** Ayarlar'daki kütüphane kaynağı ve tarama geçmişini inceleyin. Başarısız öğelerin hataları saklanır ve yeniden analiz edilebilir.
- **İçerik Chromium'da oynuyor ama Safari'de oynamıyor:** genellikle kapsayıcı veya ses codec'i farkıdır. Ayarlar → Depolama ve medya sağlığı, her tarayıcı için oynatma planını gösterir.
- **Oynatma başlamadan bekliyor:** aktif FFmpeg işlerini ve kuyruğu inceleyin. `HLS_MAX_ACTIVE_JOBS` değerini yalnızca sunucuda yeterli CPU ve bellek varsa artırın.
- **Müzik metadatası eksik:** önce gömülü etiketleri kontrol edin, ardından Müzik kütüphanesi bakımı önerilerini çalıştırın. MusicBrainz tamamlama, güvenilir yerel etiketlerin üzerine otomatik yazmaz.
- **Şarkı sözü çevirisi kullanılamıyor:** `LIBRETRANSLATE_URL` ayarlayın; şarkı sözü aramasının kendisi LibreTranslate gerektirmez.
