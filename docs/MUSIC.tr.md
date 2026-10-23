# Music Studio ve keşif

[Dokümantasyon](../README.tr.md#dokümantasyon) · [English](MUSIC.md)

## Ortak playlist'ler

Web'de **Müzik → Music Studio** ekranını açın. Liste oluşturup aynı sunucudaki bir hesabı düzenleyici veya dinleyici olarak davet edin. Davetin kabul edilmesi gerekir. Uyumlu CineMusic istemcileri süreli davet bağlantısı da oluşturabilir; liste sahibi bağlantıyı yenileyebilir veya iptal edebilir.

Playlist ve kütüphane izinleri ayrıdır. Her kullanıcının alttaki medya kütüphanesine ayrıca erişimi olmalıdır. Erişilemeyen parçalar gizlenir; eksik içerikli atölyeler, görünmeyen parçaların yanlışlıkla silinmemesi için salt okunurdur. Eski, yalnızca liste sahibine açık yazma endpoint'lerinin izinleri korunur.

Atölyede çoklu seçim, tekrarları seçme, seçili konumları sıralama, kopyalama ve taşıma bulunur. İşlemler sürüm kontrolü kullanır; çakışma sonrası yeni düzenleme göndermeden önce yenileyin. Geçmiş, son 100 Studio içerik revizyonunun aktörünü ve değişen parçalarını gösterir. Geri yükleme açık onay ve güncel düzenleme izni ister. Listeler arası taşıma/kopyalama incelenebilir, ancak tek taraflı geri alınmaz. Listenin tamamen silinmesi geçmişini de siler.

Studio görünürken ve odak/ağ bağlantısı geri geldiğinde hedefli değişiklik akışını kontrol eder. Bu polling'dir; arka plan push bildirimi değildir. Kabul edilmiş ortak listeler normal kütüphane/eşzamanlama yanıtlarına da dahil edilir.

## Yerel öneriler ve kayıt sürümleri

Uyumlu istemciler, listenin tür, sanatçı ve dönem metadata'sına göre en fazla sekiz öneri isteyebilir. Seçim ve çeşitlilik mevcut seeded Discovery motorunda uygulanır. Listedeki parçalar, elenen öneriler ve bilinen alternatif kayıtlar seçimden önce dışlanır. Yeni generation önerileri yeniler; değişmeyen katalog/liste ve generation için seçim tekrarlanabilirdir.

Nedenler doğrulanmış metadata yakınlığını anlatır; ölçülmüş ruh hâli veya ses analizi değildir. Öneriler listeyi otomatik değiştirmez. Boş veya erişilemeyen bir başlangıç listesi öneri üretmeyebilir.

Studio'nun kayıtlar ve oturumlar sekmesinde bir kaydın bilinen sürümlerini ilişkilendirip tercih edilen sürümü seçin. Tercih edilen parça yalnızca uygunsa kullanılır. Kaydedilmiş dinleme noktaları, sıra/tekrar kimliği ve konumu açık işlemle geri yükler; erişilemeyen parçalar sırayı sessizce değiştirmek yerine çakışma oluşturur.

## AI intent ve kesin koşullar

**Mixler ve Radyo** ekranındaki doğal dille liste üretimi isteğe bağlıdır. `MUSIC_AI_*` değişkenlerini sunucuda ayarlayın; anahtarı boş bırakmak normal Keşif ve yerel önerileri kapatmaz.

AI'ya istek metni ve sınırlı tür/yıl/adet özetleri gider; parça adı listeleri, albümler, dinleme geçmişi veya favori parça adları gönderilmez. AI doğrulanan, deklaratif bir plan üretir. Parçaları yerel metadata filtreleri, puanlama ve seeded seçim belirler.

Açık dil, tür, sanatçı ve yıl koşulları, kullanıcı yumuşatmadıkça HARD kalır. Doğrulanmış metadata eksikse sonuç azalabilir; hedefin 50 olması, kesin koşulu bozan parça ekleme izni değildir. Desteklenen ekranlarda küçük sonuçlar için kapsam açıklaması gösterilir. “Gece sürüşü” gibi kavramlar mevcut metadata üzerinden yaklaşık yorumlanır; BPM/enerji ölçümü yapılmaz.

Keşif tercihleri, geri bildirim ve akıllı playlist kuralları uyumlu istemci API'lerinde bulunur. AI gerektirmez.

## Şarkı sözü kapsamı ve arka plan işleri

Söz araması, sunucuda zaten saklanan/indekslenen orijinal sözleri kullanır. Orijinal sözü olmayan parça yalnızca sözle yapılan sorguyla eşleşemez. Yan dosya `.lrc` ve LRCLIB sonuçları önbelleği doldurabilir; çeviri, orijinal söz arama kanıtının yerine geçmez.

Periyodik LRCLIB zenginleştirmesi varsayılan olarak beş dakikada bir, en fazla 25 parçalık sınırlı bir tur çalıştırır. Mevcut eşzamanlılık/istek sınırları, retry backoff ve bulunamayan sonuç beklemeleri kullanılır. LRCLIB'e arama için parça metadata'sı gider; bu, AI playlist planlamasından ayrıdır. Periyodik aramayı kapatmak için `MUSIC_LYRICS_ENRICHMENT_INTERVAL_MINUTES=0` ayarlayın. Mevcut sözler ve arama indeksi kullanılabilir kalır.

Bakım istatistikleri eksik söz/dil kanıtını, kuyruk ilerlemesini ve retry durumlarını gösterir. Yöneticiler global worker durumunu inceleyebilir; manuel pilot 200 parçayla sınırlıdır. Durum ekranını açmak sınırsız bir tüm-katalog araması başlatmaz. Yerel kanıt bulunana kadar dil bilinmiyor kalır; HARD dil filtresi gevşetilmez.

## Güncelleme

1.3.0, ortak playlist/geçmiş, söz/arama ve kişiselleştirme migration'ları ekler. [1.2.0 → 1.3.0 kontrol listesini](RELEASING.tr.md#120dan-130a-geçiş-kontrol-listesi) izleyin, server/web'i birlikte güncelleyin ve önceki veritabanı yedeğini koruyun. Native kontroller uyumlu CineMusic build'i ister. Ayrı bir özellik olan eşzamanlı dinleme için [Birlikte Dinle protokolüne](listen-together.md) bakın.
