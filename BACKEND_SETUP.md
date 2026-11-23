# Form Fill Mitra - backend setup and deployment checklist

## Architecture
- Firebase Authentication: identity verification.
- Render API: role checks and protected data access.
- Firestore: profiles, forms, applications, clients, document metadata, and auditLogs.
- Firebase Storage: private application documents; all reads and writes go through the authenticated Render API.
- Firebase Hosting: static frontend.

## Required Render environment variable
Set `FIREBASE_SERVICE_ACCOUNT_JSON` to the complete service-account JSON for the **form-fill-mitra** Firebase project. Store it only in Render Environment; never commit it or expose it in frontend code. The service account needs Firebase Authentication user lookup, Firestore read/write, and Google Cloud Storage object read/write permissions. Set `FIREBASE_STORAGE_BUCKET` to `form-fill-mitra.firebasestorage.app` (the bucket shown in `firebase-config.js`). Restart/redeploy the Render service after changing either value.

Create/enable the Firebase Storage bucket in Firebase Console → Build → Storage. In Google Cloud Console → IAM, ensure the service-account email from the JSON has **Storage Object Admin** access to this bucket. Do not make the bucket public. The API streams files only after checking the signed-in user, application ownership, and staff assignment.

## Deploy
1. Push/pull the repository's main branch.
2. Deploy the Render backend first.
3. Check `https://form-fill-mitra-api.onrender.com/health`. It must report `firebaseAdminConfigured: true`, `database: "connected"`, and `storage: "connected"`.
4. Deploy Firebase Hosting.
5. Test with a verified admin account and separate personal, professional, and staff accounts.

## Firestore
The existing `firestore.rules` remains default-deny for browser clients. The API uses Firebase Admin on the server. Do not loosen Firestore rules to make browser writes work.

## Document handling
- Application documents are uploaded to the private `private-applications/` Storage prefix through the authenticated API. Firestore stores metadata only; the API never returns public bucket URLs.
- The applicant, administrator, or staff assigned to that application can list/download documents. Applicants can delete documents while the application is not approved/completed; administrators can delete them.
- The frontend asks for explicit consent before uploading documents. File uploads are limited to PDF/JPEG/PNG/WEBP and 10 MB per file. Review these limits against the actual services you intend to support.

## Important production gaps before accepting real government applications
- Confirm `storage: "connected"` on the health endpoint and test upload, download, unauthorized access denial, and deletion with separate personal, professional, admin, and staff accounts.
- Configure a secure staff invitation/onboarding process and test account role transitions.
- Add a payment gateway only after server-side order creation, signature verification, refunds, and webhook verification are implemented.
- Add retention/deletion policy, consent capture, privacy notice, backups, monitoring, and security review.
- Do not store passwords, OTPs, or full payment card details.
- Current application API stores submitted applicant text and answers in Firestore; restrict project console access to trusted operators.
