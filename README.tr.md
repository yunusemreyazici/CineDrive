# CineDrive

Türkçe · **[English](README.md)**

Google Drive klasörlerinizde — ya da yerel diskinizde — duran film ve dizileri gezilebilir, izlenebilir bir kütüphaneye dönüştüren, kendi sunucunuzda çalışan bir medya sunucusu.

CineDrive depolamanızı tarar, her dosyayı TMDB ile eşleştirip kapak görselini ve bilgilerini çeker, sonra tarayıcıya yayınlar. Tarayıcının doğrudan oynatamadığı dosyalar anlık olarak dönüştürülür; geri kalan her şey bayt aralığı istekleriyle olduğu gibi sunulur.

## Ekran Görüntüleri

| Ana Sayfa | Medya Detayı |
| --- | --- |
| ![Ana Sayfa](docs/screenshots/home_dashboard.png) | ![Medya Detay](docs/screenshots/media_detail_page.png) |

> Ekran görüntüleri son arayüz çalışmalarından önceye ait, yenilenmeleri gerekiyor.

## Özellikler

### Kütüphane

- **Google Drive** — klasörlerinize ve erişebildiğiniz Ortak Sürücülere salt okunur OAuth 2.0 erişimi. CineDrive Drive'a hiçbir zaman yazmaz.
- **Yerel klasörler** — bir kütüphaneyi sunucudaki bir yola bağlayıp Drive'a hiç dokunmadan tarayın.
- **Çoklu hesap** — birden fazla Google hesabı bağlayabilirsiniz. Her kütüphane bir kullanıcıya aittir; bir hesabın medyası, favorileri ve geçmişi diğerine görünmez.
- **Metadata** — başlık, özet, tür, oyuncu kadrosu ve görseller TMDB'den; TMDB anahtarı yoksa TVMaze'e düşülür.
- **Arama** — `⌘K` / `Ctrl+K` ile açılan, klavyeyle gezilebilen anlık arama.
- **Filtreleme** — puana, döneme ve türe göre sıralama ve süzme; sonuçlar sunucu tarafında sayfalanır.

### Oynatma

- **Doğrudan akış** — HTTP Range (206) yanıtlarıyla, dosyayı indirmeden ileri sarabilirsiniz.
- **Uyumluluk dönüşümü** — tarayıcı kaynağı oynatamıyorsa FFmpeg anlık olarak HLS akışı üretir. Eşzamanlı kodlayıcı sayısı ve diskteki önbellek sınırlıdır.
- **Tarayıcıya göre oynatma planı** — aynı dosya Chromium'da doğrudan oynarken Safari'de HLS gerektirebilir; karar, dosyadan okunan codec bilgisine göre tarayıcı başına verilir.
- **Altyazı** — OpenSubtitles araması ve tek tıkla indirme, `.srt` / `.vtt` yükleme, zaman kaydırma ve stil ayarları.
- **Kaldığın yerden devam** — oynatma konumu, izleme geçmişi ve bölüm sonunda otomatik geçiş.

### Arayüz

- **İki dil** — Türkçe ve İngilizce, Ayarlar → Dil bölümünden değiştirilir.
- **Yedi renk teması** ve izleme sırasında arayüzü karartan sinema modu.
- **Bakım ekranları** — toplu veri yönetimi, depolama analizi (boyut, çözünürlük dağılımı, mükerrer dosyalar), medya sağlığı (codec uyumluluğu, canlı FFmpeg işleri, oynatma telemetrisi) ve veritabanı yönetimi (kayıt sayıları, artık kayıt temizliği).

## Mimari

```
CineDrive/
├── apps/
│   ├── server/          # Fastify REST API ve medya sunucusu
│   │   ├── prisma/      # Şema, migration geçmişi, çalışma zamanı verisi
│   │   ├── scripts/     # Tek seferlik bakım betikleri
│   │   └── src/
│   │       ├── routes/      # HTTP yüzeyi
│   │       ├── services/    # Drive, tarama, metadata, HLS, altyazı
│   │       ├── plugins/     # Prisma ve kimlik doğrulama
│   │       └── utils/       # Ortak yardımcılar (sahiplik filtreleri, eşzamanlılık)
│   └── web/             # React + Vite arayüzü
│       └── src/
│           ├── pages/       # Rota seviyesindeki ekranlar
│           ├── features/    # Oynatıcı ve hook'ları
│           ├── components/  # Ortak arayüz bileşenleri
│           └── i18n/        # tr / en sözlükleri
├── packages/
│   └── shared/          # Tipler, Zod şemaları, dosya adı ayrıştırıcıları
├── e2e/                 # Playwright senaryoları ve izole ortam
├── nginx/               # Reverse proxy yapılandırması
├── .github/workflows/   # CI
├── Dockerfile.server
├── Dockerfile.web
└── docker-compose.yml
```

