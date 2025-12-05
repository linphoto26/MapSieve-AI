import { GoogleGenAI, GenerateContentResponse, Chat } from "@google/genai";
import { AnalysisResult, CategoryType, Place } from "../types";

const API_KEY = "AIzaSyCiNjqeW2cYGTE8ViQDcz3_XfQUFJ0EngU";

// Lazy initialization helper
const getAiClient = () => {
  if (!API_KEY) {
    throw new Error("API Key is missing.");
  }
  return new GoogleGenAI({ apiKey: API_KEY });
};

/**
 * Helper to safely extract and parse JSON from AI response text.
 */
const cleanAndParseJSON = (text: string): AnalysisResult => {
  try {
    return JSON.parse(text);
  } catch (e) {
    let cleaned = text.replace(/^```(json)?/, "").replace(/```$/, "").trim();
    try {
      return JSON.parse(cleaned);
    } catch (e2) {
      const firstBrace = text.indexOf('{');
      const lastBrace = text.lastIndexOf('}');
      
      if (firstBrace !== -1 && lastBrace !== -1) {
        const jsonCandidate = text.substring(firstBrace, lastBrace + 1);
        try {
          return JSON.parse(jsonCandidate);
        } catch (e3) {
          throw new Error("JSON structure is malformed.");
        }
      }
      throw new Error("No JSON object found in response.");
    }
  }
};

/**
 * Retry operation helper for handling transient 5xx errors.
 */
async function retryOperation<T>(
  operation: () => Promise<T>, 
  retries = 3, 
  delay = 1000
): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    const status = error.status || error?.error?.code || error?.error?.status;
    const message = error.message || error?.error?.message || '';
    
    const isRetryable = 
      status === 500 || 
      status === 503 || 
      status === 'INTERNAL' ||
      (typeof message === 'string' && (
        message.includes('Internal error') || 
        message.includes('500') || 
        message.includes('503') || 
        message.includes('Overloaded') || 
        message.includes('capacity')
      ));
    
    if (retries <= 0 || !isRetryable) {
      throw error;
    }
    
    console.warn(`Gemini API Error (${status || message}). Retrying... ${retries} attempts left.`);
    await new Promise(resolve => setTimeout(resolve, delay));
    return retryOperation(operation, retries - 1, delay * 2);
  }
}

const JSON_STRUCTURE_PROMPT = `
    RETURN JSON ONLY. No markdown, no conversational text.
    Structure:
    {
      "summary": "string (One sentence summary in Traditional Chinese)",
      "places": [
        {
          "name": "string (Full specific name, e.g. 'Starbucks Shibuya Tsutaya')",
          "category": "FOOD" | "DRINK" | "SIGHTSEEING" | "SHOPPING" | "ACTIVITY" | "LODGING" | "OTHER",
          "subCategory": "string (e.g. 拉麵店)",
          "description": "string (CRITICAL: Extract the AUTHOR'S SPECIFIC REASON for recommending this. Why did they like it? e.g. 'The broth is rich and creamy', 'Best view of the sunset', 'Quiet spot for reading'. Do NOT write generic descriptions like 'A popular restaurant'.)",
          "ratingPrediction": number (1-5),
          "priceLevel": "Free" | "$" | "$$" | "$$$" | "$$$$" | "Unknown",
          "tags": ["string (Keywords from the review, e.g. 'Quiet', 'Scenic', 'Spicy')"],
          "locationGuess": "string (Strict format: 'City District' e.g. '台北市 信義區'. MUST use a space separator.)",
          "address": "string (Full specific address if available, otherwise null)",
          "openingHours": "string (e.g. 'Mon-Sun 10:00-22:00' or 'Unknown')",
          "coordinates": { "lat": number, "lng": number },
          "googleMapsUri": "string (LEAVE EMPTY unless you have a GROUNDED Google Maps URL.)",
          "imageUri": "string (URL of an image representing this place or null)",
          "websiteUri": "string (URL to official website or blog link, or null)"
        }
      ]
    }
`;

