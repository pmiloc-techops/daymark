# Daymark — setup and deployment

This is a React/Vite single-page app. Supabase handles Google sign-in and private data; Vercel hosts the built site.

## 1. Create the Supabase project and database

1. Go to [Supabase](https://supabase.com/dashboard), create a project, and wait for its database to finish provisioning.
2. In the project, open **SQL Editor → New query**.
3. **For a brand-new database only:** open this repository’s `supabase/schema.sql`, copy the entire file into the query, and click **Run**. If this is the Supabase project already running the original Daymark app, skip this step; do not rerun the base schema.
4. Open `supabase/migrations/202609220001_shared_osticket_scheduler.sql`, copy the whole file into a **new** SQL Editor query, and click **Run**. Run this migration on the existing project too; it protects the built-in projects and creates the shared booking tables, RLS rules, and claim/release functions while preserving personal work history.
5. Open `supabase/migrations/202609220002_osticket_booking_window.sql` in a separate query and click **Run**. This also enforces the new 8 AM–10 PM window for databases that already applied the scheduler migration.
6. Open `supabase/migrations/202609220003_shared_projects.sql` in a separate query and click **Run**. This adds project sharing, the project limits, and generalized shared schedules. Existing osTicket reservations are migrated.
7. Open `supabase/migrations/202609220004_meetings_entries_and_legacy_release.sql` in a separate query and click **Run**. This permits private Meetings work entries and fixes osTicket release of legacy claims.
8. In **Project Settings → API Keys**, create or copy the **Publishable key** (it starts with `sb_publishable_`). It is meant for browser apps and is restricted by the row-level security policies from the previous steps. Do not use the Secret key (`sb_secret_`) in this site. A legacy `anon` key also works, but use the publishable key for a new project.
9. Get the **Project URL** from the project’s **Connect** dialog or **Integrations → Data API** page. It looks like `https://abcdefgh.supabase.co`.

The migration adds the shared availability table to Supabase Realtime when that publication is enabled. The shared table contains only date/hour keys; the separate claim table keeps ownership private.

## 2. Create Google OAuth credentials (including the client secret)

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create/select a project for this app.
2. Open **Google Auth Platform**. Configure the branding/app name and audience. For a PMILOC Google Workspace, choose **Internal** only if every `@pmiloc.org` user belongs to that same Workspace. Otherwise choose **External**; while its publishing status is **Testing**, add each account that needs to test under **Audience → Test users**. Before broad use, publish the consent app as appropriate for your organization.
3. In **Google Auth Platform → Clients**, click **Create client** and choose **Web application**.
4. Set **Authorized JavaScript origins** to the origin(s) users open in their browser. Add `http://localhost:5173` for local testing and `https://YOUR-VERCEL-DOMAIN.vercel.app` after deploying. Origins have no path or trailing slash.
5. Set **Authorized redirect URIs** to the Supabase callback, exactly as shown in Supabase’s Google provider configuration. It is usually `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`. This is the callback Google sends the user to; it is not your localhost or Vercel website URL.
6. Click **Create**. Google shows an OAuth **Client ID** and **Client secret**. Copy both while the dialog is open; the secret belongs only in Supabase, never in this repository, `.env.local`, or Vercel. If you lose it, create/rotate a client secret in Google Cloud and update the value in Supabase.
7. In Supabase, open **Authentication → Sign In / Providers → Google** (the exact navigation label may be “Providers”). Enable Google and paste the Client ID and Client secret. Save.

Google’s OAuth audience/test-user rules can prevent login even when the app is configured correctly. The app also asks Google to prefer `pmiloc.org` accounts; Supabase’s signup trigger is what rejects other domains.

## 3. Configure Supabase redirect URLs

1. In Supabase open **Authentication → URL Configuration**.
2. Set **Site URL** to `http://localhost:5173` for local testing. Add `http://localhost:5173/**` to **Redirect URLs**.
3. After deployment, change the **Site URL** to the production Vercel URL, such as `https://YOUR-VERCEL-DOMAIN.vercel.app`.
4. Keep `http://localhost:5173/**` in **Redirect URLs** and add the exact production URL. If you use Vercel preview deployments, add a narrow wildcard matching your Vercel team/account slug, for example `https://*-YOUR-TEAM-SLUG.vercel.app/**`.

The app sends the current browser origin as `redirectTo`, so that exact origin must match a Supabase Redirect URL. The Google Authorized redirect URI remains the Supabase callback from step 2.

## 4. Run and test locally before deploying

1. Install Node.js 20 or newer.
2. In the repository root, copy `.env.example` to `.env.local`.
3. Edit `.env.local` so it contains your real values (no angle brackets or placeholder text):

   ```dotenv
   VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_REAL_KEY
   ```

   If using the legacy anon key instead, set `VITE_SUPABASE_ANON_KEY=YOUR_REAL_ANON_KEY` in place of the publishable-key line. Do not add the Google OAuth client secret or Supabase secret/service-role key here.

4. In a terminal opened in the repository root, run:

   ```sh
   npm install
   npm run dev
   ```

5. Open the exact local URL Vite prints, usually `http://localhost:5173`. If it prints another port because 5173 is occupied, add that port to both Google’s Authorized JavaScript origins and Supabase Redirect URLs, then use that printed URL.
6. Click **Continue with Google** and sign in with a permitted `@pmiloc.org` account. On first successful account creation, the calendar should open with Meetings, osTicket, and New Website. Create a test project and work entry, refresh the page, and confirm they remain.
7. If `.env.local` was changed while Vite was already running, stop the server with Ctrl+C and run `npm run dev` again. Vite reads these values when it starts.

Without valid Supabase settings, the page shows a setup message and disables Google sign-in. If JavaScript fails to start, the initial page now shows a visible loading diagnostic instead of a blank canvas; a React startup exception shows its error details.

## 5. Deploy to Vercel

1. Push the repository to GitHub, GitLab, or Bitbucket.
2. In [Vercel](https://vercel.com/), choose **Add New → Project**, import that repository, and make sure **Root Directory** is the folder containing this `package.json`.
3. Use the detected Vite settings: **Build Command** `npm run build`, **Output Directory** `dist`, **Install Command** `npm install`.
4. Under **Project Settings → Environment Variables**, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (or the legacy anon variable) for **Production**. Add them for **Preview** too if preview deployments should connect to Supabase. These `VITE_` values are included in the public browser bundle; that is why only a publishable/anon key belongs there. Never add a Supabase secret/service-role key or Google OAuth client secret to Vercel for this frontend.
5. Deploy. Copy the deployment’s stable production domain. Add it to the Google OAuth client’s Authorized JavaScript origins and to Supabase’s Site URL/Redirect URLs as described above.
6. After changing any Vercel environment variable, trigger a new deployment; existing deployments do not acquire new build-time variables retroactively.
7. Open the production URL in a private/incognito window. Confirm the page displays the login form, Google sign-in returns to the production URL, and the calendar loads after sign-in.

`vercel.json` rewrites app paths to `index.html`, as required for this client-rendered Vite app.

## Shared osTicket schedule

The osTicket schedule appears above **Your projects** without an extra Shared badge. Its Sunday–Saturday grid shows 8 AM through 10 PM Toronto time. `A` means available, `R` means reserved, and your own booking uses the same blue as the legend. Other shared projects have weekly grids with all 24 hours.

Each user can have up to 3 active personal projects and make up to 3 of their projects shared. A shared project appears in **Shared projects** for every user. Claiming a block adds one hour to that user’s private calendar and monthly summary. osTicket blocks can also be claimed from the month calendar’s **Add time** picker and released using the entry’s remove control. A project that has ever been claimed stays shared and cannot be removed, preserving its history. Booking ownership stays private; release is available only to the user who claimed that block. Meetings and osTicket cannot be archived.

## Blank-screen troubleshooting

1. If the page shows **Loading Daymark…** and never changes, open browser Developer Tools → **Console** and **Network**, reload, and look for a failed JavaScript asset or runtime error. In Vercel, confirm the deployment is Ready and its output contains `dist/index.html` plus `dist/assets/*`.
2. If the login panel says Supabase is not configured, set both Vercel variables with the exact Project URL and Publishable key, select Production (and Preview if testing previews), save, then redeploy.
3. If Google sign-in reports `redirect_uri_mismatch`, compare the URI in Google Cloud’s Authorized redirect URIs character-for-character with the Supabase Google provider callback. For `redirect_to`/not-allowed errors, add the website origin to Supabase Auth Redirect URLs.
4. If the login button redirects but the calendar does not load, open Supabase **Authentication → Users** and **Logs → Auth Logs**. Confirm the user email ends in `@pmiloc.org`; then confirm the SQL setup completed and the signup trigger inserted a profile and starter projects.
5. If you can share the deployed URL and the first console error (remove any tokens/keys), the remaining issue can be traced to a specific failed request or runtime exception.
