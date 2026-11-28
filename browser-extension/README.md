# Form Fill Mitra Portal Autofill (prototype)

This is a user-triggered Chromium extension prototype for transferring the current application from Form Fill Mitra and matching visible portal fields.

## Install for testing
1. Use desktop Chrome or another Chromium browser that supports Manifest V3 extensions. Chrome on Android generally does not support installing this unpacked extension.
2. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
3. Select this `browser-extension` folder.
4. Sign in to Form Fill Mitra in the same browser, complete the application and Final Review, then open the official portal.
5. Open the extension popup and click **Fill & Verify This Portal**.
6. Review the report and every field manually. The extension does not submit the form.

## Data flow
- Final Review sends applicant details, current form answers, and admin-defined field descriptors to the extension content script on the Form Fill Mitra origin.
- The extension stores the handoff locally in `chrome.storage.local`.
- On the official portal, the user explicitly clicks the extension action. The extension reads visible controls, matches labels/keys, fills values, then checks the resulting DOM values.
- **Clear Saved Application** removes the stored handoff from extension storage.

## Safety and limitations
- This is an experimental field matcher, not an AI guarantee or universal portal integration.
- It uses visible label/name/ID/placeholder matching and common Hindi/English aliases. Unusual portal labels, masked fields, iframe-based forms, custom widgets, and dependent dropdowns may not work reliably.
- It does not automate CAPTCHA, OTP, e-sign, payment, or submission.
- Never use it to bypass portal access controls. Verify every value on the official portal before continuing.
- Applicant data is sensitive. Use a trusted, private browser profile; clear the extension data after use. Extension storage is not encrypted by the user's Form Fill Mitra password.
- Do not test with real identity documents until the client has reviewed and explicitly accepted this prototype.
- This extension is not yet published to the Chrome Web Store and is not included in the live website deployment.
