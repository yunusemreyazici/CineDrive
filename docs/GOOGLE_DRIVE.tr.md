# Google Drive Kurulumu

[Dokümantasyon](../README.tr.md#dokümantasyon) · [English](GOOGLE_DRIVE.md)

Google Drive isteğe bağlıdır. Yerel klasör kütüphaneleri Google'a bağlanmaz; ancak mevcut ortam şeması sözdizimsel olarak geçerli placeholder OAuth değerleri bekler.

CineDrive sunucu taraflı OAuth 2.0 akışı kullanır ve yalnızca hesap e-postasıyla salt okunur Drive kapsamını ister:

```text
https://www.googleapis.com/auth/drive.readonly
https://www.googleapis.com/auth/userinfo.email
```

CineDrive, Drive içeriğini değiştirme veya silme izni istemez. Yenileme belirteçleri saklanmadan önce şifrelenir.

## Google Cloud istemcisini oluşturma

1. [Google Cloud Console'u](https://console.cloud.google.com/) açıp bir proje oluşturun veya seçin. Kurulum boyunca aynı projenin seçili kaldığından emin olun.

2. Google Drive API'yi etkinleştirin:

   - **APIs & Services → Library** bölümünü açın.
   - **Google Drive API** araması yapın.
   - API'yi açıp **Enable** seçeneğine basın.

   Google'ın doğrudan [Drive API etkinleştirme sayfasını](https://console.cloud.google.com/apis/library/drive.googleapis.com) da kullanabilirsiniz.

3. **Google Auth Platform** altında izin ekranını yapılandırın:

   - **Branding:** uygulama adı olarak `CineDrive` kullanın; destek ve geliştirici iletişim adreslerini ekleyin.
   - **Audience:** kişisel Google hesapları için **External** seçin. Kuruluşa ait Workspace projesinde yalnızca kuruluş üyeleri bağlanacaksa **Internal** kullanılabilir.
   - **Data Access:** yukarıda gösterilen iki kapsamı birebir ekleyin.

4. Uygulama **Testing** durumundayken bağlanacak bütün Google hesaplarını **Audience → Test users** bölümüne ekleyin.

   > Testing modunda Google, çevrimdışı yenileme belirteci dahil yetkilendirmeyi yedi gün sonra sona erdirir. Uzun süre çalışacak kişisel kurulumda testten sonra yayın durumunu **In production** yapın. 100 kullanıcıdan az kişisel uygulamalar doğrulanmadan kalabilir; ancak Google “unverified app” uyarısı gösterir. `drive.readonly` kullanan public veya daha büyük dağıtımlar kısıtlanmış kapsam doğrulaması ve güvenlik incelemesi gerektirebilir.

5. **Google Auth Platform → Clients** altında **Web application** türünde OAuth istemcisi oluşturup kurulumla eşleşen callback'i **Authorized redirect URIs** alanına ekleyin:

   ```text
   # Yerel geliştirme
   http://localhost:3000/api/auth/google/callback

   # Production
   https://cinedrive.example.com/api/auth/google/callback
   ```

   Production alan adını kendinizinkiyle değiştirin. OAuth kod değişimi CineDrive sunucusunda yapıldığı için Authorized JavaScript origins gerekli değildir.

6. Oluşturulan değerleri `.env` dosyasına kopyalayın:

   ```dotenv
   GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-client-secret
   GOOGLE_REDIRECT_URI=https://cinedrive.example.com/api/auth/google/callback
   ```

   `GOOGLE_REDIRECT_URI`; protokol, host, port, path ve sondaki eğik çizgi dahil olmak üzere yetkili yönlendirme adreslerinden biriyle birebir eşleşmelidir.

7. CineDrive'ı yeniden başlatın, CineDrive yönetici hesabıyla giriş yapın ve **Ayarlar → Google Drive → Google Drive’ı Bağla** bölümünü açın. Google bağlantı bilgileri CineDrive giriş hesabından ayrıdır.

## Kaynaklar ve erişim

CineDrive birden fazla Google hesabını, normal klasörleri ve Ortak Sürücüleri bağlayabilir. Drive erişimi salt okunur OAuth kapsamını kullanır. Her kaynağın tarama durumu ve geçmişi ayrıdır; medya istekleri giriş yapan kullanıcının kütüphane erişimine göre denetlenir.

`.env`, OAuth istemci sırrı veya indirilen kimlik bilgisi dosyalarını hiçbir zaman commit etmeyin. Ayrıntılar için Google'ın resmi [Workspace API etkinleştirme](https://developers.google.com/workspace/guides/enable-apis), [web sunucusu OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Drive kapsamları](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) ve [OAuth kitle/yayın durumu](https://support.google.com/cloud/answer/15549945) belgelerine bakın.

## Sorun giderme

- **Google callback'i reddediyor:** `GOOGLE_REDIRECT_URI` değerini `.env` ve OAuth istemcisinde birebir aynı yapın.
- **Yetkilendirme yedi gün sonra sona eriyor:** izin ekranının hâlâ Testing modunda olup olmadığını kontrol edin.
- **Bir kaynak taranamıyor:** ilgili Google hesabını yeniden bağlayıp Ayarlar'daki kaynağa özel tarama geçmişini inceleyin.
- **OAuth ayarından sonra yerel giriş yönleniyor:** [Kurulum](INSTALLATION.tr.md) belgesindeki yerel URL'leri doğrulayın; güvenilir reverse proxy dışında `TRUST_PROXY=false` kullanın.
