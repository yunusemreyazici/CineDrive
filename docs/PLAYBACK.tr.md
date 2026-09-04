# Oynatma

[Dokümantasyon](../README.tr.md#dokümantasyon) · [English](PLAYBACK.md)

CineDrive her videoyu tarama sırasında analiz edip container, video codec'i, ses codec'i, boyutlar ve süreyi saklar. Oynatıcı daha sonra tarayıcıya özel bir oynatma planı oluşturur.

## Video modları

| Mod      | Davranış                                                                   |
| -------- | -------------------------------------------------------------------------- |
| `direct` | Orijinal dosyayı HTTP Range desteğiyle yayınlar; yeniden kodlama yapılmaz. |
| `audio`  | Videoyu kopyalayıp uyumsuz sesi AAC'ye dönüştürür.                         |
| `hls`    | İstek üzerine HLS üretir; uyumlu track'ler kopyalanabilir.                 |
| `full`   | En yüksek uyumluluk için video ve sesi H.264 ile AAC'ye dönüştürür.        |

Safari ve Chromium aynı dosya için farklı planlar alabilir. Kalite otomatik bırakılabilir veya açıkça seçilebilir. HLS eşzamanlılık ve önbellek boyutu sınırlıdır; kota dolduğunda en uzun süredir kullanılmayan akışlar çıkarılır.

## HLS yaşam döngüsü ve toparlanma

Oynatmadan ayrılma veya seek penceresini değiştirme önceki FFmpeg işini serbest bırakır. Toparlanmanın kalıcı olarak başarısız olması istemci aktarımını durdurur; sunucu tarafındaki boşta oturum temizliği, iş sınırları ve önbellek sınırları terk edilen oturumları sınırlar.

HLS toparlanması uygulama düzeyinde en fazla üç kez, 1, 2 ve 4 saniye aralıklarla yeniden dener; toparlanma başladıktan sonra süre sınırı 30 saniyedir. Oynatılabilir tampon verisi kalmayan takılma 12 saniye sonra algılanır. Toparlanma yerel akış konumunu ve kullanıcının oynat/duraklat tercihini korur. Deneme sayacı 30 saniyelik istikrarlı oynatma, kaynak değişimi veya açık manuel yeniden denemeyle sıfırlanır.

hls.js üzerinden görülen HTTP 401/403 yetkilendirme hataları otomatik denenmez. Tarayıcının native medya hataları her zaman HTTP durumunu göstermez. Toparlanma tükendiğinde bağlantıyı düzeltip **Akışı Tekrar Dene** seçeneğini kullanın. Doğrudan video ve müzik oynatımı ayrı toparlanma yolları kullanır.

## İleri ve geri sarma

Doğrudan akışlar byte range kullanır. Uyumluluk akışları FFmpeg'i istenen mantıksal konumda yeniden başlatabilir. HLS'te mevcut üretilen pencerenin dışına sarma, kullanıcıya mutlak zaman çizgisini göstermeye devam ederken yeni pencere oluşturur; önceki encoder kısa sürede serbest bırakılır.

## Altyazılar

CineDrive şunları destekler:

- OpenSubtitles üzerinden altyazı arama;
- `.srt` veya `.vtt` yükleme;
- desteklenen metin altyazılarını WebVTT'ye dönüştürüp önbellekleme;
- altyazı zamanlamasını ayarlama;
- oynatıcıda metin boyutunu ve arka plan/gölge stilini özelleştirme.

Altyazı ve medya endpoint'leri erişimi giriş yapan kullanıcının kütüphaneleri üzerinden doğrular.

## Oynatıcı kontrolleri

Video oynatıcı; klavye kısayolları, fullscreen ve sinema modları, tarayıcının desteklediği Picture-in-Picture, kalite kontrolleri, kaldığı yerden devam etme, tamamlandı takibi ve otomatik sonraki bölüm geçişini içerir.

## Müzik oynatma

Müzik oynatmanın kendine ait kalıcı sırası ve konumu, karıştırma/tekrar, gapless playback, ayarlanabilir crossfade, ReplayGain ses normalizasyonu ve preset'li beş bantlı equalizer'ı vardır. Yan `.lrc` dosyaları ve LRCLIB sonuçları senkronize veya düz şarkı sözü olarak gösterilebilir.

Kimliği doğrulanmış istemci senkronizasyon API'si; ETag uyumlu kütüphane senkronizasyonunu, indirme manifestlerini, parça indirmeyi, toplu dinleme geçmişini ve mobil/offline istemciler için oynatma durumu senkronizasyonunu destekler.

## Tarayıcı kapsamı

Playwright, Chromium ve WebKit'i çalıştırır. Paket gerçek oynatma ilerlemesini, seek'i, yenileme sonrası devam etmeyi, HLS pencere değişimini, kesilen akıştan toparlanmayı ve FFmpeg temizliğini doğrular. Playwright WebKit yararlı Safari kapsamı sağlar; ancak branded Safari veya fiziksel iOS cihazı testi değildir.
