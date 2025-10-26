# Manual Assistant

Manual Assistant is a Firebase-powered web application that lets you upload PDF manuals, index them, and chat with the content using Google’s Gemini models. It includes role-based access, manual management, AI-powered Q&A, feedback analytics, and admin tooling to manage manuals and user accounts.

## Features

- Upload PDF manuals to Firebase Storage with automatic text extraction into Firestore.
- Ask Gemini questions across any or all uploaded manuals with detailed, sourced answers.
- Role-aware UI: admins can upload/delete manuals, manage Gemini settings, review analytics, and control user accounts (disable/delete).
- Authentication backed by Firebase Auth (email & password) with automatic admin promotion for the first `admin@manual.app` account.

## Prerequisites

- Node.js 18 or newer.
- npm 9 or newer.
- Firebase CLI (`npm install -g firebase-tools`).
- A Google Cloud project with billing enabled (required to call Gemini APIs).

## 1. Create and configure your Firebase project

1. Sign in to the [Firebase Console](https://console.firebase.google.com/) and create a new project.
2. In **Build → Authentication**, enable the **Email/Password** sign-in method.
3. In **Build → Firestore**, create a database in production mode (us-central is recommended to match the default Cloud Functions region).
4. In **Build → Storage**, create a bucket (keep the default security rules for now—we will deploy the project’s custom rules in a later step).
5. In **Build → Functions**, ensure that Cloud Functions is enabled for the project.

## 2. Register a web app and copy your config

1. From your Firebase project overview, click **Add app → Web**.
2. Register an app name (hosting is optional) and copy the generated `firebaseConfig` object.
3. Replace the contents of `firebase-config.js` in this repo with your project’s config values.

```javascript
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT",
    storageBucket: "YOUR_PROJECT.firebasestorage.app",
    messagingSenderId: "…",
    appId: "…",
    measurementId: "…"
};
```

## 3. Point the Firebase CLI at your project

Runs once per machine:

```bash
firebase login
firebase use --add
# select the project you created and alias it as "default"
```

This updates `.firebaserc` to reference your project ID.

## 4. Install dependencies

```bash
cd manual_assistant
cd functions
npm install
cd ..
```

## 5. Configure Cloud Functions environment

The backend login function requires your Web API key, and you can optionally define a default Gemini model.

```bash
# Run from the repository root
firebase functions:env:set PROJECT_WEB_API_KEY="YOUR_WEB_API_KEY"
# Optional override (falls back to gemini-1.5-pro-latest)
firebase functions:env:set GEMINI_MODEL="gemini-1.5-pro-latest"
```

> **Tip:** You can retrieve the Web API key from **Project settings → General → Your apps → Web API Key**.

## 6. Deploy Firebase resources

Ensure you are in the repository root, then run:

```bash
firebase deploy
```

This uploads:

- Cloud Functions (`login`, `logout`, `processSignUp`, `queryGemini`, `listUsers`, `setUserDisabledStatus`, `deleteUser`).
- Firestore and Storage security rules.
- Hosting assets in `public/` (the single-page app).

## 7. First-time application setup

1. Visit your Hosting URL (shown after deploy) and register the `admin@manual.app` account. The function `processSignUp` automatically grants this email admin privileges. You can change this default email inside `functions/index.js` before deploying if desired.
2. Sign in as the admin, open the **Settings** modal, and provide:
     - Gemini API key (generate one at [Google AI Studio](https://aistudio.google.com/app/apikey)).
     - Optional operator email (used for escalation links).
     - Optional Gemini model alias (defaults to `gemini-1.5-pro-latest`).
3. Upload your first PDF manual via the **Upload** panel. The app extracts the text and stores it in Firestore so the AI can use it.

## 8. Ongoing admin tasks

- **Manual management:** Use the left panel to upload new PDFs or delete existing ones. Deleting removes the file from Storage and the corresponding Firestore document.
- **User management:** Click the **Manage Users** icon to view current accounts, disable/enable access, or permanently delete users. You cannot modify your own account from the UI.
- **Feedback analytics:** Review AI response feedback in the **Analytics** modal.
- **Settings:** Update the Gemini API key, operator email, or model name at any time. Changes are stored in Firestore and take effect immediately.

## Testing changes locally

To test Cloud Functions without deploying, use Firebase emulators:

```bash
firebase emulators:start
```

This starts local emulators for Functions, Firestore, and Hosting. You will still need valid API credentials for Gemini if you want to test AI calls; set them via `firebase functions:env:set` as described earlier.

## Troubleshooting

- **Login fails with “Web API key is not configured”:** Re-run `firebase functions:env:get` and ensure `PROJECT_WEB_API_KEY` is present. Redeploy after setting it.
- **Gemini errors about missing models:** Update the model name in the Settings modal to a supported alias (for example, `gemini-1.5-pro-latest`).
- **Uploads fail with `storage/unauthorized`:** Confirm you deployed `storage.rules` and that you are signed in with an admin account.
- **Cannot manage users:** Only accounts with the `admin` custom claim (granted automatically to `admin@manual.app`) may call the user-management functions. Sign out/in after changing admin status to refresh tokens.

Happy building!
