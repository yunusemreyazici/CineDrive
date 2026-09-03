# Google Drive Setup

[Documentation](../README.md#documentation) · [Türkçe](GOOGLE_DRIVE.tr.md)

Google Drive is optional. Local-folder libraries do not connect to Google, but the current environment schema still expects syntactically valid placeholder OAuth values.

CineDrive uses a server-side OAuth 2.0 flow and requests only the account email plus the read-only Drive scope:

```text
https://www.googleapis.com/auth/drive.readonly
https://www.googleapis.com/auth/userinfo.email
```

CineDrive never requests permission to modify or delete Drive content. Refresh tokens are encrypted before being stored.

## Create the Google Cloud client

1. Open the [Google Cloud Console](https://console.cloud.google.com/), then create or select a project. Keep the same project selected throughout the setup.

2. Enable the Google Drive API:

   - Open **APIs & Services → Library**.
   - Search for **Google Drive API**.
   - Open it and select **Enable**.

   You can also use Google's direct [Drive API enablement page](https://console.cloud.google.com/apis/library/drive.googleapis.com).

3. Configure the consent screen under **Google Auth Platform**:

   - **Branding:** use `CineDrive` as the app name and add support and developer contact addresses.
   - **Audience:** use **External** for personal Google accounts. An organization-owned Workspace project can use **Internal** when only organization members connect.
   - **Data Access:** add the two exact scopes shown above.

4. While the application is in **Testing**, add every Google account that will connect to CineDrive under **Audience → Test users**.

   > In Testing mode, Google expires the authorization, including an offline refresh token, after seven days. For a long-running personal installation, switch the publishing status to **In production** after testing. Personal-use apps with fewer than 100 users may remain unverified, but Google displays an unverified-app warning. Public or larger deployments using `drive.readonly` can require restricted-scope verification and a security review.

5. Under **Google Auth Platform → Clients**, create a **Web application** OAuth client and add the callback matching the installation under **Authorized redirect URIs**:

   ```text
   # Local development
   http://localhost:3000/api/auth/google/callback

   # Production
   https://cinedrive.example.com/api/auth/google/callback
   ```

   Replace the production domain with your own. Authorized JavaScript origins are not required because the OAuth code exchange happens on the CineDrive server.

6. Copy the generated values into `.env`:

   ```dotenv
   GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-client-secret
   GOOGLE_REDIRECT_URI=https://cinedrive.example.com/api/auth/google/callback
   ```

   `GOOGLE_REDIRECT_URI` must exactly match an authorized redirect URI, including protocol, host, port, path, and trailing slash.

7. Restart CineDrive, sign in with the CineDrive administrator account, and open **Settings → Google Drive → Connect Google Drive**. Google connection credentials are separate from the CineDrive login account.

## Sources and access

CineDrive can connect multiple Google accounts, regular folders, and Shared Drives. Drive access uses the read-only OAuth scope. Each source has independent scan status and history, and media requests are checked against the signed-in user's library access.

Never commit `.env`, the OAuth client secret, or downloaded credential files. For additional background, see Google's official documentation for [enabling Workspace APIs](https://developers.google.com/workspace/guides/enable-apis), [web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), and [OAuth audience and publishing status](https://support.google.com/cloud/answer/15549945).

## Troubleshooting

- **Google rejects the callback:** make `GOOGLE_REDIRECT_URI` identical in `.env` and the OAuth client.
- **Authorization expires after seven days:** confirm whether the consent screen is still in Testing mode.
- **A source cannot be scanned:** reconnect its Google account, then inspect source-specific scan history under Settings.
- **Local login redirects after OAuth configuration:** verify the local URLs in [Installation](INSTALLATION.md) and keep `TRUST_PROXY=false` outside a trusted reverse proxy.
