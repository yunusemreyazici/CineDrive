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

## Çok kullanıcılı mod

`ADMIN_EMAIL` ve `ADMIN_PASSWORD` ile oluşturulan yönetici iki kimlik doğrulama modunda da bulunur. Yönetici tarafından oluşturulan hesapları etkinleştirmek için:

```dotenv
APP_AUTH_MODE=multi-user
```

CineDrive'ı yeniden başlatın; ardından **Ayarlar → Hesap** bölümünden kullanıcı oluşturup kütüphanelere listener veya editor erişimi verin. Kütüphaneler, favoriler, geçmiş, çalma listeleri, oynatma durumu, API anahtarları ve Google bağlantıları kullanıcıya özeldir. Oynatma durumu ayrıca istemci bazında ayrıldığı için tarayıcı sekmeleri ve mobil istemciler birbirinin durumunu ezmez.
