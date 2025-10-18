# Manual Assistant

This is a web-based application that allows you to upload and chat with your PDF manuals using Google's Gemini AI. It features user authentication, role-based access (Admin/User), and feedback analytics.

## Setup

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/your-username/manual-assistant.git
    cd manual-assistant
    ```

2.  **Firebase Project Setup:**
    - Create a new project in the [Firebase Console](https://console.firebase.google.com/).
    - Add a new Web App to your project.
    - Copy the `firebaseConfig` object provided during the setup.

3.  **Enable Firebase Services:**
    - In the Firebase Console, enable **Authentication** (with Email/Password provider), **Firestore**, and **Storage**.

4.  **Set up Firebase Functions & Hosting:**
    - Install the Firebase CLI: `npm install -g firebase-tools`
    - Login to Firebase: `firebase login`
    - Inside the `functions` directory, run `npm install`.
    - Set your Gemini API key as an environment variable for the function. **Do not hardcode it!**
      ```bash
      firebase functions:config:set gemini.key="YOUR_GEMINI_API_KEY"
      ```

5.  **Deploy the Application:**
    - Run the deploy command from the root of your project:
      ```bash
      firebase deploy
      ```
    - This will deploy both your Cloud Function and the website to Firebase Hosting. The first user to register with the email `admin@manual.app` will be granted admin privileges.
