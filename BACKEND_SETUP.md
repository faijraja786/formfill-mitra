# Form Fill Mitra - backend setup and deployment checklist

## Architecture
- Firebase Authentication: identity verification.
- Render API: role checks and protected data access.
- Firestore: profiles, forms, applications, clients, and auditLogs.
- Firebase Hosting: static frontend.

## Required Render environment variable
Set `FIREBASE_SERVICE_ACCOUNT_JSON` to the complete service-account JSON for the **form-fill-mitra** Firebase project. Store it only in Render Environment; never commit it or expose it in frontend code. The service account needs Firebase Authentication user lookup and Firestore read/write permissions. Restart/redeploy the Render service after adding it.

## Deploy
1. Push/pull the repository's main branch.
2. Deploy the Render backend first.
3. Check `https://form-fill-mitra-api.onrender.com/health`. It must report `firebaseAdminConfigured: true`.
4. Deploy Firebase Hosting.
5. Test with a verified admin account and separate personal, professional, and staff accounts.

## Firestore
The existing `firestore.rules` remains default-deny for browser clients. The API uses Firebase Admin on the server. Do not loosen Firestore rules to make browser writes work.

## Important production gaps before accepting real government applications
- Configure private file storage and scoped download URLs before collecting Aadhaar, certificates, photos, signatures, or other sensitive files. Current API does not upload or expose private files.
- Configure a secure staff invitation/onboarding process and test account role transitions.
- Add a payment gateway only after server-side order creation, signature verification, refunds, and webhook verification are implemented.
- Add retention/deletion policy, consent capture, privacy notice, backups, monitoring, and security review.
- Do not store passwords, OTPs, or full payment card details.
- Current application API stores submitted applicant text and answers in Firestore; restrict project console access to trusted operators.
