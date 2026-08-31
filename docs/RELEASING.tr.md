# CineDrive Sürümleme

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

## Hazırlama ve doğrulama

1. `package.json`, `apps/server/package.json`, `apps/web/package.json` ve
   `packages/shared/package.json` içindeki sürümü birlikte güncelleyin.
2. Eşleşen `CHANGELOG.md` bölümünü ekleyin.
3. Tam doğrulama takımını çalıştırın:

   ```bash
   pnpm install --frozen-lockfile
   pnpm prisma:generate
   pnpm release:check
   pnpm -r run typecheck
   pnpm lint
   pnpm -r run test
   pnpm build
   pnpm test:e2e
   ```

4. Pull request açın. Release workflow'u sunucu ve web image'larını registry'ye
   göndermeden `linux/amd64` ve `linux/arm64` için derler.
5. Pull request merge edildikten ve `main` kontrolleri geçtikten sonra etiketi tam o
   commit üzerinde oluşturun. İmzalı etiket tercih edin:

   ```bash
   git switch main
   git pull --ff-only
   pnpm release:check -- --tag v1.0.0
   git tag -s v1.0.0 -m "CineDrive v1.0.0"
   git push origin v1.0.0
   ```

Yalnızca geçerli bir tag push'u yayın yapabilir. Manuel workflow çalıştırmaları
dry-run'dır ve paket, attestation veya identity token yazma yetkisi almaz.

## Sürüm çıktıları

Her geçerli etiket aşağıdaki multi-architecture image'ları yayınlar:

- `ghcr.io/yunusemreyazici/cinedrive-server`
- `ghcr.io/yunusemreyazici/cinedrive-web`

Her image tam SemVer, major/minor kolaylık etiketi ve tam commit SHA etiketi alır;
`latest` yalnızca kararlı sürümler için üretilir. Workflow, değiştirilemez
`image@sha256:...` referansını GitHub Release'e eklenen JSON manifestinde kaydeder.
Dağıtım ve geri dönüşte bu digest referansını kaynak kabul edin.

Her digest ayrıca şunları içerir:

- GitHub artifact attestations tarafından oluşturulan SLSA provenance;
- OCI image'ına ve GitHub Release'e eklenen CycloneDX SBOM;
- GitHub Actions OIDC üzerinden üretilen keyless Cosign imzası.

Uzun ömürlü registry veya imzalama gizlisi kullanılmaz. Yalnızca publish job'u
`packages: write`, `attestations: write`, `artifact-metadata: write` ve
`id-token: write`; yalnızca son release job'u `contents: write` alır.

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

Güncellemeden önce Docker volume dışında doğrulanmış veritabanı yedeği alın ve çalışan
sunucu/web digest referanslarını kaydedin. `release.env` içindeki iki değeri birlikte
güncelleyin, image'ları çekin, `--no-build` ile başlatın; `/api/ready`, giriş ve mevcut
bir kütüphane kontrolü geçmeden güncellemeyi tamamlanmış saymayın.

Başlangıç veya migration başarısız olursa:

1. Stack'i durdurun; logları ve başarısız veritabanını inceleme için saklayın.
2. Güncelleme öncesi snapshot'ı geri yükleyin. Eski image'ı yeni migration'ların
   değiştirdiği veritabanıyla çalıştırmayın.
3. Önceki iki immutable digest referansını `release.env` dosyasına geri koyun.
4. Sabit sürüm komutlarıyla image'ları çekip stack'i başlatın.
5. Trafiği açmadan `/api/ready`, giriş ve mevcut bir kütüphaneyi doğrulayın.

GitHub Release yalnızca iki image manifesti, iki SBOM ve release kaydı oluştuğunda
tamamlanmış sayılır. Kısmi workflow hatasını yeni bir sürümle düzeltin; yayınlanmış
bir etiketi taşımayın veya içeriğini değiştirmek için yeniden kullanmayın.
