const functions = require("firebase-functions");
const axios = require("axios");

exports.queryGemini = functions.https.onCall(async (data, context) => {
  // Check if the user is authenticated.
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "The function must be called while authenticated."
    );
  }

  // The Gemini API key is retrieved from secure environment configuration.
  const apiKey = functions.config().gemini.key;
  const { manualText, userQuery } = data;

  if (!manualText || !userQuery) {
    throw new functions.https.HttpsError("invalid-argument", "Missing required parameters.");
  }
  if (!apiKey) {
    console.error("Gemini API key is not configured.");
    throw new functions.httpss.HttpsError("failed-precondition", "The application is not configured correctly.");
  }
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-preview-0514:generateContent?key=${apiKey}`;
  const systemPrompt = `You are an expert assistant for technical manuals. Answer the user's question based *only* on the provided manual text. First, give a single, concise sentence answer. Then, add the separator '***'. After the separator, provide a detailed explanation. If the answer isn't in the manual, respond with only: "I could not find the answer in the provided manual."`;

  const payload = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [
      {
        parts: [
          { text: `MANUAL TEXT:\n---\n${manualText}\n---\n\nQUESTION: ${userQuery}` },
        ],
      },
    ],
  };

  try {
    const geminiResponse = await axios.post(apiUrl, payload, {
      headers: { "Content-Type": "application/json" },
    });

    const text = geminiResponse.data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      throw new functions.https.HttpsError("internal", "Invalid API response structure from Gemini.");
    }

    const parts = text.split("***");
    const formattedResponse =
      parts.length > 1
        ? {
            short: parts[0].trim().replace(/\n/g, "<br>"),
            detailed: parts[1].trim().replace(/\n/g, "<br>"),
          }
        : { short: text.trim().replace(/\n/g, "<br>") };

    // Return the data to the client.
    return formattedResponse;
  } catch (error) {
    console.error("Error querying Gemini:", error);
    if (error.response) {
      console.error("Gemini API Error Response:", error.response.data);
    }
    throw new functions.httpss.HttpsError("internal", "An error occurred while querying the AI service.");
  }
});