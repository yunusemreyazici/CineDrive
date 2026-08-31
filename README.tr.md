<div align="center">
  <img src="docs/assets/cinedrive-mark.svg" alt="CineDrive logosu" width="156" height="156" />

  <h1>CineDrive</h1>

  <p><strong>Kendi depolamanızdan güç alan kişisel sinema ve müzik kütüphaneniz.</strong></p>

  <p>
    Google Drive veya yerel klasörlerdeki film, dizi ve müzikler için kendi sunucunuzda yayın.<br />
    Mümkün olduğunda doğrudan oynatma, gerektiğinde isteğe bağlı HLS dönüşümü.
  </p>

  <p><strong>Türkçe</strong> · <a href="README.md">English</a></p>

  <p>
    <a href="https://github.com/yunusemreyazici/CineDrive/actions/workflows/ci.yml"><img src="https://github.com/yunusemreyazici/CineDrive/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI durumu" /></a>
    <a href="https://github.com/yunusemreyazici/CineDrive/actions/workflows/codeql.yml"><img src="https://github.com/yunusemreyazici/CineDrive/actions/workflows/codeql.yml/badge.svg?branch=main" alt="CodeQL durumu" /></a>
    <a href="https://github.com/yunusemreyazici/CineDrive/actions/workflows/container-security.yml"><img src="https://github.com/yunusemreyazici/CineDrive/actions/workflows/container-security.yml/badge.svg?branch=main" alt="Container güvenliği durumu" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/lisans-MIT-06B6D4" alt="MIT Lisansı" /></a>
    <img src="https://img.shields.io/badge/Node.js-22.13%20%7C%2024-339933?logo=nodedotjs&logoColor=white" alt="Node.js 22.13 veya 24" />
    <img src="https://img.shields.io/badge/dağıtım-Docker%20Compose-2496ED?logo=docker&logoColor=white" alt="Docker Compose dağıtımı" />
  </p>

  <p>⭐ CineDrive işinize yarıyorsa projeye yıldız vermeyi düşünebilirsiniz.</p>
</div>

---

<p align="center">
  <a href="#öne-çıkanlar">Öne çıkanlar</a> ·
  <a href="#hızlı-başlangıç">Hızlı başlangıç</a> ·
  <a href="#yapılandırma">Yapılandırma</a> ·
  <a href="#dağıtım">Dağıtım</a> ·
  <a href="#veritabanı-yedekleri">Yedekler</a> ·
  <a href="#katkı-ve-güvenlik">Katkı</a>
</p>

> [!IMPORTANT]
> CineDrive aktif olarak geliştirilmektedir. Production kurulumunu güncellemeden önce yükseltme notlarını ve yapılandırma değişikliklerini inceleyin; doğrulanmış veritabanı yedekleri tutun.

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

### Kurulum yolunu seçin

