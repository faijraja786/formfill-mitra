# Form Fill Mitra - backend setup and deployment checklist

## Architecture
- Firebase Authentication: applicant and staff identity verification.
- Render API: verifies Firebase ID tokens, enforces roles, application ownership and staff assignment.
- Firestore: profiles, form catalogue, applications, clients, document metadata, and audit logs.
- Supabase Storage: private applicant document objects in the dedicated `Form Fill Mitra` project.
- Firebase Hosting: static frontend.

## Required Render environment variables
- `FIREBASE_SERVICE_ACCOUNT_JSON`: complete service-account JSON for the **form-fill-mitra** Firebase project. Keep it only in Render Environment. It needs Firebase Authentication user lookup and Firestore read/write permissions; Firebase Storage permissions are no longer required.
- `SUPABASE_URL`: `https://bkstbrwkmmtirfjmtzxs.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase server-side secret/service-role key for the dedicated Form Fill Mitra project. Add it directly in Render Environment; never paste it into chat, commit it, or expose it in frontend code. A publishable/anon key is not sufficient for this server-only document workflow.

## Supabase Storage
- Dedicated project: `Form Fill Mitra` (`bkstbrwkmmtirfjmtzxs`), region `ap-south-1`.
- Private bucket: `applicant-documents`.
- Allowed types: PDF, JPEG, PNG, WEBP. Maximum file size: 10 MB.
- Objects are stored under `private-applications/{applicationId}/{uuid}.{ext}`.
- The browser never receives a Supabase secret key or public document URL. All uploads, downloads and deletions pass through Render after Firebase token verification and `applicationAccess` authorization.
- Firestore stores metadata only; the actual document bytes are stored in Supabase Storage.
- The bucket is private. Do not make it public or add permissive `anon` policies.

## Deploy
1. Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the existing Render API service Environment page. Preserve all existing Firebase variables.
2. Render should deploy automatically after the GitHub commit. Wait for the deploy to finish.
3. Check `https://form-fill-mitra-api.onrender.com/health`. It must report `firebaseAdminConfigured: true`, `database: "connected"`, and `storage: "connected"`.
4. Deploy Firebase Hosting only; Firebase Storage is not used:
   `firebase deploy --only hosting`
5. Test with dummy files and separate verified Personal, Professional, Admin and assigned Staff accounts. Confirm upload, list, download, delete rules, and denial for unrelated accounts.

## Privacy and production readiness
- Use dummy documents until all access-control tests pass.
- Keep Firestore rules default-deny for browser clients. The Render API uses Firebase Admin.
- Do not store passwords, OTPs, or full payment card details.
- Add retention/deletion policy, consent capture, privacy notice, backups for Storage objects, monitoring, quota alerts and an independent security review before accepting real government-form documents.
- Supabase database backups do not back up Storage object files; configure a separate object backup process.
- The current Free plan includes only 1 GB of Storage. It is for testing, not the planned 5,000-applicant workload. Do not upgrade or enable billing without guardian approval.
- Completing Form Fill Mitra review does not itself submit an application to a government portal. Applicants must complete the official portal process and retain its acknowledgement.
