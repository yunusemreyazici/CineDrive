# 🎬 CineDrive - Kişisel Google Drive Medya Sunucusu ve Oynatıcı

Google Drive arşivlerinizi yüksek performanslı, şık ve modern bir kişisel medya akış (streaming) platformuna dönüştüren **production-grade monorepo** uygulaması.

---

## 📸 Ekran Görüntüleri (Screenshots)

### 🏠 Ana Sayfa ve "Son Eklenenler"
![Ana Sayfa](docs/screenshots/home_dashboard.png)

### 🍿 Medya Detay Sayfası ve Sezon/Bölüm Listesi
![Medya Detay](docs/screenshots/media_detail_page.png)

---

## ✨ Öne Çıkan Özellikler

- **🔒 Google Drive OAuth 2.0 Entegrasyonu:** Salt okunur medya erişimi ile klasörlerinizi güvenle tarar.
- **🖼️ Otomatik Metadata & Afiş Toplayıcı (TVMaze API):** Dizi, film, bölüm afişlerini, arka plan görsellerini, özeti ve süre bilgilerini otomatik bulur.
- **🎥 Gelişmiş HTML5 Video Oynatıcı:**
  - HTTP Range 206 akışı ile donma/geikme olmadan yüksek kaliteli oynatma.
  - **OpenSubtitles.com v1 REST API** entegrasyonu (Tek tıkla Türkçe ve İngilizce altyazı indirme).
  - Yerel `.srt` ve `.vtt` altyazı dosyası yükleme desteği.
  - **Altyazı Senkronizasyon Kaydırma:** `-2s` ile `+2s` arası anlık altyazı zamanlama ayarı.
  - **Altyazı Stil Ayarları:** Yazı boyutu ve arka plan stili (siyah kutu/şeffaf) özelleştirme.
- **⏭️ Otomatik Sonraki Bölüm (Next Episode Countdown & Auto-play):** Dizi bölümü biterken beliren 5 saniyelik dairesel geri sayım kartı ile kesintisiz maraton izleme.
- **📊 İzleme İlerlemesi & Geçmişi:** Kaldığınız yeri saniyesi saniyesine otomatik kaydeder, mükerrer kartları engeller.
- **⚙️ OpenSubtitles & Sistem Ayarları:** Özelleştirilebilir API Key ve dil tercihleri yönetimi.

---

## 🛠️ Teknoloji Yığını (Tech Stack)

- **Monorepo Mimarisi:** `pnpm workspace`, `tsup`, `TypeScript strict`
- **Sunucu (Backend):** Fastify, Prisma ORM, SQLite (WAL Modu), Google Auth Library, OpenSubtitles API v1, Zod validation, Pino Logger
- **Ön Yüz (Frontend):** React 18, Vite, Tailwind CSS, TanStack React Query, Lucide Icons
- **Konteyner ve Dağıtım:** Docker, Docker Compose, Nginx Reverse Proxy

---

## 📁 Çalışma Alanı Yapısı (Workspace Structure)

```text
CineDrive/
├── apps/
│   ├── server/       # Fastify + TypeScript + Prisma SQLite Backend
│   └── web/          # React + Vite + TypeScript + Tailwind CSS Frontend
├── packages/
│   └── shared/       # Ortak TypeScript tipleri, Zod şemaları, dönüştürücüler
├── docs/
│   └── screenshots/  # Uygulama ekran görüntüleri
├── nginx/            # Range akış destekli Nginx reverse proxy yapılandırması
├── Dockerfile.server # Multi-stage backend Docker imajı
├── Dockerfile.web    # Multi-stage frontend + Nginx Docker imajı
├── docker-compose.yml# Production Docker Compose orkestrasyonu
└── pnpm-workspace.yaml
```

---

## 🚀 Hızlı Başlangıç (Geliştirme Ortamı)

1. **Bağımlılıkları Yükleyin:**
   ```bash
   pnpm install
   ```

2. **Çevre Değişkenlerini Ayarlayın:**
   `.env.example` dosyasını `.env` olarak kopyalayın ve gerekli bilgileri doldurun:
   ```bash
   cp .env.example .env
   ```

3. **Veritabanı Şemasını Senkronize Edin:**
   ```bash
   DATABASE_URL="file:./data/app.db" pnpm --filter "@cinedrive/server" exec prisma db push
   ```

4. **Test, Tip ve Lint Kontrollerini Çalıştırın:**
   ```bash
   pnpm typecheck
   pnpm lint
   pnpm test
   ```

5. **Geliştirme Sunucusunu Başlatın:**
   ```bash
   pnpm dev
   ```
   - Frontend: [http://localhost:5173](http://localhost:5173)
   - Backend: [http://localhost:3000](http://localhost:3000)

---

## 📦 Production Canlıya Alma (Docker Compose & Nginx)

1. **Güvenlik Anahtarları Üretin:**
   ```bash
   openssl rand -hex 32
   ```

2. **Docker İmajlarını Derleyin ve Çalıştırın:**
   ```bash
   docker compose build
   docker compose up -d
   ```

3. **Konteyner Durumlarını İnceleyin:**
   ```bash
   docker compose ps
   docker compose logs -f
   ```

---

## 🛡️ Lisans ve Katkıda Bulunma

Bu proje kişisel kullanım ve geliştirme amacıyla tasarlanmıştır. MIT lisansı altındadır.
