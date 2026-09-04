# CineDrive Kurulumu

[Dokümantasyon](../README.tr.md#dokümantasyon) · [English](INSTALLATION.md)

CineDrive kaynak koddan, Docker Compose ile veya özel bir Debian/Ubuntu sunucusunda systemd servisi olarak çalışabilir. Her kurulumda production kalitesinde gizli anahtarlar kullanın.

## Gereksinimler

Aşağıdaki runtime yollarından birini seçin:

- Docker ve Docker Compose veya
- pnpm 11 ile Node.js 22 serisinde 22.13+ ya da Node.js 24.

Tüm yollar gizli anahtar üretmek için OpenSSL gerektirir. Google Drive kütüphaneleri bir Google Cloud OAuth istemcisi ister; yalnızca yerel klasör kullanan kurulumlar Drive'a erişmez, ancak mevcut ortam şeması sözdizimsel olarak geçerli placeholder OAuth değerleri bekler. Normal Node ve Docker kurulumları paketlenen `ffmpeg-static` binary'sini kullanır. `fpcalc`/Chromaprint isteğe bağlıdır ve akustik parmak izini etkinleştirir.

## Docker Compose

Depoyu klonlayıp ortam dosyasını oluşturun:

```bash
git clone https://github.com/yunusemreyazici/CineDrive.git
cd CineDrive
cp .env.example .env
```

İki gizli alan için ayrı değerler üretin:

```bash
openssl rand -hex 32 # SESSION_SECRET
openssl rand -hex 32 # TOKEN_ENCRYPTION_KEY
```

Değerleri `.env` dosyasına yapıştırın; bütün örnek kimlik bilgilerini ve public URL'leri değiştirip yönetici hesabını yapılandırın. Yerel kullanım Google bağlantısı gerektirmez; ancak ortam şeması zorunlu tuttuğu için OAuth istemci placeholder'larını boş bırakmayın ve geçerli bir callback URL'si kullanın.

Stack'i derleyip başlatın:

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f
```

Nginx uygulamayı 80 numaralı porttan sunar ve `/api` isteklerini sunucuya aktarır. Sunucu başlamadan önce sürümlenmiş Prisma migration'larını uygular. Uygulama verisi, altyazı önbelleği ve Nginx logları adlandırılmış volume'larda tutulur.

Etiketli sürümler GHCR'a `linux/amd64` ve `linux/arm64` image'ları da yayınlar. Tekrarlanabilir dağıtım için release Compose override'ını GitHub Release'e eklenen immutable digest referanslarıyla kullanın:

```bash
cp release.env.example release.env
```

[Image doğrulama](RELEASING.tr.md) adımlarını izleyip seçtiğiniz sürümün doğrulanmış image digest referanslarını `release.env` içine yazın. Örnek placeholder değerlerini kullanmayın. Ardından çalıştırın:

```bash
docker compose --env-file release.env \
  -f docker-compose.yml -f docker-compose.release.yml pull
docker compose --env-file release.env \
  -f docker-compose.yml -f docker-compose.release.yml up -d --no-build
```

Kurulumu internete açmadan önce [Operasyon](OPERATIONS.tr.md), image doğrulama ve geri dönüş için [CineDrive Sürümleme](RELEASING.tr.md) belgelerini okuyun.

## İlk kütüphane kurulumu

Yönetici olarak giriş yaptıktan sonra boş ana sayfadan veya Ayarlar → Kütüphaneler bölümünden isteğe bağlı kurulum sihirbazını açın. Doğrudan `/setup` adresini de kullanabilirsiniz. Mevcut kütüphaneler ve normal Ayarlar akışı korunur; zorunlu yönlendirme yapılmaz.

1. Yerel klasör veya Google Drive seçin.
2. Erişimi kontrol edin. Yerel klasör için **sunucunun** gördüğü mutlak yolu (Docker'da konteyner yolunu) girin. Drive için hesabı yeni sekmede bağlayın, geri dönüp hesap listesini yenileyin ve hesabı seçin. Daha güvenli varsayılanı koruyup belirli klasör kimliği girebilir veya açıkça tüm hesap seçeneğini seçebilirsiniz. Tüm hesap taraması erişilebilir bütün Drive medyasını indeksler ve çok daha uzun sürebilir. OAuth yapılandırması için [Google Drive kurulumu](GOOGLE_DRIVE.tr.md) belgesine bakın.
3. Bilgileri gözden geçirip kaynağı oluşturun. Bu işlem taramayı başlatmaz.
4. Taramayı başlatıp durumunu izleyin. Başarısız tarama, ikinci bir kaynak oluşturmadan yeniden denenebilir.

Yerel erişim kontrolü yalnızca seçilen dizini açar; medyayı incelemez ve her alt öğeye erişimi garanti etmez. Tarama medya dosyalarınızı taşımaz veya silmez. Kaynak kaydedildikten sonra kimliği sayfa URL'sinde tutulur; sayfayı yenileyebilir veya kaydedilmiş kaynaklar listesinden dönebilirsiniz. Kaydedilmemiş form bilgileri kalıcı tutulmaz. Sayfadan ayrılsanız da tarama sunucuda devam eder.

## Docker'da yerel medya

Konteyner, mount edilmemiş host medya klasörlerini göremez. `docker-compose.yml` içindeki mevcut `server.volumes` listesine salt okunur bind mount ekleyin; adlandırılmış volume'ları koruyun:

```yaml
services:
  server:
    volumes:
      - app_data:/app/data
      - subtitle_cache:/app/data/subtitle_cache
      - /absolute/path/to/media:/media:ro
```

Host yolunu koleksiyonunuzun yoluyla değiştirip konteyner kullanıcısının okuyabildiğinden emin olun; `docker compose up -d` ile servisi yeniden oluşturun. Ayarlar'da yerel kütüphane oluştururken host yolunu değil `/media` yolunu kullanın. İlgisiz özel dizinleri mount etmeyin.

## Debian/Ubuntu VPS

Yeni bir Debian veya Ubuntu sunucusunda:

```bash
git clone https://github.com/yunusemreyazici/CineDrive.git
cd CineDrive
sudo bash scripts/install-vps.sh
```

Etkileşimli kurucu; özel sistem kullanıcısını, Node.js'i, pnpm'i, FFmpeg'i, SQLite'ı, systemd'yi, Nginx'i ve TLS'i yapılandırır. TLS seçenekleri Cloudflare Origin Certificate, Certbot/Let's Encrypt ve yalnızca HTTP modlarını içerir.

Mevcut uygulamaları barındıran bir sunucuda çalıştırmadan önce kurucuyu inceleyin: systemd ve Nginx yapılandırmasına yazar.

## Yerel geliştirme

Kilitlenmiş bağımlılıkları kurup ortam dosyasını oluşturun:

```bash
git clone https://github.com/yunusemreyazici/CineDrive.git
cd CineDrive
pnpm install --frozen-lockfile
cp .env.example .env
openssl rand -hex 32 # SESSION_SECRET
openssl rand -hex 32 # TOKEN_ENCRYPTION_KEY
```

Kopyalanan production URL'lerini yerel geliştirme için değiştirin:

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

Üretilen değerleri `SESSION_SECRET` ve `TOKEN_ENCRYPTION_KEY` alanlarına yapıştırıp `ADMIN_EMAIL` ile `ADMIN_PASSWORD` değerlerini ayarlayın. Google Drive kullanıyorsanız [Google Drive kurulumu](GOOGLE_DRIVE.tr.md) belgesindeki bilgileri yapılandırın ve aynı yerel callback URL'sini kaydedin.

Prisma Client'ı üretin, migration'ları uygulayın ve iki uygulamayı başlatın:

```bash
pnpm prisma:generate
pnpm --filter @cinedrive/server prisma:deploy
pnpm dev
```

- Web: `http://localhost:5173`
- API: `http://localhost:3000`
- Canlılık: `http://localhost:3000/api/health`
- Veritabanı hazırlığı: `http://localhost:3000/api/ready`

Göreli SQLite adresi `apps/server/prisma/` dizininden çözülür; örnek, `apps/server/prisma/data/app.db` dosyasını oluşturur. `ADMIN_EMAIL` ve `ADMIN_PASSWORD` ile tanımlanan yönetici ilk açılışta oluşturulur. Giriş yaptıktan sonra yerel kütüphane oluşturun veya Ayarlar'dan Drive'ı bağlayın.

Tam ortam referansı ve çok kullanıcılı mod için [Yapılandırma](CONFIGURATION.tr.md), repo komutları ve testler için [Geliştirme](DEVELOPMENT.tr.md) belgelerine bakın.
