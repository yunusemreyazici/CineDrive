# Yapılandırma

[Dokümantasyon](../README.tr.md#dokümantasyon) · [English](CONFIGURATION.md)

`.env.example` dosyasını `.env` olarak kopyalayıp bütün örnek kimlik bilgilerini ve dağıtım URL'lerini değiştirin. Dağıtım varsayılanları için [`.env.example`](../.env.example), doğrulanan temel ayarlar için [ortam şemasını](../packages/shared/src/schemas/env.schema.ts) kullanın.

## Temel ayarlar

| Değişken                           | Amaç                                                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                     | SQLite adresi. Konteyner ve production'da mutlak yol kullanın.                                                  |
| `NODE_ENV`, `PORT`                 | Çalışma modu ve API dinleme portu (varsayılan `3000`).                                                          |
| `APP_NAME`, `LOG_LEVEL`            | Uygulama adı ve sunucu log ayrıntı düzeyi.                                                                      |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID`      | Yönetici için otomatik oluşturulan Drive kütüphanesinin ilk kök klasörü; sonraki arayüz değişikliklerini ezmez. |
| `SESSION_SECRET`                   | Çerez imzalama anahtarı; en az 32 karakter.                                                                     |
| `TOKEN_ENCRYPTION_KEY`             | Google yenileme belirteçlerini şifreleyen tam 64 onaltılık karakter.                                            |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`    | İlk açılışta oluşturulan yönetici.                                                                              |
| `APP_AUTH_MODE`                    | Yönetici tarafından oluşturulan hesaplar için `multi-user` yapın.                                               |
| `LIBRARY_SCAN_INTERVAL_HOURS`      | Tüm kütüphaneleri bu aralıkla otomatik tarar; `0` kapatır. Kesilen tarama başlangıçta yeniden denenir.             |
| `APP_URL`, `PUBLIC_URL`, `API_URL` | Tarayıcının göreceği uygulama ve API adresleri.                                                                 |
| `CORS_ORIGIN`                      | İzin verilen tarayıcı origin'i; normalde public uygulama origin'i.                                              |
| `TRUST_PROXY`                      | Yalnızca dahil edilen Nginx veya başka bir güvenilir reverse proxy arkasında etkinleştirin.                     |

İki gizli alan için ayrı değerler üretin:

```bash
openssl rand -hex 32
```

`.env`, OAuth sırları, şifreleme anahtarları veya indirilen kimlik bilgisi dosyalarını hiçbir zaman commit etmeyin.

## Google Drive ve metadata

| Değişken                                   | Amaç                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth web istemci bilgileri.                                            |
| `GOOGLE_REDIRECT_URI`                      | OAuth callback'i; Google'da kayıtlı URL ile birebir eşleşmeli.                 |
| `METADATA_LANGUAGE`                        | Gelecek metadata taramalarında saklanacak dil; varsayılan `tr-TR`.             |
| `MUSIC_METADATA_ONLINE`                    | Eksik yerel etiketlerin tutucu MusicBrainz eşleşmeleriyle tamamlanmasını açar. |
| `TMDB_API_KEY`                             | Film ve dizi metadatası için dağıtım genelindeki yedek değer.                  |
| `OPENSUBTITLES_API_KEY`                    | Altyazı arama için dağıtım genelindeki yedek değer.                            |
| `ACOUSTID_API_KEY`                         | Akustik eşleştirme için dağıtım genelindeki yedek değer.                       |

TMDB, OpenSubtitles ve AcoustID anahtarları kullanıcı başına **Ayarlar → API yönetimi** bölümünden de kaydedilebilir. Kullanıcı değeri dağıtım genelindeki yedekten önce gelir. `METADATA_LANGUAGE` arayüz dilinden ayrıdır: değiştirilmesi SQLite'ta saklanan mevcut metadatayı değil, gelecek taramaları etkiler.

OAuth izin ekranı, kapsamlar ve callback yapılandırması için [Google Drive kurulumu](GOOGLE_DRIVE.tr.md) belgesine bakın.

## Oynatma ve isteğe bağlı servisler

| Değişken                                       | Amaç                                            |
| ---------------------------------------------- | ----------------------------------------------- |
| `HLS_MAX_ACTIVE_JOBS`                          | Aynı anda çalışabilecek HLS kodlama işi sayısı. |
| `HLS_CACHE_MAX_BYTES`                          | Diskteki HLS önbellek kotası.                   |
| `TRANSCODE_MAX_ACTIVE_SESSIONS`                | Aynı anda çalışabilecek uyumluluk akışı sayısı. |
| `LIBRETRANSLATE_URL`, `LIBRETRANSLATE_API_KEY` | İsteğe bağlı şarkı sözü çeviri sağlayıcısı.     |
| `FPCALC_PATH`                                  | İsteğe bağlı Chromaprint executable yolu.       |

Oynatma sınırları host'u sınırsız FFmpeg işinden korur. Bu değerleri yalnızca kullanılabilir CPU, bellek ve disk kapasitesini gözlemledikten sonra artırın. Mod ve toparlanma modeli için [Oynatma](PLAYBACK.tr.md) belgesine bakın.

## İsteğe bağlı AI çalma listesi planlama

Doğal dille çalma listesi planlama yalnızca `MUSIC_AI_API_KEY` tanımlandığında etkinleşir. Çağrı yalnız sunucudan yapılır ve normal Music Discovery V2 endpoint'lerini etkilemez.

| Değişken              | Amaç                                                                           |
| --------------------- | ------------------------------------------------------------------------------ |
| `MUSIC_AI_PROVIDER`   | Provider adapter'ı; varsayılan `groq`.                                         |
| `MUSIC_AI_API_KEY`    | Yalnız sunucuda tutulan provider anahtarı. Boş bırakıldığında özellik kapanır. |
| `MUSIC_AI_MODEL`      | OpenAI-compatible model kimliği; varsayılan `qwen/qwen3.8-27b`.                |
| `MUSIC_AI_BASE_URL`   | OpenAI-compatible API kökü; varsayılan `https://api.groq.com/openai/v1`.       |
| `MUSIC_AI_TIMEOUT_MS` | 8000–12000 ms aralığında doğrulanan provider zaman aşımı.                      |

Provider'a yalnız dinleyici prompt'u ile sınırlı canonical tür listesi, tür sayıları, toplam parça sayısı, yıl aralığı ve on yıllık dağılım gönderilir. Parça adları, albümler, katalog sanatçıları, favoriler, dinleme geçmişi, dosya yolları ve gizli bilgiler gönderilmez. Model yalnız deklaratif intent üretir; filtreleme, puanlama, seeded seçim ve track hydration CineDrive içinde yerel olarak yapılır.

Dil constraint'leri tamamen yerelde, parça üzerinde kalıcı olarak saklanan evidence üzerinden değerlendirilir. Mevcut lyrics language metadata'sı önceliklidir; bu yoksa cache'teki lyrics metni `franc-min` ile yerelde tespit edilir, son deterministik fallback olarak `turkish rock` veya `anatolian rock` gibi açık dil taşıyan türler kullanılır. Generic tür, sanatçı adı ve başlık karakterleri dil kanıtı değildir. Hard dil constraint'i yalnız manual, lyrics metadata, yüksek güvenli lyrics detection veya açık genre evidence kabul eder; unknown parçalar elenir ve hedef sayıyı doldurmak için dil constraint'i gevşetilmez.

Mevcut katalog için authenticated `POST /api/music/maintenance/languages/enrich` endpoint'i idempotent background işi başlatır. İş önce SQLite'ta cache'lenmiş lyrics'i 200 parçalık local batch'lerle işler; dili hâlâ bilinmeyen ve lyrics'i eksik parçaları ardından mevcut LRCLIB lookup/cache katmanına 25 parçalık batch ve en fazla iki worker ile verir. Provider katmanı istekleri global olarak rate-limit eder; 429/5xx/network hatalarında sınırlı retry uygular. Kalıcı queue durumu, 15 dakikalık processing lease'i, artan error backoff'u ve `not_found` kayıtları için yedi günlük tekrar süresi aynı parçaların her çalıştırmada yeniden istenmesini önler. Yeni library scan yalnızca hızlı local/cache aşamasını tetikler; provider fetch kullanıcı maintenance işinde arka planda çalışır.

Pilot çalışma için POST body'de isteğe bağlı `maxTracks` verilebilir: `{ "maxTracks": 200 }`. Bu limit yalnız external provider lookup sayısını sınırlar; mevcut cached lyrics önce ve limit tüketmeden işlenir. Sınırlı pilot, DB'nin ilk kayıtlarını almak yerine uygun kuyruğun tamamından eşit aralıklı ve deterministic örnekler seçer. Alan verilmezse mevcut sıra ve batch/concurrency kontrollü tam background davranışı korunur. Değer 1–5000 arasında olmalıdır.

`GET /api/music/maintenance/languages/stats`, bilinen/bilinmeyen sayılarına ek olarak `lyricsAvailable`, `lyricsMissing`, `pendingEnrichment`, `queued`, `processing`, `completed`, `notFound`, `retryWaiting`, `failed`, `lyricsDetected`, `languagesResolvedThisRun`, `providerLookups`, `providerHttp429`, `providerHttp5xx`, `lastJobStartedAt` ve `lastJobCompletedAt` alanlarını döndürür. Provider sayaçları process içindeki son tamamlanan job'a aittir. Provider'a lookup için yalnız parça adı, sanatçı, albüm ve süre gönderilir. Bulunan lyrics SQLite'a cache'lenir ve dil tespiti `franc-min` ile sunucuda yapılır; lyrics içeriği AI provider'a gönderilmez.

Yıl filtresi şu anda saklanan track yılını, yoksa albüm edition yılını kullanır. CineDrive henüz MusicBrainz'den doğrulanmış özgün kayıt/yayın yılını ayrı bir alanda saklamadığı için 1998 remaster gibi bir yeniden basım 1990'lar constraint'ine girebilir. Başlıktan yıl tahmini yapılmaz. Özgün yayın yılı enrichment'ı ileride metadata maintenance aşamasında ele alınmalıdır.

## Çok kullanıcılı mod

`ADMIN_EMAIL` ve `ADMIN_PASSWORD` ile oluşturulan yönetici iki kimlik doğrulama modunda da bulunur. Yönetici tarafından oluşturulan hesapları etkinleştirmek için:

```dotenv
APP_AUTH_MODE=multi-user
```

CineDrive'ı yeniden başlatın; ardından **Ayarlar → Hesap** bölümünden kullanıcı oluşturup kütüphanelere listener veya editor erişimi verin. Kütüphaneler, favoriler, geçmiş, çalma listeleri, oynatma durumu, API anahtarları ve Google bağlantıları kullanıcıya özeldir. Oynatma durumu ayrıca istemci bazında ayrıldığı için tarayıcı sekmeleri ve mobil istemciler birbirinin durumunu ezmez.
