# CineDrive

Google Drive klasörlerindeki ve yerel disklerdeki film ve dizileri tarayarak kişisel bir medya yayın sunucusuna dönüştüren web uygulaması.

## Ekran Görüntüleri

| Ana Sayfa | Medya Detayı |
| --- | --- |
| ![Ana Sayfa](docs/screenshots/home_dashboard.png) | ![Medya Detay](docs/screenshots/media_detail_page.png) |

## Özellikler

### Kütüphane

- **Google Drive entegrasyonu:** Salt okunur OAuth 2.0 ile Drive klasörlerini ve Ortak Sürücüleri (Shared Drives) tarama.
- **Yerel disk kütüphaneleri:** Sunucudaki klasörleri Drive'a hiç dokunmadan tarama.
- **Çoklu hesap:** Birden fazla Google hesabı bağlama; her kütüphane bir kullanıcıya ait ve medya hesaplar arasında paylaşılmaz.
- **Otomatik metadata:** TMDB üzerinden başlık, özet, tür, oyuncu ve kapak görselleri; TMDB anahtarı yoksa TVMaze'e düşer.
- **Arama:** `⌘K` / `Ctrl+K` ile açılan, klavyeyle gezilebilen anlık arama.

### Oynatma

- **Doğrudan akış:** Fastify HTTP Range (206) desteğiyle kesintisiz aktarım.
- **HLS uyumluluk katmanı:** Tarayıcının desteklemediği codec'ler için FFmpeg ile canlı dönüşüm; eşzamanlı iş sayısı ve önbellek kotası sınırlı.
- **Altyazı:** OpenSubtitles araması ve tek tıkla indirme, harici `.srt` / `.vtt` yükleme, zaman kaydırma ve stil ayarları.
- **İzleme takibi:** Kaldığın yerden devam etme, izleme geçmişi ve bölüm sonunda otomatik geçiş.

### Arayüz

- **İki dil:** Türkçe ve İngilizce; Ayarlar → Dil bölümünden değiştirilir.
- **Yedi renk teması** ve sinema modu.
- **Bakım ekranları:** Veri yönetimi (toplu silme), depolama analizi (boyut, çözünürlük dağılımı, mükerrer dosyalar), medya sağlığı (codec uyumluluğu, canlı HLS işleri) ve veritabanı yönetimi (istatistikler, artık kayıt temizliği).

## Teknoloji Yığını

- **Backend:** Node.js, Fastify 5, Prisma 6, SQLite (WAL), Zod, Pino, FFmpeg
- **Frontend:** React 19, Vite 6, Tailwind CSS, TanStack Query, Zustand, Lucide Icons
- **Mimari:** pnpm workspaces (monorepo), TypeScript
- **Test:** Vitest (birim + entegrasyon), Playwright (uçtan uca), GitHub Actions
- **Dağıtım:** Docker, Docker Compose, Nginx (reverse proxy)

## Proje Yapısı

```
CineDrive/
├── apps/
│   ├── server/       # Fastify REST API & medya sunucusu
│   │   └── prisma/   # Şema, migration geçmişi ve çalışma zamanı verisi
│   └── web/          # React + Vite web arayüzü
├── packages/
│   └── shared/       # Ortak tipler, Zod şemaları ve yardımcılar
├── e2e/              # Playwright senaryoları ve izole test ortamı
├── nginx/            # Reverse proxy yapılandırması
├── .github/workflows/
├── Dockerfile.server
├── Dockerfile.web
└── docker-compose.yml
```

## Kurulum ve Çalıştırma

### Geliştirme Ortamı

1. **Bağımlılıkları yükleyin:**
   ```bash
   pnpm install
   ```

2. **Çevre değişkenlerini ayarlayın:**
   ```bash
   cp .env.example .env
   ```
   `.env` dosyasını kendi Google OAuth ve OpenSubtitles bilgilerinize göre düzenleyin.

3. **Veritabanını hazırlayın:**
   ```bash
   pnpm --filter "@cinedrive/server" exec prisma migrate deploy
   ```

   > `DATABASE_URL` göreli bir `file:` adresi ise Prisma bunu **şema dizinine**
   > (`apps/server/prisma/`) göre çözer, çalışma dizinine göre değil. `.env`
   > içindeki varsayılan `file:./data/app.db` bu yüzden
   > `apps/server/prisma/data/app.db` anlamına gelir.

4. **Uygulamayı başlatın:**
   ```bash
   pnpm dev
   ```

   - Web Arayüzü: `http://localhost:5173`
   - API Sunucusu: `http://localhost:3000`

   İlk açılışta `.env` içindeki `ADMIN_EMAIL` / `ADMIN_PASSWORD` ile bir yönetici hesabı oluşturulur. Google Drive bağlantısı, giriş yaptıktan sonra Ayarlar sayfasından yapılır.

### Mevcut Bir Kurulumu Güncelleme

Kütüphaneler `Library.userId`, medya kayıtları da `MediaItem.libraryId` ile bir sahibe bağlıdır. Bu sütunlar migration geçmişinde yer alır; `migrate deploy` yeterlidir.

Sütunlar eklenmeden önce kurulmuş, migration geçmişi olmayan bir veritabanınız varsa sahipliği önce şu betikle doldurun (varsayılan olarak kuru çalışır, `--apply` ile yazar):

```bash
pnpm --filter "@cinedrive/server" exec tsx scripts/add-library-owner.ts --apply
```

## Test

```bash
pnpm typecheck     # Tüm paketlerde tsc
pnpm lint          # ESLint (react-hooks, jsx-a11y, react-refresh dahil)
pnpm test          # Vitest: shared + web + server
pnpm test:e2e      # Playwright uçtan uca senaryolar
```

Sunucu testleri kendi tek kullanımlık SQLite veritabanını kurar ve koşu sonunda siler; geliştirme veritabanına dokunmaz. Uçtan uca koşu kendi API ve web sunucularını ayrı portlarda başlatır, gerçek bir H.264 klip üretir ve akış yolunu baştan sona geçer.

## Yapılandırma Notları

`.env.example` tüm değişkenleri açıklamasıyla listeler. Sık gerekenler:

| Değişken | Açıklama |
| --- | --- |
| `DATABASE_URL` | SQLite adresi. Göreli yol şema dizinine göre çözülür. |
| `METADATA_LANGUAGE` | TMDB başlık ve özetlerinin dili (varsayılan `tr-TR`). Yalnızca **yeni taramaları** etkiler; mevcut kayıtlar yeniden taranana kadar değişmez. |
| `HLS_MAX_ACTIVE_JOBS` | Eşzamanlı FFmpeg dönüşüm sayısı. |
| `HLS_CACHE_MAX_BYTES` | HLS önbellek kotası; aşılınca en eski kullanılan tahliye edilir. |
| `TRANSCODE_MAX_ACTIVE_SESSIONS` | Eşzamanlı canlı uyumluluk oturumu sayısı. |

Arayüz dili `METADATA_LANGUAGE`'dan bağımsızdır: arayüz her tarayıcının kendi seçimi, TMDB metinleri ise veritabanında saklanan ve tüm kullanıcıların gördüğü tek bir kopyadır.

## Docker ile Dağıtım

```bash
docker compose up -d --build
```

Konteyner durumlarını ve logları kontrol etmek için:

```bash
docker compose ps
docker compose logs -f
```

Sunucu konteyneri açılışta `prisma migrate deploy` çalıştırır; şema, sürümlenmiş migration geçmişinden kurulur.

## Lisans

MIT
