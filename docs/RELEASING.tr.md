# CineDrive Sürümleme

[Dokümantasyon](../README.tr.md#dokümantasyon) · [English](RELEASING.md)

CineDrive Semantik Sürümleme kullanır ve sürümleri değiştirilemez `v*` Git
etiketlerinden yayınlar. Kök, sunucu, web ve ortak paket sürümleri birlikte ilerler.

## Sürüm politikası

- `PATCH`, public API veya saklanan veri sözleşmesini bilerek değiştirmeyen hata düzeltmeleridir.
- `MINOR`, geriye uyumlu yeni davranışlar ekler.
- `MAJOR`, uyumsuz API, yapılandırma veya migration değişiklikleri içerebilir.
- Ön sürümler `1.1.0-rc.1` gibi geçerli SemVer ekleri kullanır.
- Yayınlanan etiketler taşınmaz ve yeniden kullanılmaz. Hatalı sürüm yeni bir sürümle düzeltilir.

Her sürümün `CHANGELOG.md` içinde eşleşen bir bölümü olmalıdır. Gelecek değişiklikleri
`[Unreleased]` altında tutun; sürüm hazırlanırken yeni sürüme ve tarihe taşıyın.

Güncel hazırlık hedefi, dört pakette de ortak olan `1.1.0` sürümüdür. Hazırlık PR'ı, changelog
tarihi veya başarılı dry-run, sürümün yayımlandığı anlamına gelmez. Kullanılabilirliği
[GitHub Releases sayfasından](https://github.com/yunusemreyazici/CineDrive/releases)
kontrol edin; örnek image referanslarının mevcut olduğunu varsaymayın.

## Hazırlama ve doğrulama

1. `package.json`, `apps/server/package.json`, `apps/web/package.json` ve
   `packages/shared/package.json` içindeki sürümü birlikte güncelleyin.
2. Eşleşen `CHANGELOG.md` bölümünü ekleyin.
3. Tam doğrulama takımını çalıştırın:

   `release:test`, gerçek index yayınlama betiğini sahte registry ile sınamak için
   Bash ve `jq` gerektirir. Linux CI runner'larında iki araç da bulunur.

   ```bash
   pnpm install --frozen-lockfile
   pnpm prisma:generate
   pnpm release:test
   pnpm release:check
   pnpm -r run typecheck
   pnpm lint
   pnpm -r run test
   pnpm build
   pnpm test:e2e
   ```

4. Tag oluşturmadan veya yayın yapmadan sürüme ait notları önizleyin:

   ```bash
   node scripts/validate-release.mjs --tag v1.1.0 --notes
   ```

   Kontrol; eşleşen paket sürümleri, tek ve tam eşleşen sürüm başlığı, geçerli takvim
   tarihi ve boş olmayan değişiklik maddeleri ister. Yerel metadata'yı doğrular;
   uzaktaki tag durumunu, image imzalarını veya yayın iznini doğrulamaz.

5. Pull request açın. Release workflow'u sunucu ve web image'larını registry'ye
   göndermeden `linux/amd64` ve `linux/arm64` için, mimariyle eşleşen native
   `ubuntu-24.04` ve `ubuntu-24.04-arm` runner'larında derler. Her image yerel olarak
   yüklenir; mimarisi ve Prisma migration veya Nginx yapılandırması kontrol edilir.
   Bağımlılık kurulumu ve derlemelerde QEMU kullanılmaz.
6. Yayın ayrıca onaylanmadıkça hazırlık PR'ında durun. Yayın günü değiştiyse önce
   changelog tarihini güncelleyin; incelenen PR'ı birleştirin ve tam o `main`
   commit'inin bütün kontrollerinin geçmesini bekleyin. Tam SHA'yı kaydedin ve
   hedef tag/release'in mevcut olmadığını doğrulayın. Ancak bundan sonra etiketi
   o commit üzerinde oluşturun. İmzalı etiket tercih edin:

   ```bash
   git switch main
   git pull --ff-only
   git rev-parse HEAD  # onaylanan ve test edilen release commit'i ile eşleşmeli
   pnpm release:check -- --tag v1.1.0
   git tag -s v1.1.0 -m "CineDrive v1.1.0"
   git push origin v1.1.0
   ```

Yalnızca geçerli bir tag push'u yayın yapabilir. Manuel workflow çalıştırmaları
dry-run'dır ve paket, attestation veya identity token yazma yetkisi almaz.
GitHub Release açıklamasına doğrulanan sürümün changelog notları ve ardından
GitHub'ın ürettiği değişiklik listesi eklenir; `[Unreleased]` dahil edilmez.

## Sürüm çıktıları

Her geçerli etiket aşağıdaki multi-architecture image'ları yayınlar:

- `ghcr.io/yunusemreyazici/cinedrive-server`
- `ghcr.io/yunusemreyazici/cinedrive-web`

Her image tam SemVer, major/minor kolaylık etiketi ve tam commit SHA etiketi alır;
`latest` yalnızca kararlı sürümler için üretilir. Workflow, değiştirilemez
`image@sha256:...` referansını GitHub Release'e eklenen JSON manifestinde kaydeder.
Dağıtım ve geri dönüşte bu digest referansını kaynak kabul edin.

Tag derlemeleri dry-run ile aynı native runner/platform matrisini kullanır.
Platform image'ları yalnızca digest ile gönderilir; sürüm etiketleri bütün platform
derlemeleri başarılı olduktan sonra oluşturulur. Birleştirme adımı index'in tam olarak
beklenen AMD64 ve ARM64 digest'lerini içerdiğini kontrol eder; birleşik digest için
attestation/imza üretmeden önce yayınlanan index'i de doğrular. Eksik platform veya
geçersiz manifest sürüm yayınını başarısız kılar.

Her digest ayrıca şunları içerir:

- GitHub artifact attestations tarafından oluşturulan SLSA provenance;
- OCI image'ına ve GitHub Release'e eklenen CycloneDX SBOM;
- GitHub Actions OIDC üzerinden üretilen keyless Cosign imzası.

Uzun ömürlü registry veya imzalama gizlisi kullanılmaz. Yalnızca tag üzerinde çalışan
native build job'ları `packages: write` alır; tag üzerinde çalışan publish job'u ek
olarak `attestations: write`, `artifact-metadata: write` ve `id-token: write` alır.
Yalnızca son release job'u `contents: write` alır.

## Sürümü doğrulama

GitHub Release'ten iki image manifestini indirin ve içlerindeki `immutableReference`
değerlerini kullanın. GitHub provenance doğrulaması:

```bash
gh attestation verify \
  oci://ghcr.io/yunusemreyazici/cinedrive-server@sha256:... \
  --repo yunusemreyazici/CineDrive
```

Bağımsız keyless imzayı yalnızca bu repository'nin tag workflow kimliğine izin
verecek biçimde doğrulayın:

```bash
cosign verify \
  --certificate-identity-regexp '^https://github\.com/yunusemreyazici/CineDrive/\.github/workflows/release\.yml@refs/tags/v[0-9]' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/yunusemreyazici/cinedrive-server@sha256:...
```

İki doğrulamayı web image'ı için de tekrarlayın.

Bir sürümü kullanılabilir ilan etmeden önce iki image manifestinin onaylanan
sürüm/commit'i gösterdiğini, iki SBOM'un eklendiğini ve iki platformun bulunduğunu
doğrulayın. Herkese açık yayın için bir maintainer GHCR paket görünürlüğünü ve
kimlik doğrulamasız image çekmeyi kontrol etmelidir. Git repository'sinin public
olması paketlerin de public olduğunu garanti etmez. No-push derlemeyi, imzalama
veya anonim indirme doğrulaması olarak raporlamayın; bunlar yayımlanmış artifact
gerektirir.

## Sabit sürümü dağıtma

Örneği kopyalayın ve iki değeri aynı GitHub Release'e eklenen digest referanslarıyla
değiştirin:

```bash
cp release.env.example release.env
docker compose --env-file release.env \
  -f docker-compose.yml -f docker-compose.release.yml pull
docker compose --env-file release.env \
  -f docker-compose.yml -f docker-compose.release.yml up -d --no-build
docker compose --env-file release.env \
  -f docker-compose.yml -f docker-compose.release.yml ps
```

Standart `.env` çalışma zamanı yapılandırmasını ve gizlileri tutmaya devam eder;
`release.env` yalnızca image referanslarını içerir ve Git tarafından yok sayılır.

## Güncelleme ve geri dönüş

### 1.0.0'dan 1.1.0'a geçiş kontrol listesi

Bu bir hazırlık rehberidir; 1.1.0 image'larının yayınlandığı veya canlı güncellemenin
başarılı olduğu anlamına gelmez. Image çekmeden önce sürümün yayınlandığını doğrulayın.

- 1.0.0'a göre veritabanı şeması/migration, bağımlılık, zorunlu ortam değişkeni ve
  desteklenen Node runtime değişikliği yoktur. Sadece güncelleme için veritabanını
  sıfırlamayın, mevcut kaynakları yeniden bağlamayın veya kurulumu tekrarlamayın.
  Yeni sihirbaz isteğe bağlıdır.
- Yayından önce sihirbazı gerçek Google hesabıyla elle doğrulayın: yeni sekmede
  bağlayın, hesapları yenileyin, klasörü doğrulayıp kaydedin, taramayı başlatın ve
  sayfayı yenileyerek devam edin. Otomatik Drive mock testleri canlı OAuth'u kanıtlamaz.
- Yayından ve image imza/manifest doğrulamasından sonra, production'ı değiştirmeden
  önce yalıtılmış bir 1.0.0 kurulum kopyasında güncellemeyi prova edin. Eski veritabanı
  yedeğini, yapılandırmayı, şifreleme anahtarını ve iki image digest'ini koruyun.
  Kopyalanan kimlik bilgilerini gizli tutun; prova sırasında production medyasına
  karşı paralel tarama çalıştırmayın.
- Aşağıdaki komutlarla iki image digest'ini birlikte güncelleyin. `/api/ready`,
  giriş, mevcut video/müzik kütüphanesi, oynatma ve isteğe bağlı `/setup` sayfasını
  kontrol edin. Ayrı bir test dizininde yerel klasör taraması yapın.
- Aşağıdaki kurtarma prosedürüyle, kayıtlı 1.0.0 image'ları ve güncelleme öncesi
  snapshot üzerinden geri dönüşü prova edin. Production için doğrulanmış demeden
  önce sonuçları kaydedin. Şema regresyon testleri ve no-push derlemeler tek başına
  iki image sürümü arasında başarılı güncelleme veya geri dönüş kanıtı değildir.

### Yedekleme ve kurtarma prosedürü

Güncellemeden önce Docker volume dışında doğrulanmış veritabanı yedeği alın ve çalışan
sunucu/web digest referanslarını kaydedin. `release.env` içindeki iki değeri birlikte
güncelleyin, image'ları çekin, `--no-build` ile başlatın; `/api/ready`, giriş ve mevcut
bir kütüphane kontrolü geçmeden güncellemeyi tamamlanmış saymayın.

Eski dağıtım yapılandırmasını ve `TOKEN_ENCRYPTION_KEY` değerini de Git dışında,
güvenli biçimde saklayın. Veritabanında şifrelenmiş kimlik bilgileri bulunur ancak
bunları çözmek için gereken anahtar bulunmaz. Veritabanı snapshot'ı yerel medya
veya Drive dosyalarını yedeklemez.

Mevcut sunucu çalışırken snapshot alın, ardından seçilen dosyayı ayrı depolamaya
kopyalayın. Tam dosya adını ve checksum'ını eski image referanslarıyla birlikte
kaydedin. Kurtarmada tahmini dosya adı veya "en son" yedek seçimi kullanmayın.

Başlangıç veya migration başarısız olursa:

1. Stack'i durdurun; logları ve başarısız veritabanını inceleme için saklayın.
2. Güncelleme öncesi snapshot'ı geri yükleyin. Eski image'ı yeni migration'ların
   değiştirdiği veritabanıyla çalıştırmayın.
3. Önceki iki immutable digest referansını `release.env` dosyasına geri koyun.
4. Sabit sürüm komutlarıyla image'ları çekip stack'i başlatın.
5. Trafiği açmadan `/api/ready`, giriş ve mevcut bir kütüphaneyi doğrulayın.

Docker'da duran sunucuda `compose exec` çalışmaz. Mevcut release image'ı, aynı
runtime `.env` dosyası ve aynı veri volume'u ile tek seferlik bakım konteyneri
kullanın. Aşağıdaki yolu `/app/data` içinde bulunan kayıtlı snapshot ile değiştirin;
yalnızca sunucu dışı kopya kaldıysa önce volume'a kopyalayın. İlk restore komutu
yalnızca snapshot'ı doğrular:

```bash
docker compose --env-file release.env \
  -f docker-compose.yml -f docker-compose.release.yml stop
docker compose --env-file release.env \
  -f docker-compose.yml -f docker-compose.release.yml run --rm --no-deps \
  --entrypoint node server apps/server/dist/cli/database-restore.js \
  --from /app/data/backups/RECORDED-SNAPSHOT.db
docker compose --env-file release.env \
  -f docker-compose.yml -f docker-compose.release.yml run --rm --no-deps \
  --entrypoint node server apps/server/dist/cli/database-restore.js \
  --from /app/data/backups/RECORDED-SNAPSHOT.db --apply
```

Güncelleme veya kurtarmada `down --volumes` kullanmayın. Restore aracı ayrıca
işlem öncesi güvenlik snapshot'ı saklar; asıl hata loglarını/veritabanını da koruyun.
Eski image'ları ancak veritabanı geri yüklendikten sonra seçip başlatın. Snapshot'a
dönüş, snapshot sonrasındaki uygulama değişikliklerini kaybettirir.

Regresyon testleri dolu tarihsel video ve müzik veritabanlarında yedekleme,
yükseltme, dry-run restore, gerçek restore ve yeniden yükseltme adımlarını sınar.
Geri dönen snapshot'ın tamamını, yükseltme sonrası güvenlik yedeğini ve yeniden
yükseltme sonrası şema/veri bütünlüğünü doğrular. Bu, iki yayımlanmış image arasında
rollback kanıtı değil, şema
kurtarma provasıdır. Kaynaktan kurulmuş sistemin ilk güncellemesinde geri dönüş
için tam commit/image ve yapılandırmayı saklayın.

GitHub Release yalnızca iki image manifesti, iki SBOM ve release kaydı oluştuğunda
tamamlanmış sayılır. Kısmi workflow hatasını yeni bir sürümle düzeltin; yayınlanmış
bir etiketi taşımayın veya içeriğini değiştirmek için yeniden kullanmayın.

## Kaynaklar

- [GitHub release oluşturma ve notlar](https://cli.github.com/manual/gh_release_create)
- [Docker Compose tek seferlik komutlar](https://docs.docker.com/reference/cli/docker/compose/run/)
- [GHCR görünürlüğü ve kimlik doğrulama](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)
