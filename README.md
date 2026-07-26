# CineDrive

Google Drive klasörlerindeki film ve dizileri tarayarak kişisel bir medya yayın sunucusuna dönüştüren web uygulaması.

## Ekran Görüntüleri

| Ana Sayfa | Medya Detayı |
| --- | --- |
| ![Ana Sayfa](docs/screenshots/home_dashboard.png) | ![Medya Detay](docs/screenshots/media_detail_page.png) |

## Özellikler

- **Google Drive Entegrasyonu:** Salt okunur OAuth 2.0 ile Drive klasörlerini tarama ve medya akışı.
- **Otomatik Metadata:** TVMaze API kullanarak film, dizi, sezon, bölüm bilgileri ve kapak görsellerini çekme.
- **Gelişmiş Video Oynatıcı:**
  - Fastify HTTP Range (206) desteği ile kesintisiz medya aktarımı.
  - OpenSubtitles API entegrasyonu ile otomatik altyazı arama ve tek tıkla indirme.
  - Harici `.srt` / `.vtt` altyazı dosyası yükleme.
  - Altyazı senkronizasyonu (zaman kaydırma) ve font/stil özelleştirme.
  - Bölüm sonlarında otomatik sonraki bölüme geçiş ve geri sayım.
- **İzleme Takibi:** Kaldığın yerden devam etme ve izleme geçmişi.

## Teknoloji Yığını

- **Backend:** Node.js, Fastify, Prisma ORM, SQLite (WAL Modu), Zod, Pino
- **Frontend:** React 18, Vite, Tailwind CSS, TanStack Query, Lucide Icons
- **Mimari:** pnpm workspaces (monorepo), TypeScript
- **Dağıtım:** Docker, Docker Compose, Nginx (Reverse Proxy)

## Proje Yapısı

```
CineDrive/
├── apps/
│   ├── server/       # Fastify REST API & Medya Sunucusu
│   └── web/          # React + Vite Web Arayüzü
├── packages/
│   └── shared/       # Ortak tipler ve doğrulama şemaları
├── nginx/            # Reverse proxy yapılandırması
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
   `.env` dosyasını kendi Google OAuth ve OpenSubtitles API bilgilerinize göre düzenleyin.

3. **Veritabanını hazırlayın:**
   ```bash
   DATABASE_URL="file:./data/app.db" pnpm --filter "@cinedrive/server" exec prisma db push
   ```

   > **Mevcut bir kurulumu güncelliyorsanız:** kütüphaneler artık `Library.userId`
   > ile bir kullanıcıya ait. `db push` bu sütunu veri kaybetmeden ekleyemediği
   > için önce aşağıdaki betiği çalıştırın; sahipliği Google bağlantısındaki
   > kullanıcıya, bağlantısı olmayan yerel kütüphanelerde ise en eski (admin)
   > hesaba atar. Betik varsayılan olarak kuru çalışır, `--apply` ile yazar.
   >
   > ```bash
   > pnpm --filter "@cinedrive/server" exec tsx scripts/add-library-owner.ts --apply
   > ```

4. **Uygulamayı başlatın:**
   ```bash
   pnpm dev
   ```

   - Web Arayüzü: `http://localhost:5173`
   - API Sunucusu: `http://localhost:3000`

### Docker ile Dağıtım

Production ortamında Docker Compose kullanarak tüm servisleri başlatabilirsiniz:

```bash
docker compose up -d --build
```

Konteyner durumlarını ve logları kontrol etmek için:

```bash
docker compose ps
docker compose logs -f
```

## Lisans

MIT
