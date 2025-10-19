const {onRequest, onCall, HttpsError} = require("firebase-functions/v2/https");
const {setGlobalOptions} = require("firebase-functions/v2");
const admin = require("firebase-admin");
const axios = require("axios");
const logger = require("firebase-functions/logger");

// Initialize Firebase Admin SDK ONCE.
admin.initializeApp();
setGlobalOptions({maxInstances: 10});

// --- Authentication Cloud Functions ---

/**
 * Exchanges a username and password for an ID token and creates a session cookie.
 */
exports.login = onRequest(async (req, res) => {
  // Access config inside the function
  const webApiKey = process.env.PROJECT_WEB_API_KEY;
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).send("Email and password are required.");
  }

  try {
    const signInResponse = await axios.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${webApiKey}`,
      { email, password, returnSecureToken: true }
    );

    const idToken = signInResponse.data.idToken;
    const expiresIn = 60 * 60 * 24 * 5 * 1000; // 5 days
    const sessionCookie = await admin.auth().createSessionCookie(idToken, { expiresIn });
    
    const options = { maxAge: expiresIn, httpOnly: true, secure: true };
    res.cookie("__session", sessionCookie, options);
    return res.status(200).json({ status: "success" });

  } catch (error) {
    logger.error("Login failed:", error);
    return res.status(401).send("UNAUTHORIZED REQUEST!");
  }
});

/**
 * Clears the session cookie on logout.
 */
exports.logout = onRequest((req, res) => {
  res.clearCookie("__session");
  res.redirect("/");
});

/**
 * Triggered on new user creation to assign an admin role based on email.
 */
exports.processSignUp = require("firebase-functions/v1").auth.user().onCreate(async (user) => {
    if (user.email === 'admin@manual.app') {
        try {
        await admin.auth().setCustomUserClaims(user.uid, { admin: true });
        logger.log(`Successfully set admin claim for user: ${user.email}`);
        } catch (error) {
        logger.error(`Failed to set admin claim for ${user.email}`, error);
        }
    }
});


// --- Callable Cloud Function for Gemini API ---

/**
 * A callable function to query the Gemini API with manual text.
 */
exports.queryGemini = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
  }

  // 1. Read the API key from Firestore
  let geminiApiKey;
  try {
    const settingsDoc = await admin.firestore().collection('settings').doc('config').get();
    if (settingsDoc.exists) {
      geminiApiKey = settingsDoc.data().apiKey;
    }
  } catch (error) {
    logger.error("Failed to read settings from Firestore:", error);
    throw new HttpsError("internal", "Could not retrieve API key from settings.");
  }

  if (!geminiApiKey) {
    logger.error("Gemini API key is not configured in Firestore settings.");
    throw new HttpsError("failed-precondition", "The application is not configured correctly. Missing Gemini API key in settings.");
  }

  const { manualText, userQuery } = request.data;
  if (!manualText || !userQuery) {
    throw new HttpsError("invalid-argument", "Missing 'manualText' or 'userQuery' parameters.");
  }

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-preview-0514:generateContent?key=${geminiApiKey}`;
  const systemPrompt = `You are an expert assistant for technical manuals. Answer the user's question based *only* on the provided manual text. First, give a single, concise sentence answer. Then, add the separator '***'. After the separator, provide a detailed explanation. If the answer isn't in the manual, respond with only: "I could not find the answer in the provided manual."`;

  const payload = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ parts: [{ text: `MANUAL TEXT:\n---\n${manualText}\n---\n\nQUESTION: ${userQuery}` }] }],
  };

  try {
    const geminiResponse = await axios.post(apiUrl, payload, { headers: { "Content-Type": "application/json" } });
    const text = geminiResponse.data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      throw new HttpsError("internal", "Invalid API response structure from Gemini.");
    }

    const parts = text.split("***");
    const formattedResponse = parts.length > 1
        ? { short: parts[0].trim().replace(/\n/g, "<br>"), detailed: parts[1].trim().replace(/\n/g, "<br>") }
        : { short: text.trim().replace(/\n/g, "<br>") };

    return formattedResponse;
  } catch (error) {
    logger.error("Error querying Gemini:", error.response ? error.response.data : error.message);
    throw new HttpsError("internal", "An error occurred while querying the AI service.");
  }
});