# PDL Website & Business Portal

## Included
- Existing PDL public website and visual assets.
- Quote / customer enquiry submission.
- Career application form with optional CV attachment.
- Transport partner registration with optional supporting document.
- Private administration dashboard at `/admin`.
- SQLite database for submissions and admin sessions.
- Status updates, internal notes, filtering and attachment download.

## Requirements
- Node.js 20 or newer.
- A hosting environment that supports a persistent Node.js process and writable disk storage.
- HTTPS for production.

## Run locally
1. Extract this folder.
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env`.
4. Set a unique `SESSION_SECRET`, `ADMIN_USERNAME`, and a strong `ADMIN_PASSWORD` (at least 14 characters).
5. Start: `npm start`
6. Open `http://localhost:3000` for the website.
7. Open `http://localhost:3000/admin` for the admin dashboard.

## Data and uploads
- SQLite database and private uploads are stored under `data/`.
- Uploaded documents are not exposed as public static files; downloads require an authenticated admin session.
- Back up the `data/` folder regularly and restrict server access.
- Do not delete `data/` when deploying updates if you need to preserve submissions.

## Important production checklist
- Deploy behind HTTPS.
- Use a strong unique admin password and long random session secret.
- Keep `.env`, `data/`, and uploaded documents out of public web access and source control.
- Set up automated backups and retention/deletion rules for applicant and partner data.
- Publish a privacy notice explaining what information is collected, why it is used, who can access it, and how long it is retained.
- Configure an email notification provider if you want instant alerts; submissions are stored in the dashboard by default.
- Test file upload limits, access control, and backups before accepting real applications.
- Confirm applicable Singapore privacy obligations and operational policies before launch.

## Current limitations
- This package does not include an email/SMS sending service. Submissions are recorded in the admin dashboard; notification emails can be added after an email provider is selected.
- It is a deployable starter, not yet hosted or connected to a live domain.
- SQLite is suitable for a modest initial workload on one persistent server. Hosting architecture should be reviewed if PDL expands to multiple app instances or higher volume.

- Added required consent checkboxes to the three public forms and a draft privacy notice at `/privacy.html`. PDL must review and approve the notice before launch.