### Oynatma kararı nasıl veriliyor

Her video dosyası tarama sırasında incelenir; kapsayıcısı, video ve ses codec'i kaydedilir. Bir istemci oynatmak istediğinde sunucu, tarayıcı başına dört moddan birini seçer:

| Mod | Ne oluyor |
| --- | --- |
| `direct` | Dosya olduğu gibi HTTP Range üzerinden akıtılır. Dönüşüm yok. |
| `audio` | Video kopyalanır, yalnızca ses AAC'ye yeniden kodlanır. |
| `hls` | Anlık HLS akışı üretilir; video kopyalanabilir veya yeniden kodlanabilir. |
| `full` | Her iki iz de H.264 + AAC'ye yeniden kodlanır. |

Safari ve Chromium için ayrı cevaplar verilir, çünkü codec desteğleri farklıdır — Ayarlar → Medya Sağlığı ekranı kütüphanenizdeki dağılımı gösterir.

### Veri modeli

On altı tablo; çekirdek zincir şu:

```
User ──< Library ──< DriveFile ──< Movie / Episode
             └──< MediaItem ──< Season / SubtitleTrack / Favorite / …
```

Her erişim kontrolü `Library.userId` ve `MediaItem.libraryId` üzerinden yapılır: bir istek yalnızca çağıranın kendi kütüphanelerinden ulaşılabilen satırları görür.

## Başlangıç

### Gereksinimler

