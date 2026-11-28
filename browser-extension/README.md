# Form Fill Mitra Portal Autofill (prototype)

This is a user-controlled Chromium extension prototype for transferring an application from Form Fill Mitra and matching visible fields on an official portal.

## Install for testing
1. Use desktop Chrome or another Chromium browser with Manifest V3 extension support. Chrome on Android generally cannot install this unpacked extension.
2. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
3. Select this `browser-extension` folder.
4. Sign in to Form Fill Mitra in the same browser, complete the application and Final Review.
5. Final Review hands off the application locally and opens the selected official portal.
6. On the portal, click the extension and choose **Fill & Verify This Portal**. The browser asks permission for that portal origin; grant only if the page is the official site you intended.
7. After permission is granted, future navigation to the exact selected portal origin can trigger autofill automatically. Redirects to a different origin require the user to open the extension and approve that site manually.

## Data flow
- Final Review sends applicant details, answers, and admin-defined field descriptors to the extension content script on the Form Fill Mitra origin.
- The extension stores the handoff in local `chrome.storage.local`; it expires after 3 hours.
- On the official portal, the extension reads visible controls, matches labels/keys, fills values, and re-reads values from the page to compare against the intended data.
- The report distinguishes filled, verified, mismatched, required-unmatched, and browser-validation warning counts.
- **Clear Saved Application** removes the stored handoff from extension storage.

## Safety and limitations
- This is a heuristic field matcher, not a guarantee or a universally AI-aware portal integration.
- Matching uses visible labels, names, IDs, placeholders, common Hindi/English aliases, and admin-defined field keys. Unusual labels, masked fields, iframes, custom widgets, and dependent dropdowns may need portal-specific mapping.
- It never clicks final submit and does not automate CAPTCHA, OTP, e-sign, payment, or access controls.
- Review every field on the official portal before continuing.
- Applicant data is sensitive. Use a trusted private browser profile and clear extension data after use. Extension storage is not encrypted by the Form Fill Mitra account password.
- Do not test with real identity documents until the client has reviewed and accepted the prototype.
- This extension is not published to the Chrome Web Store and is not part of the live website deployment.
