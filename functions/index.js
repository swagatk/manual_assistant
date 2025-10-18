const functions = require("firebase-functions");
const cors = require("cors")({ origin: true });
const axios = require("axios");

exports.queryGemini = functions.https.onRequest((request, response) => {
  cors(request, response, async () => {
    if (request.method !== "POST") {
      return response.status(405).send("Method Not Allowed");
    }

    // The Gemini API key is retrieved from secure environment configuration, not from the request body.
    const apiKey = functions.config().gemini.key;
    const { manualText, userQuery } = request.body;

    if (!manualText || !userQuery) {
      return response.status(400).send("Missing required parameters.");
    }
    if (!apiKey) {
      console.error("Gemini API key is not configured.");
      return response.status(500).send("The application is not configured correctly.");
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
        throw new Error("Invalid API response structure");
      }

      const parts = text.split("***");
      const formattedResponse =
        parts.length > 1
          ? {
              short: parts[0].trim().replace(/\n/g, "<br>"),
              detailed: parts[1].trim().replace(/\n/g, "<br>"),
            }
          : { short: text.trim().replace(/\n/g, "<br>") };

      return response.status(200).send(formattedResponse);
    } catch (error) {
      console.error("Error querying Gemini:", error);
      if (error.response) {
        console.error("Gemini API Error Response:", error.response.data);
      }
      return response.status(500).send("An error occurred while querying the AI service.");
    }
  });
});