export const createChatSession = (places: Place[]): Chat => {
    const ai = getAiClient();
    const simplifiedPlaces = places.map(p => ({
        name: p.name,
        desc: p.description,
        location: p.locationGuess
    }));

    const systemInstruction = `
        You are a helpful travel consultant for MapSieve AI.
        The user has a list of places extracted from a travelog.
        Places: ${JSON.stringify(simplifiedPlaces)}
        Answer questions about these places in Traditional Chinese.
    `;

    return ai.chats.create({
        model: 'gemini-2.5-flash',
        config: { systemInstruction }
    });
};

export const analyzeImage = async (base64Image: string, mimeType: string): Promise<AnalysisResult> => {
  const ai = getAiClient();
  const prompt = `
    Identify places in this image (menu, list, guide).
    Extract place names and generate a reason for recommendation based on visual cues.
    ${JSON_STRUCTURE_PROMPT}
  `;

  const contents = {
    parts: [
      { inlineData: { mimeType, data: base64Image } },
      { text: prompt }
    ]
  };

  try {
    const response = await retryOperation<GenerateContentResponse>(() => ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: contents
    }));

    if (!response.text) throw new Error("No response from Gemini");
    const parsed = cleanAndParseJSON(response.text);
    parsed.places = parsed.places.map((p, idx) => ({ ...p, id: p.id || `img-place-${idx}-${Date.now()}` }));
    return parsed;
  } catch (e: any) {
    console.warn("Gemini 3 Pro failed, fallback to 2.5 Flash...", e);
    const response = await retryOperation<GenerateContentResponse>(() => ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: contents
    }));
    if (!response.text) throw new Error("No response");
    const parsed = cleanAndParseJSON(response.text);
    parsed.places = parsed.places.map((p, idx) => ({ ...p, id: p.id || `img-place-${idx}-${Date.now()}` }));
    return parsed;
  }
};

export const analyzeMapData = async (rawText: string): Promise<AnalysisResult> => {
  const ai = getAiClient();
  const trimmedInput = rawText.trim();
  const isUrl = trimmedInput.match(/^https?:\/\//i);

  let prompt = "";
  let tools: any[] = [{ googleMaps: {} }];

  if (isUrl) {
    tools = [{ googleSearch: {} }]; 
    prompt = `
      You are a Travelog Converter.
      URL: "${rawText}".
      
      1. Read the article.
      2. Extract every recommended place/restaurant/hotel.
      3. For "description", find the AUTHOR'S specific comments (e.g. "The coffee is sour but good", "Wait time is long").
      4. IGNORE sidebars and ads.
      
      ${JSON_STRUCTURE_PROMPT}
      Output in Traditional Chinese (zh-TW).
    `;
  } else {
    prompt = `
      You are a Travelog Converter.
      Analyze this text: "${trimmedInput}".
      
      1. Extract places.
      2. Use Google Maps to verify address/coordinates.
      3. For "description", summarize WHY the text recommends it.
      
      ${JSON_STRUCTURE_PROMPT}
      Output in Traditional Chinese (zh-TW).
    `;
  }

  try {
    const response = await retryOperation<GenerateContentResponse>(() => ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: { tools: tools }
    }));

    if (!response.text) throw new Error("No response from Gemini");
    
    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    const parsed = cleanAndParseJSON(response.text);

    parsed.places = parsed.places.map((p, idx) => {
      let uri = p.googleMapsUri;
      let isVerified = false;

      if (groundingChunks) {
         const chunk = groundingChunks.find(c => {
             const chunkAny = c as any;
             const title = c.web?.title || chunkAny.maps?.title || "";
             const url = c.web?.uri || chunkAny.maps?.uri || "";
             return title.includes(p.name) || url.includes(encodeURIComponent(p.name));
         });

         if (chunk) {
            const chunkAny = chunk as any;
            if (chunk.web?.uri) { uri = chunk.web.uri; isVerified = true; }
            else if (chunkAny.maps?.uri) { uri = chunkAny.maps.uri; isVerified = true; }
         }
      }

      if (uri && (uri.includes('search') || !uri.includes('google'))) uri = undefined;

      return {
        ...p,
        id: p.id || `place-${idx}-${Date.now()}`,
        googleMapsUri: uri,
        isVerified: isVerified
      };
    });

    return parsed;

  } catch (e: any) {
    console.error("Analysis error:", e);
    if (e.message?.includes("JSON")) throw new Error("AI 分析格式錯誤，請重試。");
    if (e.status === 500) throw new Error("伺服器繁忙，請稍後再試。");
    throw e;
  }
};