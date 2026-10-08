# Switching on "Continue with Google"

Google sign-in is built. It turns on when two settings exist in the Vercel project `wos-account`: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. About ten minutes, no cost.

## Steps for the founder

1. Open https://console.cloud.google.com/ and sign in with the Google account that should own this.
2. Top bar, project picker, **New project**. Name: `warOnSaaS Account`. Create, then make sure it is selected.
3. Left menu, **APIs & Services**, **OAuth consent screen** (newer consoles call it **Google Auth Platform**, **Branding**). Press **Get started**, and fill in:

   | Field | Value |
   |---|---|
   | App name | `warOnSaaS` |
   | User support email | your address |
   | Audience | **External** |
   | Contact email | your address |
   | App logo | optional; skip it to avoid a logo review |
   | App home page | `https://waronsaas.com` |
   | Privacy policy | `https://waronsaas.com/privacy` |
   | Terms of service | `https://waronsaas.com/terms` |
   | Authorized domains | `waronsaas.com` |

4. **Data access** (or **Scopes**): add `openid`, `.../auth/userinfo.email` and `.../auth/userinfo.profile`. Nothing else. These are not sensitive, so Google needs no review.
5. **Audience**: press **Publish app** so it is "In production". (While in "Testing", only test users you list can sign in.)
6. **Clients** (or **Credentials**, **Create credentials**, **OAuth client ID**):

   | Field | Value |
   |---|---|
   | Application type | Web application |
   | Name | `warOnSaaS Account` |
   | Authorized JavaScript origins | `https://account.waronsaas.com` |
   | Authorized redirect URIs | `https://account.waronsaas.com/auth/google/callback` |

7. Press **Create**. Google shows a Client ID and a Client secret. Keep that window open.
8. In a terminal on your Mac, paste each one when asked (nothing is shown on screen):

   ```sh
   cd ~/wos-account
   vercel env add GOOGLE_CLIENT_ID production --scope battle-juice
   vercel env add GOOGLE_CLIENT_SECRET production --scope battle-juice
   vercel deploy --prod --yes --scope battle-juice
   ```

   Or tell the Accounts lane and it does step 8 for you.

"Continue with Google" then shows on the sign-in page and in every app's sign-in prompt. People whose Google email matches an existing account land in that same account.