- Node.js 20 veya üzeri — Docker imajları `node:20-alpine` üzerine kuruluyor
- pnpm (depo bir pnpm workspace'i; imajlar Corepack ile kuruyor)
- FFmpeg — `ffmpeg-static` ile birlikte geliyor, sisteme ayrıca kurmak gerekmez
- Drive kütüphaneleri için Drive API'si etkin bir Google Cloud projesi
- İsteğe bağlı: zengin metadata için TMDB anahtarı, altyazı araması için OpenSubtitles anahtarı

### Geliştirme

1. **Bağımlılıkları yükleyin**

   ```bash
   pnpm install
   ```

2. **Çevre değişkenlerini ayarlayın**

   ```bash
   cp .env.example .env
   ```

   Google OAuth bilgilerinizi, en az 32 karakterlik bir `SESSION_SECRET`, 64 karakterlik onaltılık bir `TOKEN_ENCRYPTION_KEY` ve ilk açılışta oluşturulacak yönetici hesabını girin.

3. **Veritabanını hazırlayın**

   ```bash
   pnpm --filter "@cinedrive/server" exec prisma migrate deploy
   ```

   > Prisma göreli bir `file:` adresini **şema dizinine**
   > (`apps/server/prisma/`) göre çözer, çalışma dizinine göre değil.
   > Varsayılan `file:./data/app.db` bu yüzden
   > `apps/server/prisma/data/app.db` anlamına gelir.

4. **Çalıştırın**

   ```bash
   pnpm dev
   ```

   - Web: `http://localhost:5173`
   - API: `http://localhost:3000`

   `ADMIN_EMAIL` / `ADMIN_PASSWORD` ile tanımlanan yönetici hesabı ilk açılışta oluşturulur. Google Drive bağlantısı, giriş yaptıktan sonra Ayarlar sayfasından yapılır — OAuth akışı oturum açmış bir kullanıcı gerektirir.

### Mevcut bir kurulumu güncelleme

Kütüphaneler `Library.userId`, medya kayıtları `MediaItem.libraryId` taşır. İki sütun da migration geçmişinde yer alır, `migrate deploy` yeterlidir.

Veritabanınız migration geçmişinden bile önceye aitse sahipliği önce doldurun. Betik varsayılan olarak kuru çalışır:

```bash
pnpm --filter "@cinedrive/server" exec tsx scripts/add-library-owner.ts --apply
```

## Test

```bash
pnpm typecheck     # Tüm paketlerde tsc
pnpm lint          # ESLint (react-hooks / jsx-a11y / react-refresh dahil)
pnpm test          # Vitest: shared + web + server
pnpm test:e2e      # Playwright uçtan uca senaryolar
```

Sunucu testleri kendi tek kullanımlık SQLite veritabanını kurar ve koşu sonunda siler; geliştirme veritabanına hiç dokunmaz. Uçtan uca koşu kendi API ve web sunucularını ayrı portlarda başlatır, FFmpeg ile gerçek bir H.264 klip üretir ve giriş, gezinme, oynatma ile ayarları bu ortam üzerinde sürer.

CI her push'ta typecheck, lint, birim testleri ve derlemeyi çalıştırır; uçtan uca takım bunların ardına bağlıdır.

## Yapılandırma

`.env.example` tüm değişkenleri açıklamasıyla listeler. Sık gerekenler:

| Değişken | Açıklama |
| --- | --- |
| `DATABASE_URL` | SQLite adresi. Göreli yol Prisma şema dizinine göre çözülür. |
| `SESSION_SECRET` | Oturum çerezi imzalama anahtarı, en az 32 karakter. |
| `TOKEN_ENCRYPTION_KEY` | Saklanan Google yenileme belirteçlerini şifrelemek için 64 karakterlik onaltılık anahtar. |
| `METADATA_LANGUAGE` | TMDB başlık ve özetlerinin dili (varsayılan `tr-TR`). |
| `HLS_MAX_ACTIVE_JOBS` | Aynı anda çalışabilecek FFmpeg dönüşüm sayısı. |
| `HLS_CACHE_MAX_BYTES` | HLS önbellek kotası; aşılınca en eski kullanılan akışlar tahliye edilir. |
| `TRANSCODE_MAX_ACTIVE_SESSIONS` | Eşzamanlı canlı uyumluluk oturumu sayısı. |

**`METADATA_LANGUAGE` arayüz dili değildir.** Arayüz dili her tarayıcının kendi seçimidir; TMDB metinleri ise tarama sırasında veritabanına yazılır ve kütüphaneyi okuyan herkesin gördüğü tek bir kopyadır. Bu değişkeni değiştirmek **yalnızca yeni taramaları** etkiler; mevcut kayıtlar siz yeniden tarayana kadar çekildikleri dilde kalır.

## Dağıtım

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f
```

Sunucu konteyneri açılışta `prisma migrate deploy` çalıştırır; şema, şema dosyasından çıkarılmak yerine sürümlenmiş migration geçmişinden kurulur.

Önde reverse proxy olarak Nginx durur; akış rotalarında tamponlama kapalıdır, böylece bayt aralığı ve HLS yanıtları üretildikleri anda istemciye ulaşır.

## Sorun Giderme

**Tarama sonrası kütüphane boş.** Ayarlar → Medya Sağlığı ekranına bakın: incelenemeyen dosyalar hatalarıyla birlikte orada listelenir ve tek tek yeniden analiz edilebilir.

**Bir içerik Chrome'da oynuyor, Safari'de oynamıyor.** HEVC ve bazı ses codec'leri için bu beklenen durum. Medya Sağlığı ekranı her tarayıcının hangi oynatma modunu aldığını gösterir; oynatıcıda elle açılabilen bir ses/Safari uyumluluk anahtarı da var.

**Oynatma takılıyor veya hiç başlamıyor.** Medya Sağlığı; aktif FFmpeg işlerini, bekleme kuyruğunu ve her akışın ne kadar önden tamponladığını gösterir. Kuyruk doluysa `HLS_MAX_ACTIVE_JOBS` değerini artırın — işlemci gücünüz elverdiği ölçüde.

**Metadata yanlış dilde geldi.** Yukarıdaki `METADATA_LANGUAGE` notuna bakın; yalnızca yeni taramalarda geçerlidir.

**Kayıtlar artık var olmayan dosyaları gösteriyor.** Ayarlar → Veritabanı bölümünde, arkasında oynatılacak hiçbir şey kalmamış medya kayıtlarını ve yarıda kesilmiş taramaları temizleyen bir bakım işlemi var.

## Lisans

MIT
