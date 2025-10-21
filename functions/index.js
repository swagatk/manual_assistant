const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const functionsV1 = require("firebase-functions/v1");
const admin = require("firebase-admin");
const axios = require("axios");
const logger = require("firebase-functions/logger");

admin.initializeApp();
setGlobalOptions({ maxInstances: 10 });

const DEFAULT_GEMINI_MODEL = "gemini-1.5-pro-latest";
const MAX_MANUAL_CHARS = 120000;

const MODEL_ALIAS_MAP = {
  "gemini-1.5-flash-preview-0514": "gemini-1.5-flash-latest",
  "gemini-1.5-flash-preview": "gemini-1.5-flash-latest",
  "gemini-1.5-pro-preview-0514": "gemini-1.5-pro-latest",
  "gemini-1.5-pro-preview": "gemini-1.5-pro-latest",
};

function resolveModelName(rawModel) {
  const trimmed = (rawModel || "").trim();
  if (!trimmed) {
    return DEFAULT_GEMINI_MODEL;
  }
  if (MODEL_ALIAS_MAP[trimmed]) {
    logger.log(`Using fallback model for deprecated alias '${trimmed}'.`);
    return MODEL_ALIAS_MAP[trimmed];
  }
  if (!trimmed.startsWith("gemini-")) {
    logger.warn(`Invalid Gemini model '${trimmed}' supplied. Falling back to default.`);
    return DEFAULT_GEMINI_MODEL;
  }
  return trimmed;
}

exports.login = onRequest(async (req, res) => {
  const webApiKey = process.env.PROJECT_WEB_API_KEY || process.env.WEB_API_KEY;
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).send("Email and password are required.");
  }
  if (!webApiKey) {
    logger.error("PROJECT_WEB_API_KEY environment variable is not set.");
    return res.status(500).send("Web API key is not configured.");
  }

  try {
    const signInResponse = await axios.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(webApiKey)}`,
      { email, password, returnSecureToken: true },
      { headers: { "Content-Type": "application/json" }, timeout: 15000 }
    );

    const { idToken } = signInResponse.data;
    const expiresIn = 60 * 60 * 24 * 5 * 1000;
    const sessionCookie = await admin.auth().createSessionCookie(idToken, { expiresIn });

    res.cookie("__session", sessionCookie, { maxAge: expiresIn, httpOnly: true, secure: true });
    return res.status(200).json({ status: "success" });
  } catch (error) {
    const errorMessage = error?.response?.data?.error?.message || error.message;
    logger.error("Login failed:", errorMessage);
    return res.status(401).send("UNAUTHORIZED REQUEST!");
  }
});

exports.logout = onRequest((req, res) => {
  res.clearCookie("__session");
  res.redirect("/");
});

exports.processSignUp = functionsV1.auth.user().onCreate(async (user) => {
  if (user.email === "admin@manual.app") {
    try {
      await admin.auth().setCustomUserClaims(user.uid, { admin: true });
      logger.log(`Successfully set admin claim for user: ${user.email}`);
    } catch (error) {
      logger.error(`Failed to set admin claim for ${user.email}`, error);
    }
  }
});

// Force redeploy
exports.queryGemini = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
  }

  const { manualText, userQuery } = request.data || {};
  if (typeof manualText !== "string" || manualText.trim().length === 0) {
    throw new HttpsError("invalid-argument", "Manual text is required to answer this question.");
  }
  if (typeof userQuery !== "string" || userQuery.trim().length === 0) {
    throw new HttpsError("invalid-argument", "A user question is required.");
  }

  let settingsData = {};
  try {
    const settingsDoc = await admin.firestore().collection("settings").doc("config").get();
    if (settingsDoc.exists) {
      settingsData = settingsDoc.data() || {};
    }
  } catch (error) {
    logger.error("Failed to read settings from Firestore:", error);
    throw new HttpsError("internal", "Unable to load application settings. Please try again.");
  }

  const geminiApiKey = (settingsData.apiKey || "").trim();
  const rawModel = settingsData.model || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const configuredModel = resolveModelName(rawModel);

  if (!geminiApiKey) {
    throw new HttpsError("failed-precondition", "Gemini API key has not been configured yet. Please add it in Settings.");
  }

  const normalizedManual = manualText.trim();
  const truncatedManual =
    normalizedManual.length > MAX_MANUAL_CHARS
      ? `${normalizedManual.slice(0, MAX_MANUAL_CHARS)}\n\n[Manual truncated for length]`
      : normalizedManual;

  const systemPrompt =
    "You are an expert assistant for technical manuals. Answer the user's question based only on the provided manual text. " +
    "First, provide a single concise sentence answer. Then add the separator '***'. After the separator, provide a detailed explanation. " +
    'If the answer is not present in the manual, respond with only: "I could not find the answer in the provided manual."';

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    configuredModel
  )}:generateContent?key=${encodeURIComponent(geminiApiKey)}`;

  const payload = {
    systemInstruction: {
      role: "system",
      parts: [{ text: systemPrompt }],
    },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `REFERENCE MANUAL (may be truncated to ${MAX_MANUAL_CHARS} characters):\n${truncatedManual}\n\nQUESTION: ${userQuery.trim()}`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.3,
      topP: 0.9,
      topK: 40,
      maxOutputTokens: 2048,
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    ],
  };

  try {
    const response = await axios.post(apiUrl, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 30000,
    });

    const candidate = response.data?.candidates?.[0];
    const combinedText = candidate?.content?.parts?.map((part) => part.text || "").join("\n");

    if (!combinedText) {
      throw new HttpsError("internal", "The AI service returned an empty response.");
    }

    const [shortPart, detailedPart] = combinedText.split("***");
    const formattedResponse = {
      short: (shortPart || combinedText).trim().replace(/\n/g, "<br>"),
    };

    if (detailedPart) {
      formattedResponse.detailed = detailedPart.trim().replace(/\n/g, "<br>");
    }

    return formattedResponse;
  } catch (error) {
    const apiError = error?.response?.data?.error;
    const apiErrorMessage = apiError?.message || error.message || "Unexpected error calling Gemini.";

    if (apiError?.code === 404 || apiError?.code === 400) {
      logger.error("Gemini model not found or invalid:", apiErrorMessage, {
        requestedModel: rawModel,
        resolvedModel: configuredModel,
      });
      throw new HttpsError(
        "failed-precondition",
        "Gemini model is unavailable. Please update the model name in Settings."
      );
    }

    logger.error("Error querying Gemini:", apiErrorMessage, {
      responseData: error?.response?.data,
    });
    throw new HttpsError("internal", `Gemini API error: ${apiErrorMessage}`);
  }
});