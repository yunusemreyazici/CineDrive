# Production Operasyonu

[Dokümantasyon](../README.tr.md#dokümantasyon) · [English](OPERATIONS.md)

Bu rehber kurulum sonrasındaki güvenlik önlemlerini kapsar. Önce [Kurulum](INSTALLATION.tr.md) belgesini okuyun; dağıtılan tam sürümle doğrulanmış ve host dışında saklanan yedekleri operasyon kayıtlarında tutun.

## Production kontrol listesi

- CineDrive'ı HTTPS üzerinden sunun; internete API container'ını değil Nginx giriş noktasını açın.
- Bütün örnek parola ve OAuth sırlarını, `SESSION_SECRET` ile `TOKEN_ENCRYPTION_KEY` değerlerini değiştirin; geliştirme kimlik bilgilerini yeniden kullanmayın.
- `APP_URL`, `PUBLIC_URL`, `CORS_ORIGIN` ve Google'da kayıtlı callback'i aynı public origin ile eşleştirin.
- `TRUST_PROXY=true` değerini yalnızca dahil edilen Nginx veya başka bir güvenilir reverse proxy arkasında kullanın.
- Docker'da `docker compose ps` çıktısında server'ın healthy olduğunu, VPS'de `systemctl status cinedrive` durumunu doğrulayın.
- Doğrulanmış veritabanı snapshot'larını uygulama host'u veya Docker volume'u dışında saklayın.
- Her güncellemeden önce kullanılan commit'i, release tag'ini ve immutable image digest'lerini kaydedin.

Başlangıç kontrolleri, SQLite yanıt verene kadar `503` döndüren `/api/ready` yolunu kullanır. `/api/health` yalnızca process canlılığını bildirir. Çalışan bir process, veritabanının hazır olduğunu tek başına kanıtlamaz.

## Loglar ve runtime sağlığı

Docker logları:

```bash
docker compose ps
docker compose logs -f
```

VPS servis durumu:

```bash
systemctl status cinedrive
journalctl -u cinedrive -f
```

Yönetim arayüzü depolama, sistem kaynakları, codec, FFmpeg işi, tarama ve veritabanı bakım görünümlerini içerir. Oynatma eşzamanlılığı bilinçli olarak sınırlıdır; `HLS_MAX_ACTIVE_JOBS` veya `TRANSCODE_MAX_ACTIVE_SESSIONS` değerlerini yalnızca host'ta yeterli CPU, bellek ve disk kapasitesi varsa artırın.

### Sistem kaynağı izleme

Yöneticiler **Ayarlar → Depolama ve Sağlık** altında anlık CPU, bellek, dosya sistemi, disk I/O ve ağ hızlarıyla yedi günlük bant genişliği geçmişini görebilir. CineDrive dakikada bir örnek kaydeder, grafiğe beş dakikalık dilimler döndürür ve yedi günden eski örnekleri otomatik siler. Örnekler SQLite'ta tutulduğu için uygulama yeniden başladığında korunur ve normal veritabanı yedeklerine dahil edilir.

Metrikler bilinçli olarak yalnızca process'in zaten görebildiği bilgileri kullanır. CineDrive ayrıcalıklı container, Docker socket'i veya geniş host mount'ları istemez:

- Container kurulumu kendi namespace'inde görülebilen kaynakları, runtime sunduğunda cgroup CPU, bellek ve I/O sınırlarını kullanarak gösterip kapsamı container kullanımı olarak etiketler.
- Doğrudan VPS/kaynak kurulumu host genelindeki değerleri gösterir. Ağ trafiği Docker bridge'lerini iki kez saymamak için varsayılan rota arayüzünü izler.
- Dosya sistemi kullanımı CineDrive veritabanını barındıran dosya sistemine aittir.
- Sıcaklık best-effort'tur. Çoğu sanal sunucu donanım sensörü sunmadığından **Desteklenmiyor** görülmesi normaldir.
- Başlangıçtan sonraki ilk CPU ve saniyelik hız değerleri iki örneğe ihtiyaç duyar; panel bu kısa sürede **Ölçülüyor…** gösterir.

## Güncelleme

Güncellemeden önce:

1. Veritabanı snapshot'ı oluşturup doğrulayın.
2. Snapshot'ı uygulama host'u veya Docker volume'u dışına kopyalayın.
3. Geçerli commit, release tag'i ve image digest'lerini kaydedin.
4. Release notlarıyla yapılandırma değişikliklerini okuyun.

Kaynak kurulumunda servisi yeniden başlatmadan önce kilitli bağımlılıkları kurun, Prisma Client'ı üretin, sürümlenmiş migration'ları uygulayın ve projeyi derleyin:

```bash
pnpm install --frozen-lockfile
pnpm prisma:generate
pnpm --filter @cinedrive/server prisma:deploy
pnpm build
```

Production migration'ları `prisma migrate deploy` kullanır. Production veritabanında `prisma db push` kullanmayın. Başlangıçtan sonra güncellemeyi tamamlanmış saymadan önce `/api/ready` yolunun `200` döndürdüğünü, giriş yapılabildiğini ve mevcut bir kütüphanenin açıldığını doğrulayın.

VPS kaynak kurulumlarında `sudo bash scripts/install-vps.sh` komutunu yeniden çalıştırmak bu adımları ek dal, çalışma ağacı, snapshot ve hazırlık korumalarıyla uygular. Başarısız bir çalıştırmanın gösterdiği kurtarma bilgisini saklayın; iki commit'i ve migration öncesi tam snapshot yolunu belirtir.

Etiketli sürümler provenance attestation'lı ve keyless imzalı `linux/amd64` ile `linux/arm64` GHCR image'larının yanında SBOM ve immutable digest manifestleri yayınlar. Artifact doğrulama ve `docker-compose.release.yml` kullanımı için [CineDrive Sürümleme](RELEASING.tr.md) belgesini izleyin.

## Geri dönüş

Migration veya başlangıç başarısız olursa CineDrive'ı durdurun; inceleme için başarısız veritabanını ve logları koruyun. Uygulamayı kaydedilen sürüme geri alıp güncelleme öncesi snapshot'ı yükleyin. Eski bir binary'yi yeni migration'ların değiştirdiği veritabanıyla hiçbir zaman başlatmayın.

Migration regression paketi dolu tarihsel video ve müzik veritabanlarını yükseltir, SQLite bütünlüğünü ve foreign key'leri denetler, şema drift'ini bulur ve idempotent olmayan başlangıç davranışını yakalamak için deploy'u tekrarlar. Bu riskleri azaltır ancak geri yüklenebilir production yedeğinin yerini tutmaz.

## Yedekler

CineDrive çalışırken tutarlı bir SQLite snapshot'ı oluşturabilirsiniz. Her snapshot SQLite `integrity_check` ile doğrulanır; varsayılan olarak en yeni 14 yedek saklanır:

```bash
pnpm db:backup
pnpm db:backup -- --output-dir /secure/cinedrive-backups --retain 30
```

VPS kurucusu her gün çalışan ve `/var/lib/cinedrive/backups` altında 14 snapshot tutan `cinedrive-backup.timer` birimini etkinleştirir.

Docker yedekleri uygulama veri volume'u içinde kalır:

```bash
docker compose exec server node apps/server/dist/cli/database-backup.js --retain 14
docker compose cp server:/app/data/backups ./cinedrive-backups
```

Docker volume, container'ın değiştirilmesine karşı korur; host veya disk kaybına karşı korumaz. Önemli snapshot'ları bağımsız depolamaya kopyalayın ve geri yüklemeyi düzenli olarak sınayın.

`--apply` verilmedikçe geri yükleme dry-run yapar. Dry-run seçilen dosyayı doğrulayıp hedefi gösterir. Gerçek geri yüklemeden önce CineDrive'ı durdurun. Araç atomik değiştirmeden önce ek güvenlik yedeği oluşturur ve eski SQLite WAL yan dosyalarını temizler.

```bash
pnpm db:restore -- --from /secure/cinedrive-backups/cinedrive-YYYYMMDDTHHMMSSZ.db
# Sunucuyu durdurduktan sonra:
pnpm db:restore -- --from /secure/cinedrive-backups/cinedrive-YYYYMMDDTHHMMSSZ.db --apply
```

## Güvenlik bakımı

- Docker base image'larını, GitHub Actions'ı ve paket bağımlılıklarını incelenmiş Dependabot PR'larıyla güncel tutun.
- `.env`, SQLite dosyaları, önbellekler, yedek dizinleri veya server container'ını doğrudan açmayın.
- Merge veya dağıtımdan önce CodeQL, container security, CI ve release workflow sonuçlarını inceleyin.
- Açıkları public issue yerine [SECURITY.md](../SECURITY.md) içindeki özel süreçle bildirin.

## Sorun giderme

- **Yerel giriş yönleniyor veya çerez kaydedilmiyor:** `NODE_ENV=development`, [Kurulum](INSTALLATION.tr.md) belgesindeki localhost URL'leri ve `TRUST_PROXY=false` ayarını doğrulayın.
- **Google callback'i reddediyor:** `GOOGLE_REDIRECT_URI`, `.env` ile Google Cloud OAuth istemcisinde birebir aynı olmalı. [Google Drive kurulumu](GOOGLE_DRIVE.tr.md) belgesine bakın.
- **Tarama bazı dosyaları bulmadan tamamlanıyor:** Ayarlar'daki kütüphane kaynağı ve tarama geçmişini inceleyin. Başarısız öğelerin hataları saklanır ve yeniden analiz edilebilir.
- **İçerik Chromium'da oynuyor ama Safari'de oynamıyor:** genellikle container veya ses codec'i farkıdır. Ayarlar → Depolama ve medya sağlığı her tarayıcı için oynatma planını gösterir.
- **Oynatma başlamadan bekliyor:** aktif FFmpeg işlerini ve kuyruğu inceleyin. Sınırları yalnızca host kapasitesini doğruladıktan sonra artırın.
- **Müzik metadatası eksik:** gömülü etiketleri inceleyip Müzik kütüphanesi bakımı önerilerini çalıştırın. MusicBrainz tamamlama, güvenilir yerel etiketleri otomatik olarak ezmez.
- **Şarkı sözü çevirisi kullanılamıyor:** `LIBRETRANSLATE_URL` ayarlayın; şarkı sözü aramasının kendisi LibreTranslate gerektirmez.
