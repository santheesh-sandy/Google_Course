# Google Skills Course Registration

A single-page registration portal for Google Skills learning paths, with automatic verification and an admin dashboard.

Open **`index.html`** in a browser (or the GitHub Pages site). The admin area is at `index.html#admin` (or the **Admin login** link in the footer).

## Student registration
- 3-step form: choose a course → personal details → verify Skills account.
- Background checks while the student types:
  - **Email ID** – format and Gmail rules, typo suggestions (`gmial.com` → `gmail.com`), the email domain must be able to receive mail (DNS lookup of the domain only), disposable addresses are blocked.
  - **Mobile number** – validated with Google's libphonenumber (India by default, other countries with a country code) and saved in one standard format.
  - **Public profile link** – must be a `skills.google/public_profiles/…` link that really opens; the profile name and badge count are shown.
  - **Screenshot** – read in the browser (OCR): one screenshot of the Skills **Account settings** page must show the registered email ID (exactly the one typed in the form) and the public profile link entered in the form.
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

## Storage
- Works out of the box by saving in the browser.
- Saves online automatically once the Supabase project is set up: run **`supabase_setup.sql`** in the Supabase SQL Editor (after creating the admin user and putting its email at the bottom of the script). The page uses only the Supabase **publishable** key; database rules allow students to add registrations only, and only listed admins can read or change data.

## Security notes
- Change the admin password from **Settings** after first login.
- Never put a Supabase **secret** key in the page.
