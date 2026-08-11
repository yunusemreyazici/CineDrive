# CineDrive Music — Mobil iOS Tasarım Sistemi

Bu klasördeki altı pano, müzik bölümünün mobil iOS sürümü için görsel kaynak olarak kullanılır. Tasarım, mevcut masaüstü deneyimini değiştirmeden `lg` altındaki müzik rotalarına uygulanmak üzere hazırlanmıştır.

## Ekran envanteri

| Pano | Ekranlar |
| --- | --- |
| `01-discovery.png` | Müzik ana sayfa, Mixler ve Radyo, Arama |
| `02-library.png` | Sanatçılar, Albümler, Tüm Parçalar |
| `03-details.png` | Sanatçı profili, Albüm detayı, Çalma listesi detayı |
| `04-personal.png` | Beğenilen Parçalar, Dinleme Geçmişi, Replay |
| `05-player.png` | Şimdi Çalıyor, Şarkı Sözleri, Kuyruk, Ses Ayarları |
| `06-utilities.png` | Müzik menüsü, Çalma Listeleri, Parça Bilgileri, Kütüphane Bakımı |

## Navigasyon modeli

- Ana içerik ekranlarında dört sekmeli alt bar kullanılır: **Ana Sayfa**, **Keşfet**, **Kütüphane**, **Ara**.
- Aktif parça varsa sekme çubuğunun hemen üstünde sabit mini player bulunur.
- Mini player'a dokunmak tam ekran **Şimdi Çalıyor** yüzeyini açar.
- Şarkı sözleri, kuyruk ve ses ayarları tam ekran player katmanının alt durumlarıdır; bu durumlarda uygulama sekmeleri görünmez.
- Sol üst profil/menü düğmesi, global CineDrive menüsünden ayrı bir tam yükseklik müzik menüsü açar.
- Detay ekranlarında geri dönüş, iOS safe-area içinde sol üstte yer alır.

## Görsel tokenlar

- Arka plan: `#08090B`
- Yükseltilmiş yüzey: `#111316`
- Materyal yüzey: `rgba(24, 26, 30, 0.86)` + kontrollü backdrop blur
- Birincil metin: `#F7F7F8`
- İkincil metin: `#92959D`
- Ayraç: `rgba(255, 255, 255, 0.08)`
- Ana vurgu: `#28D7E6`
- Artwork rengi: yalnızca hero/player arka plan atmosferinde, düşük opaklıkla
- Yarıçap: küçük `10px`, kontrol `14px`, yüzey `18px`, büyük görsel `20px`
- Sayfa yatay boşluğu: `16px`; büyük ekranlı telefonlarda `20px`
- Minimum dokunma hedefi: `44px`

## Tipografi

- Sistem font yığını: `-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", sans-serif`
- Büyük navigasyon başlığı: `34/41`, `700`
- Ekran başlığı: `28/34`, `700`
- Bölüm başlığı: `20/25`, `700`
- Satır başlığı: `16/21`, `600`
- Gövde: `15/20`, `400`
- Yardımcı bilgi: `13/18`, `400`
- Üst etiket: `11/14`, `600`, kontrollü büyük harf

## Bileşen aileleri

- `MobileMusicShell`: safe-area, içerik scroll'u, mini player ve tab bar yerleşimi
- `MobileMusicHeader`: büyük/kompakt başlık, geri, menü, arama ve ek işlemler
- `MusicMiniPlayer`: artwork, parça/sanatçı, oynat-duraklat ve sonraki
- `MusicTabBar`: dört sabit sekme ve aktif durum
- `MusicTrackRow`: artwork veya sıra, metadata, süre/equalizer ve taşma menüsü
- `MusicArtworkRail`: yatay albüm/mix/diskografi şeridi
- `MusicPrimaryActions`: Oynat, Karışık Çal ve bağlamsal üçüncü işlem
- `MusicFullPlayer`: şimdi çalıyor, sözler, kuyruk ve ayarlar durumları
- `MusicFormGroup`: metadata ve ses ayarları için iOS tarzı açık gruplar

## Davranış kuralları

- İçerik mini player ve tab bar altında kalmamalı; alt padding aktif player durumuna göre hesaplanmalıdır.
- Liste satırları kart içine alınmamalı; açık yüzey ve ince ayraç kullanılmalıdır.
- Sanatçı profilinde **Tüm Şarkılar** bulunur; **Popüler Parçalar** kullanılmaz.
- Albüm detayında **Popüler Parçalar** kullanılmaz.
- Oynat ve Karışık Çal, koleksiyon ve detay ekranlarında ilk görünür alanda kalır.
- Yatay rail'ler bir sonraki öğeyi kısmen göstererek kaydırılabilirliği anlatır.
- Animasyonlar `prefers-reduced-motion` ile kapanmalı; geçişler 180–240 ms aralığında tutulmalıdır.
- Dynamic Type büyüdüğünde başlıklar ve metadata kırpılmamalı; satır yüksekliği içerikle büyüyebilmelidir.

## Route eşlemesi

- `/music` → Ana Sayfa
- `/music/tracks` → Tüm Parçalar / Arama sonucu
- `/music/albums` → Albümler
- `/music/albums/:albumId` → Albüm detayı
- `/music/artists` → Sanatçılar
- `/music/artists/:artistId` → Sanatçı profili
- `/music/liked` → Beğenilen Parçalar
- `/music/history` → Dinleme Geçmişi
- `/music/playlists/:playlistId` → Çalma listesi detayı
- `/music/replay` → Replay
- `/music/maintenance` → Kütüphane Bakımı

