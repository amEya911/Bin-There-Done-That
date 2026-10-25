# WhichBin hosting

The public address is `https://whichbin.fyi`. Cloudflare keeps the domain and DNS. Vercel runs the Next.js application on the existing Hobby workspace, independently of the laptop. Supabase remains on Free and stores shared PostgreSQL/PostGIS records and private evidence images. Gemini requests remain separately billed by Google.

## Deployment configuration

- Node.js 24; production build uses the checked-in lockfile.
- Server region: `iad1`.
- Server-only environment variables follow `.env.example`; set `APP_ORIGIN=https://whichbin.fyi`.
- Copy existing database, Supabase Storage and Gemini connection values privately into Vercel environment settings. Never put them in browser variables, source files or a deployment archive.
- Set a separate random `CRON_SECRET` in Vercel. Daily cleanup runs at `/api/cron/cleanup`; it rejects missing or invalid bearer authorization.
- `.vercelignore` excludes local secrets, databases, training data, model weights and generated files from source uploads. Local ONNX experiment assets are not copied during Vercel installation; the production scanner uses Gemini.
- Uploaded bin photos are resized in the browser before sending them. API JSON bodies are capped below the hosting request limit.

## Custom domain

Add `whichbin.fyi` to this Vercel project. Use the exact DNS values Vercel shows for this project in Cloudflare; do not copy an old generic Vercel IP address. Leave Cloudflare nameservers in place. Initially keep the website record DNS-only so Vercel can verify it and issue HTTPS. Preserve unrelated email and verification records.

After verification, make `whichbin.fyi` the production domain. If `www.whichbin.fyi` is added, configure it as a redirect to the root address. Vercel also creates a platform address for deployments; share the custom domain with users.

## Updating and operating

The existing Vercel project is connected to [`amEya911/Bin-There-Done-That`](https://github.com/amEya911/Bin-There-Done-That). Its production branch is **`main`**.

The publishing flow is:

```text
Push to GitHub main
        |
        v
Vercel builds the app automatically
        |
        v
A successful production deployment updates https://whichbin.fyi
```

Cloudflare provides DNS for the custom domain. It points visitors to Vercel and does not need its own repository connection or a second application deployment. Supabase continues to store shared data and private images independently of application deployments.

After pushing, check the project's **Deployments** page in Vercel. Wait for the matching commit to show **Ready** before expecting its changes on the public site. A failed build leaves the previous successful deployment serving the domain. Use the build logs to diagnose failures.

Vercel's GitHub account connection and GitHub app access must remain enabled for this repository. The production branch must remain `main`. The Vercel CLI remains available for explicit manual deployments, but a separate CLI publish is no longer needed for ordinary pushes to `main`.

Keep Gemini, Supabase and database credentials in Vercel's private environment settings; never add them to GitHub. Preview deployments are separate from production and retain their existing access protection. Run relevant checks before pushing application changes.

The dashboard and report endpoints use the existing shared Supabase data. Public report counters exclude resolved and withdrawn observations as before. No live database migration or reimport is needed for this hosting move.

On Vercel, a daily scheduled job removes expired Supabase evidence in bounded batches and expires temporary records. Evidence reads reject expired images immediately, even before physical deletion. Retention, scan quotas and the free-plan usage limits still apply.

Check deployment/build status in Vercel, DNS status in Cloudflare, and data/storage in Supabase. The temporary Cloudflare laptop tunnel is not required after the custom domain is connected successfully.