| Amaç                                  | Buradan başlayın                      | En uygun kullanım                              |
| ------------------------------------- | ------------------------------------- | ---------------------------------------------- |
| CineDrive üzerinde geliştirme yapmak  | [Yerel geliştirme](#yerel-geliştirme) | Katkıda bulunanlar ve özellik geliştirme       |
| Mevcut Docker sunucusunda çalıştırmak | [Docker Compose](#docker-compose)     | İzole servislerle tekrarlanabilir self-hosting |
| Debian/Ubuntu sunucusu hazırlamak     | [VPS kurucusu](#debianubuntu-vps)     | systemd, Nginx ve TLS kullanan özel bir sunucu |

Tüm yollar production kalitesinde gizli anahtarlar gerektirir. Google Drive ayrıca bir OAuth istemcisi ister; yalnızca yerel klasör kullanan kurulumlar Drive'a bağlanmaz, ancak mevcut ortam şeması sözdizimsel olarak geçerli placeholder OAuth değerleri bekler.

### Gereksinimler

- Node.js 22 serisinde 22.13+ veya Node.js 24
- pnpm 11 (depo bir pnpm workspace'idir)
- Gizli anahtar üretmek için OpenSSL
- Google Drive kullanacaksanız Drive API etkin bir Google Cloud OAuth istemcisi
- Normal Node/Docker kullanımı için ayrıca FFmpeg kurulumu gerekmez; `ffmpeg-static` dahildir
- Akustik parmak izi için isteğe bağlı `fpcalc`/Chromaprint

### Google Drive API kurulumu

CineDrive sunucu taraflı OAuth 2.0 akışı kullanır. Mevcut dosyaları bulup yayınlayabilmek için Google hesabınızın e-posta bilgisini ve salt okunur `drive.readonly` kapsamını ister; Drive içeriğini değiştirme izni istemez.

1. [Google Cloud Console'u](https://console.cloud.google.com/) açın, bir proje oluşturun veya mevcut projeyi seçin. Sonraki adımlarda aynı projenin seçili kaldığından emin olun.

2. Google Drive API'yi etkinleştirin:

   - **APIs & Services → Library** bölümünü açın.
   - **Google Drive API** araması yapın.
   - API'yi açıp **Enable** seçeneğine basın.

   Google'ın doğrudan [Drive API etkinleştirme sayfasını](https://console.cloud.google.com/apis/library/drive.googleapis.com) da kullanabilirsiniz.

3. **Google Auth Platform** altında izin ekranını yapılandırın:

   - **Branding:** uygulama adını `CineDrive` yapın; destek e-postası ve geliştirici iletişim e-postası ekleyin.
   - **Audience:** kişisel Google hesapları için **External** seçin. Google Workspace kuruluşuna ait projelerde yalnızca kuruluş üyeleri bağlanacaksa **Internal** kullanılabilir.
   - **Data Access:** aşağıdaki kapsamları birebir ekleyin:

     ```text
     https://www.googleapis.com/auth/drive.readonly
     https://www.googleapis.com/auth/userinfo.email
     ```

   `drive.readonly`, mevcut Drive dosyalarını okuyup indirebildiği için Google tarafından kısıtlanmış kapsam olarak sınıflandırılır. CineDrive kapsamı salt okunur kullanır ve yenileme belirtecini saklamadan önce şifreler.

4. Uygulama **Testing** durumundayken CineDrive'a bağlanacak bütün Google hesaplarını **Audience → Test users** bölümüne ekleyin.

   > Testing modunda Google, çevrimdışı yenileme belirteci dahil yetkilendirmeyi yedi gün sonra sona erdirir. Uzun süre çalışacak kişisel kurulumda test bittikten sonra yayın durumunu **In production** yapın. Google, 100 kullanıcıdan az kişisel uygulamaların doğrulama olmadan kullanılmasına izin verir; ancak izin sırasında “unverified app” uyarısı gösterilir. `drive.readonly` kullanan herkese açık veya daha büyük dağıtımlar Google'ın kısıtlanmış kapsam doğrulaması ve güvenlik incelemesini gerektirebilir.

5. **Google Auth Platform → Clients** altında OAuth istemcisini oluşturun:

   - **Create Client** seçeneğine basın.
   - Uygulama türü olarak **Web application** seçin.
   - CineDrive kurulumunuzla eşleşen callback adresini **Authorized redirect URIs** alanına ekleyin:

     ```text
     # Yerel geliştirme
     http://localhost:3000/api/auth/google/callback

     # Production
     https://cinedrive.example.com/api/auth/google/callback
     ```

   Production alan adını kendi adresinizle değiştirin. OAuth kod değişimi CineDrive sunucusunda yapıldığı için **Authorized JavaScript origins gerekli değildir**.

6. Oluşturulan değerleri `.env` dosyasına kopyalayın:

   ```dotenv
   GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-client-secret
   GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
   ```

   `GOOGLE_REDIRECT_URI`; protokol, alan adı, port, yol ve sonda eğik çizgi bulunup bulunmaması dahil olmak üzere yetkili yönlendirme adreslerinden biriyle birebir eşleşmelidir. Sunucuya dağıtımda HTTPS production callback adresini kullanın.

7. CineDrive'ı yeniden başlatın, CineDrive yönetici hesabıyla giriş yapın ve **Ayarlar → Google Drive → Google Drive’ı Bağla** bölümünü açın. Google bağlantı bilgileri Ayarlar'dan yönetilir; CineDrive giriş hesabıyla aynı şey değildir.

`.env`, OAuth istemci sırrı veya Google'dan indirilen kimlik bilgisi dosyalarını hiçbir zaman commit etmeyin. Ayrıntılar için Google'ın resmi [Workspace API etkinleştirme](https://developers.google.com/workspace/guides/enable-apis), [web sunucusu OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Drive kapsamları](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) ve [OAuth kitle/yayın durumu](https://support.google.com/cloud/answer/15549945) belgelerine bakın.

### Yerel geliştirme

1. Depoyu klonlayıp kilitlenmiş bağımlılıkları kurun:

   ```bash
   git clone https://github.com/yunusemreyazici/CineDrive.git
   cd CineDrive
   pnpm install --frozen-lockfile
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
   - Canlılık kontrolü: `http://localhost:3000/api/health`
   - Veritabanı hazırlık kontrolü: `http://localhost:3000/api/ready`

`ADMIN_EMAIL` ve `ADMIN_PASSWORD` ile tanımlanan yönetici ilk açılışta oluşturulur. Giriş yaptıktan sonra Ayarlar'dan Drive hesaplarını bağlayıp kütüphane oluşturabilirsiniz.

Birden fazla hesap için `APP_AUTH_MODE=multi-user` ayarlayıp sunucuyu yeniden başlatın; ardından Ayarlar → Hesap bölümünden kullanıcı oluşturup kütüphanelere listener veya editor erişimi verin. Oynatma durumu kullanıcı ve oynatıcı istemcisi bazında izole edildiği için web sekmeleri ile iOS cihazları birbirinin durumunu ezmez.

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
| `APP_AUTH_MODE`                                | Yönetici tarafından oluşturulan hesap girişleri için `multi-user` kullanılır.  |
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

Ortam dosyasını oluşturun, tüm örnek kimlik bilgilerini ve URL'leri değiştirin; iki gizli alan için de benzersiz değer üretin:

```bash
cp .env.example .env
openssl rand -hex 32 # SESSION_SECRET
openssl rand -hex 32 # TOKEN_ENCRYPTION_KEY
```

Üretilen değerleri `.env` dosyasına yapıştırın, yönetici ve isteğe bağlı Google OAuth bilgilerini ayarlayın; ardından stack'i başlatın:

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f
```

Nginx web uygulamasını sunar ve `/api` isteklerini 80 numaralı porttan sunucuya aktarır. Sunucu konteyneri başlamadan önce sürümlenmiş Prisma migration'larını uygular. Uygulama verisi, altyazı önbelleği ve Nginx logları adlandırılmış volume'larda tutulur.

Etiketli sürümler GHCR'a `linux/amd64` ve `linux/arm64` image'ları da yayınlar. Tekrarlanabilir dağıtım için release Compose override'ını GitHub Release'e eklenen immutable digest referanslarıyla kullanın:

```bash
cp release.env.example release.env
docker compose --env-file release.env \
  -f docker-compose.yml -f docker-compose.release.yml pull
docker compose --env-file release.env \
  -f docker-compose.yml -f docker-compose.release.yml up -d --no-build
```

Image doğrulama, güncelleme ve geri dönüş adımları için [CineDrive Sürümleme](docs/RELEASING.tr.md) belgesine bakın.

### Debian/Ubuntu VPS

Yeni bir VPS için etkileşimli kurucu; özel sistem kullanıcısını, Node.js'i, pnpm'i, FFmpeg'i, systemd'yi, Nginx'i, veritabanını ve TLS'i ayarlar:

```bash
sudo bash scripts/install-vps.sh
```

Kurucu Cloudflare Origin Certificate, Certbot/Let's Encrypt veya yalnızca HTTP modlarını destekler. Mevcut bir sunucuda çalıştırmadan önce betiği inceleyin; systemd ve Nginx yapılandırmasına yazar.

### Production kontrol listesi

- CineDrive'ı HTTPS üzerinden sunun; internete API container'ını değil Nginx giriş noktasını açın.
- Tüm örnek parola ve OAuth gizlilerini, `SESSION_SECRET` ile `TOKEN_ENCRYPTION_KEY` değerlerini değiştirin; geliştirme kimlik bilgilerini yeniden kullanmayın.
- `APP_URL`, `PUBLIC_URL`, `CORS_ORIGIN` ve Google'da kayıtlı callback adresini aynı public origin ile birebir eşleştirin.
- `TRUST_PROXY=true` değerini yalnızca dahil edilen Nginx veya başka bir güvenilir reverse proxy arkasında kullanın.
- Docker'da `docker compose ps` çıktısında server'ın healthy olduğunu; VPS'de `systemctl status cinedrive` durumunu doğrulayın. Container ve VPS başlangıç kontrolleri, SQLite yanıt verene kadar `503` döndüren `/api/ready` yolunu kullanır; `/api/health` yalnızca process canlılığını bildirir.
- Doğrulanmış veritabanı snapshot'larını yedek planı kapsamında uygulama host'u veya Docker volume'u dışında da saklayın.

### Güncelleme

Güncellemeden önce doğrulanmış bir veritabanı snapshot'ı oluşturup uygulama host'u veya Docker volume'u dışına kopyalayın ve kullanımda olan commit ya da image tag'ini kaydedin. Ardından servisi yeniden başlatmadan önce kilitli bağımlılıkları kurun, Prisma Client'ı üretin, migration'ları uygulayın ve projeyi derleyin:

```bash
pnpm install --frozen-lockfile
pnpm prisma:generate
pnpm --filter @cinedrive/server prisma:deploy
pnpm build
```

Migration'lar sürümlüdür ve `prisma migrate deploy` ile uygulanır. Production veritabanında `prisma db push` kullanmayın. Başlangıçtan sonra güncellemeyi tamamlanmış saymadan önce `/api/ready` yolunun `200` döndürdüğünü, giriş yapılabildiğini ve mevcut bir kütüphanenin açıldığını doğrulayın.

Migration veya başlangıç başarısız olursa CineDrive'ı durdurun; inceleme için başarısız veritabanını ve logları koruyun. Uygulamayı kaydettiğiniz sürüme geri alın ve aşağıdaki prosedürle güncelleme öncesi snapshot'ı geri yükleyin; eski bir binary'yi yeni migration'ların değiştirdiği veritabanıyla başlatmayın. Migration regression takımı dolu tarihsel video ve müzik veritabanlarını yükseltir, SQLite bütünlüğünü ve foreign key'leri denetler, şema drift'ini bulur ve idempotent olmayan başlangıç davranışını yakalamak için deploy'u tekrarlar.

### Veritabanı yedekleri

CineDrive çalışırken tutarlı bir SQLite snapshot'ı oluşturabilirsiniz. Her snapshot SQLite `integrity_check` ile doğrulanır; varsayılan olarak en yeni 14 yedek saklanır:

```bash
pnpm db:backup
pnpm db:backup -- --output-dir /secure/cinedrive-backups --retain 30
```

VPS kurucusu, bu doğrulamalı yedeği her gün çalıştıran `cinedrive-backup.timer` birimini etkinleştirir ve `/var/lib/cinedrive/backups` altında 14 snapshot tutar. Docker yedekleri uygulama veri volume'u içinde kalır:

```bash
docker compose exec server node apps/server/dist/cli/database-backup.js --retain 14
```

Docker volume, container'ın değiştirilmesine karşı korur; host veya disk kaybına karşı korumaz. Doğrulanmış snapshot'ları volume dışındaki bir depolamaya kopyalayın:

```bash
docker compose cp server:/app/data/backups ./cinedrive-backups
```

`--apply` verilmedikçe geri yükleme yalnızca dry-run yapar: seçilen dosyayı doğrular ve hedefi gösterir. Gerçek geri yüklemeden önce CineDrive'ı durdurun. Araç atomik değiştirme öncesinde ek bir güvenlik yedeği alır ve eski SQLite WAL yan dosyalarını temizler.

```bash
pnpm db:restore -- --from /secure/cinedrive-backups/cinedrive-YYYYMMDDTHHMMSSZ.db
# Sunucuyu durdurduktan sonra:
pnpm db:restore -- --from /secure/cinedrive-backups/cinedrive-YYYYMMDDTHHMMSSZ.db --apply
```

## Geliştirme komutları

```bash
pnpm typecheck      # Tüm workspace paketlerinde TypeScript kontrolü
pnpm lint           # ESLint, React hooks, JSX erişilebilirlik, React Refresh
pnpm test           # shared, web ve server Vitest takımları
pnpm test:e2e       # Playwright smoke senaryoları
pnpm build          # shared, server ve web production derlemeleri
pnpm db:backup      # Saklama politikası uygulanan doğrulamalı SQLite snapshot'ı
pnpm db:restore     # Yedeği doğrular; geri yüklemek için --apply gerekir
pnpm release:check  # Birlikte ilerleyen SemVer ve changelog metadatasını doğrular
pnpm format         # TypeScript, JSON ve Markdown dosyalarını Prettier ile biçimlendirir
```

CI; desteklenen en düşük Node 22.13 sürümünde ve Node 24 hattında typecheck, test ve production derlemelerini çalıştırır. Ayrıca production Docker Compose stack'ini başlatıp API'yi Nginx üzerinden kontrol eder; Playwright ana doğrulama başarılı olduktan sonra koşar. Ayrı bir least-privilege workflow iki production image'ını düzeltmesi bulunan high/critical açıklar için tarar ve CycloneDX SBOM'larını build artifact'i olarak saklar. Release pull request'leri iki hedef mimariyi dry-run ile derler; `v*` etiketleri provenance attestation'lı, keyless imzalı GHCR image'larıyla birlikte SBOM ve immutable digest manifestleri yayınlar. Dependabot, digest ile sabitlenen base image'ları ve SHA ile sabitlenen action'ları güncel tutar.

## Sorun giderme

- **Yerel giriş yönlendiriliyor veya çerez kaydedilmiyor:** `NODE_ENV=development`, yukarıdaki localhost adresleri ve `TRUST_PROXY=false` ayarlarını doğrulayın.
- **Google OAuth callback'i reddediyor:** `GOOGLE_REDIRECT_URI`, `.env` ile Google Cloud OAuth istemcisinde birebir aynı olmalı.
- **Tarama bazı dosyaları bulmadan tamamlanıyor:** Ayarlar'daki kütüphane kaynağı ve tarama geçmişini inceleyin. Başarısız öğelerin hataları saklanır ve yeniden analiz edilebilir.
- **İçerik Chromium'da oynuyor ama Safari'de oynamıyor:** genellikle kapsayıcı veya ses codec'i farkıdır. Ayarlar → Depolama ve medya sağlığı, her tarayıcı için oynatma planını gösterir.
- **Oynatma başlamadan bekliyor:** aktif FFmpeg işlerini ve kuyruğu inceleyin. `HLS_MAX_ACTIVE_JOBS` değerini yalnızca sunucuda yeterli CPU ve bellek varsa artırın.
- **Müzik metadatası eksik:** önce gömülü etiketleri kontrol edin, ardından Müzik kütüphanesi bakımı önerilerini çalıştırın. MusicBrainz tamamlama, güvenilir yerel etiketlerin üzerine otomatik yazmaz.
- **Şarkı sözü çevirisi kullanılamıyor:** `LIBRETRANSLATE_URL` ayarlayın; şarkı sözü aramasının kendisi LibreTranslate gerektirmez.

## Katkı ve güvenlik

- Sürüm hazırlamadan önce [değişiklik günlüğünü](CHANGELOG.md) ve [sürüm politikasını](docs/RELEASING.tr.md) inceleyin.
- Tekrarlanabilir bug'lar ve odaklı özellik istekleri için [issue şablonlarını](https://github.com/yunusemreyazici/CineDrive/issues/new/choose) kullanın.
- Kod göndermeden önce gerekli kontrolleri ve repo kurallarını içeren [CONTRIBUTING.md](CONTRIBUTING.md) dosyasını okuyun.
- Güvenlik açıklarını public issue olarak bildirmeyin. GitHub private vulnerability reporting kanalını kullanmak için [SECURITY.md](SECURITY.md) yönergelerini izleyin.

## Lisans

CineDrive, [MIT Lisansı](LICENSE) altında sunulur.
