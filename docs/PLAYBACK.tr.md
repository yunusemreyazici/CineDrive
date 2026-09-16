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

Uyumlu CineMusic istemcilerinde **CineMusic Connect** her cihaz için ayrı ayrı açılabilir. Cihazın görünmesi ile uzaktan komut kabul etmesi ayrı izinlerdir. Bir cihaz seçildiğinde normal mini oynatıcı, Now Playing ekranı, klavye kısayolları, sözler, kuyruk ve Mac menü çubuğu oynatıcısı; oynat/duraklat, önceki/sonraki, ileri sarma, ses, karıştırma/tekrar ve kuyruktan parça seçimi için o cihazın kumandasına dönüşür. **Kuyruğu Kopyala**, sunucudaki aynı kuyruğu hedefte başlatırken kaynak cihazı durdurmaz. Açıkça başlatılan aktarımda kaynak, hedef oynatmanın hazır olduğunu onayladıktan sonra durur; onay zaman aşımına uğrarsa kaynak çalmayı sürdürür. Yalnızca cihazda bulunan aktarımlar, hedef cihaz bu dosyalara erişemediği için gönderilemez.

Güncel istemciler seçili cihazın kuyruğuna sonraki/sona parça ekleme, kuyruk öğesi kaldırma, sıralama ve sıradakileri temizleme işlemlerini de destekler. Bunun için `client-bootstrap.features.cineMusicQueueControl` desteği ve alıcı cihazda güncel CineMusic gerekir. Kuyruk düzenlemeleri kalıcı kuyruk öğesi kimlikleriyle, onaylanan `editQueue` komutunu kullanır. Eklenen parçaların hesaba ait bilgileri, tekrarlar ayıklanarak komut sorgusu yanıtındaki `queueTracks` alanında taşınır; her parça için ayrı kütüphane isteği yapılmaz. Eksik parça bilgisi varsa alıcı eklemenin tamamını reddeder. Yalnızca sunucuyu güncellemek eski uygulamalara bu kontrolleri eklemez.

Connect cihaz durumu ve komut sorguları ayrı bir istek kotası kullanır; arka plandaki cihaz keşfi normal kütüphane API kotasını tüketmez.

## Tarayıcı kapsamı

Playwright, Chromium ve WebKit'i çalıştırır. Paket gerçek oynatma ilerlemesini, seek'i, yenileme sonrası devam etmeyi, HLS pencere değişimini, kesilen akıştan toparlanmayı ve FFmpeg temizliğini doğrular. Playwright WebKit yararlı Safari kapsamı sağlar; ancak branded Safari veya fiziksel iOS cihazı testi değildir.
