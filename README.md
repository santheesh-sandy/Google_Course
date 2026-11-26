# Google Skills Course Registration

A single-page registration portal for Google Skills learning paths, with automatic verification and an admin dashboard.

Open **`index.html`** in a browser (or the GitHub Pages site). The admin area is at `index.html#admin` (or the **Admin login** link in the footer).

## Student registration
- 3-step form: choose a course → personal details (with an optional password) → verify Skills account.
- Background checks while the student types:
  - **Email ID** – format and Gmail rules, typo suggestions (`gmial.com` → `gmail.com`), the email domain must be able to receive mail (DNS lookup of the domain only), disposable addresses are blocked.
  - **Mobile number** – validated with Google's libphonenumber (India by default, other countries with a country code) and saved in one standard format.
  - **Public profile link** – must be a `skills.google/public_profiles/…` link that really opens; the profile name and badge count are shown.
  - **Two screenshots**, each read in the browser (OCR) and checked separately: (1) the **email ID screenshot** must show the registered email ID exactly as typed; (2) the **profile link screenshot** must show the public profile link entered in the form.
- Only fully verified registrations are accepted.
- **One registration per email ID and per public profile link** (any course).

## Admin dashboard
- **Overview** – total registrations, completed, pending, not checked and completion rate, with charts:
  - **Badge completion** – how all registrations split into completed / in progress / not started / not checked
  - **Registrations over time** – per day (or per week for long periods)
  - **Completion by course** – stacked bars per course (or per Google course)
  - **Registrations by Google course** – ranked bars
  - Period filter (all time / last 7, 30, 90 days) that scopes every number and chart, hover / keyboard tooltips, a course summary table, **Export summary** (CSV) and **Print report**.
- **Registrations** – search, filters, review panel with the screenshot, verify / reject, notes, bulk actions, CSV and screenshot ZIP export, duplicate detection and clean-up.
- **Badge check** – upload a CSV (or use registered students); each public profile is read and compared with the skill badges required for the student's course. Results are saved for the Overview.
  - **Course-wise badge summary** – per Google course: students checked / completed / pending / errors, badges earned vs pending and completion %; click a course for each required badge. **Download summary CSV** gives one row per course, one per required badge, and an all-courses total.
- **Settings** – change the admin password, data export, delete all.

## Storage (backend)
**Recommended: Google Sheet + Drive** (works on Indian networks, where `supabase.co` is often blocked)
1. Create a new Google Sheet → **Extensions → Apps Script**, paste all of **`google_apps_script.gs`**, Save.
2. **Deploy → New deployment → Web app** — Execute as: *Me*, Who has access: *Anyone* → Deploy → copy the **Web app URL** (ends with `/exec`).
3. In `index.html` set `var GAS_URL='…/exec';` and publish.

Registrations go to the sheet **Registrations**, both screenshots to the private Drive folder **Course Registration Screenshots**. The admin login is checked by the script (change the password from **Settings**). Badge checks read up to 20 public profiles at a time on Google's servers (fast check).

Other modes: without `GAS_URL` the page uses Supabase if `supabase_setup.sql` has been run, otherwise it saves in the browser only (testing).

**Bulk use:** many students can register at the same moment (screenshots are saved before the sheet is locked, the lock is held for one row only, and a busy server is retried automatically). Badge results, status changes and deletes for hundreds or thousands of students are saved in one or a few calls; admin tables show 300 rows at a time (**Show more**, or search to narrow down). Tested with 500 parallel registrations (with simulated busy server) and 1,200 rows in the admin page.

**Student password (optional):** stored only as a salted SHA-256 hash created in the browser; never shown or exported.

## Security notes
- Change the admin password from **Settings** after first login.
- Never put a Supabase **secret** key in the page.
