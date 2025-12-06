
import { GoogleGenAI, GenerateContentResponse, Chat } from "@google/genai";
import { AnalysisResult, CategoryType, Place } from "../types";

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

// OPTIMIZED PROMPT FOR MVP: Focus on POI extraction and Sentiment
const JSON_STRUCTURE_PROMPT = `
    RETURN JSON ONLY. No markdown, no conversational text.
    
    You are a professional travel itinerary assistant. 
    Your task is to extract specific Points of Interest (POIs) from the text.

    RULES:
    1. **Extract Specific POIs Only**: Only extract specific restaurants, hotels, tourist spots, or shops.
    2. **Ignore Broad Locations**: Do NOT extract cities (e.g., "Taipei", "Kyoto"), airports, or generic terms like "Convenience Store" or "Station" unless it is a specific destination.
    3. **Chain Stores**: If a chain store is mentioned without a specific branch (e.g., "We ate at Matsuya"), extract it as "Brand + City" (e.g., "Matsuya Kyoto") to help the map tool find a relevant location.
    4. **Blogger Sentiment**: For the 'description' field, do NOT write generic info. Extract the **Author's Specific Comments** (e.g., "The cinnamon roll is a must-try," "The queue was too long").
    5. **Coordinates**: Use the provided Google Maps tool to find accurate coordinates.

    Output Structure:
    {
      "summary": "string (One sentence summary in Traditional Chinese)",
      "places": [
        {
          "name": "string (Full specific name, e.g. 'Starbucks Shibuya Tsutaya')",
          "category": "FOOD" | "DRINK" | "SIGHTSEEING" | "SHOPPING" | "ACTIVITY" | "LODGING" | "OTHER",
          "subCategory": "string (e.g. 拉麵店)",
          "description": "string (The Blogger's Sentiment/Review. Why did they like/dislike it?)",
          "ratingPrediction": number (1-5, based on author's tone),
          "priceLevel": "Free" | "$" | "$$" | "$$$" | "$$$$" | "Unknown",
          "tags": ["string (Keywords from the review, e.g. 'Cozy', 'Spicy')"],
          "locationGuess": "string (Strict format: 'City District' e.g. '台北市 信義區'.)",
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

export const createChatSession = (places: Place[], apiKey: string): Chat => {
    if (!apiKey) throw new Error("API Key is missing");
    const ai = new GoogleGenAI({ apiKey });
    
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

export const analyzeMapData = async (rawText: string, apiKey: string): Promise<AnalysisResult> => {
  if (!apiKey) throw new Error("請先設定 API Key");
  
  const ai = new GoogleGenAI({ apiKey });
  const trimmedInput = rawText.trim();
  const isUrl = trimmedInput.match(/^https?:\/\//i);

  let prompt = "";
  // We use the googleMaps tool as the primary "Geocoding" agent as requested by the split-duty strategy.
  // The model extracts the entity -> Calls the tool -> Returns the grounded data.
  let tools: any[] = [{ googleMaps: {} }];

  if (isUrl) {
    tools = [{ googleSearch: {} }, { googleMaps: {} }]; 
    prompt = `
      You are a Travelog Converter.
      URL: "${rawText}".
      
      1. Read the content from the URL.
      2. Follow the extraction rules below strictly.
      
      ${JSON_STRUCTURE_PROMPT}
      Output in Traditional Chinese (zh-TW).
    `;
  } else {
    prompt = `
      You are a Travelog Converter.
      Analyze this text: "${trimmedInput}".
      
      1. Extract places.
      2. Use Google Maps tool to verify address/coordinates.
      
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

      // Enhance verification with grounding metadata if available
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

      // Cleanup invalid URIs
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
    if (e.status === 403 || e.message?.includes("API key")) throw new Error("API Key 無效或額度已滿，請檢查設定。");
    if (e.message?.includes("JSON")) throw new Error("AI 分析格式錯誤，請重試。");
    if (e.status === 500) throw new Error("伺服器繁忙，請稍後再試。");
    throw e;
  }
};
