import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { AnalysisResult, CategoryType } from "../types";

// Initialize with a fallback to avoid crash on load if key is missing.
// We allow setting the key dynamically via localStorage or input.
let apiKey = process.env.API_KEY || localStorage.getItem('gemini_api_key') || '';
let ai: GoogleGenAI | null = null;

export const hasApiKey = () => !!apiKey;

export const setApiKey = (key: string) => {
  apiKey = key;
  localStorage.setItem('gemini_api_key', key);
  ai = new GoogleGenAI({ apiKey });
};

const getAiClient = () => {
  if (!ai) {
    if (!apiKey) {
      throw new Error("API_KEY_MISSING");
    }
    ai = new GoogleGenAI({ apiKey });
  }
  return ai;
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
    // Enhanced error detection for nested API errors (e.g. { error: { code: 500 ... } })
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
      "suggestedItinerary": "string (Optional daily route plan)",
      "places": [
        {
          "name": "string",
          "category": "FOOD" | "DRINK" | "SIGHTSEEING" | "SHOPPING" | "ACTIVITY" | "LODGING" | "OTHER",
          "subCategory": "string (e.g. 拉麵店)",
          "description": "string (Traditional Chinese)",
          "ratingPrediction": number (1-5),
          "priceLevel": "Free" | "$" | "$$" | "$$$" | "$$$$" | "Unknown",
          "tags": ["string"],
          "locationGuess": "string (Strict format: 'City District' e.g. '台北市 信義區', '京都市 右京區'. MUST use a space to separate City and District/Township. If District is unknown, use '市區')",
          "coordinates": { "lat": number, "lng": number },
          "googleMapsUri": "string (LEAVE EMPTY unless you have a GROUNDED Google Maps URL. DO NOT GUESS.)"
        }
      ]
    }
`;

/**
 * Analyze an image using gemini-3-pro-preview with fallback to 2.5-flash
 */
export const analyzeImage = async (base64Image: string, mimeType: string): Promise<AnalysisResult> => {
  const client = getAiClient();

  const prompt = `
    You are a visual travel assistant. Identify places, restaurants, or attractions shown in this image.
    It could be a screenshot of a list, a photo of a menu, a signboard, or a travel guide page.
    
    1. Extract all visible place names.
    2. Infer the category and details.
    3. Generate a summary.
    
    ${JSON_STRUCTURE_PROMPT}
  `;

  const contents = {
    parts: [
      { inlineData: { mimeType, data: base64Image } },
      { text: prompt }
    ]
  };

  try {
    // Try primary model (Gemini 3 Pro)
    const response = await retryOperation<GenerateContentResponse>(() => client.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: contents
    }));

    if (!response.text) throw new Error("No response from Gemini");
    const parsed = cleanAndParseJSON(response.text);
    parsed.places = parsed.places.map((p, idx) => ({ ...p, id: p.id || `img-place-${idx}-${Date.now()}` }));
    return parsed;

  } catch (e: any) {
    if (e.message === "API_KEY_MISSING") throw e;
    console.warn("Gemini 3 Pro failed, attempting fallback to Gemini 2.5 Flash...", e);
    
    // Fallback to Gemini 2.5 Flash if 3 Pro fails
    try {
       const response = await retryOperation<GenerateContentResponse>(() => client.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: contents
      }));
      
      if (!response.text) throw new Error("No response from Gemini");
      const parsed = cleanAndParseJSON(response.text);
      parsed.places = parsed.places.map((p, idx) => ({ ...p, id: p.id || `img-place-${idx}-${Date.now()}` }));
      return parsed;

    } catch (fallbackError: any) {
      if (fallbackError.message === "API_KEY_MISSING") throw fallbackError;
      console.error("Image analysis error:", fallbackError);
      throw new Error("圖片分析失敗，請確保圖片清晰包含文字或地點。");
    }
  }
};

/**
 * Analyze text/URL using gemini-2.5-flash with Google Maps Grounding
 */
export const analyzeMapData = async (rawText: string, categoryHint?: string): Promise<AnalysisResult> => {
  const client = getAiClient();

  const modelId = "gemini-2.5-flash"; // Flash supports grounding efficiently
  const trimmedInput = rawText.trim();
  const isUrl = trimmedInput.match(/^https?:\/\//i);
  const isHtml = trimmedInput.match(/^\s*<(!doctype|html|div|section|body|ul|ol|li)/i);

  const categoryContext = categoryHint && categoryHint !== 'AUTO' 
    ? `IMPORTANT: The user has specified that these items belong to the category "${categoryHint}". Prioritize this category.` 
    : "";

  let prompt = "";
  let tools: any[] = [{ googleMaps: {} }]; // Default to using Maps Grounding

  // --- MODE 1: URL Handling ---
  if (isUrl) {
    // Note: googleMaps and googleSearch tools cannot be used together in the same request easily 
    // without complex routing. For URL reading, we prioritize Search Grounding, 
    // but we ask it to format strictly.
    tools = [{ googleSearch: {} }]; 
    
    prompt = `
      You are an advanced travel content extractor.
      The user provided a URL: "${rawText}".
      ${categoryContext}
      
      EXECUTION STRATEGY:
      1. **Search & Read**: Use Google Search to find the content of the URL.
      2. **Extraction**: Extract places and itinerary ("Day 1", "Day 2").
      3. **Detailing**: For every place found, try to infer its likely coordinates and details.
      
      ${JSON_STRUCTURE_PROMPT}
      Output in Traditional Chinese (zh-TW).
    `;
  } 
  
  // --- MODE 2: HTML Source Code ---
  else if (isHtml) {
    // HTML mode doesn't strictly need Search, but Maps grounding can verify the extracted names.
    prompt = `
      Parse this HTML to extract places and itinerary.
      HTML Input: "${trimmedInput.substring(0, 30000)}"
      ${categoryContext}
      
      After extracting names from HTML, use your internal knowledge to fill in details.
      
      ${JSON_STRUCTURE_PROMPT}
      Output in Traditional Chinese (zh-TW).
    `;
  }

  // --- MODE 3: Plain Text (Standard) ---
  else {
    prompt = `
      Analyze this text to extract places.
      Input: "${trimmedInput}"
      ${categoryContext}

      Use the Google Maps tool to VERIFY these places.
      - If a place exists on Google Maps, use its EXACT coordinates, correct name.
      - DO NOT invent a googleMapsUri unless the tool explicitly provides a deep link.
      
      ${JSON_STRUCTURE_PROMPT}
      Output in Traditional Chinese (zh-TW).
    `;
  }

  try {
    const response = await retryOperation<GenerateContentResponse>(() => client.models.generateContent({
      model: modelId,
      contents: prompt,
      config: {
        tools: tools,
        // DO NOT set responseSchema when using tools like googleMaps or googleSearch
      }
    }));

    if (!response.text) throw new Error("No response from Gemini");
    
    // Attempt to extract grounding chunks if available (for Maps/Search attribution)
    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    
    const parsed = cleanAndParseJSON(response.text);

    // Post-process to attach IDs and verification status
    parsed.places = parsed.places.map((p, idx) => {
      // STRICT VERIFICATION LOGIC:
      // 1. If we have grounding metadata, check if any chunk matches this place.
      // 2. If the JSON has a URI but it doesn't match a grounding source, it's likely a hallucination.
      // 3. For reliability, we mostly rely on constructing a high-quality search query on the frontend
      //    unless we are 100% sure we have a valid map link from the tool.
      
      let uri = p.googleMapsUri;
      let isVerified = false;

      // Filter out hallucinated generic links or search links that aren't specific
      if (uri && (uri.includes('search') || !uri.includes('google'))) {
        uri = undefined;
      }

      if (groundingChunks) {
         // Check if any grounding chunk is relevant to this place
         const chunk = groundingChunks.find(c => {
             const chunkAny = c as any;
             const title = c.web?.title || chunkAny.maps?.title || "";
             const url = c.web?.uri || chunkAny.maps?.uri || "";
             return title.includes(p.name) || url.includes(encodeURIComponent(p.name));
         });

         if (chunk) {
            const chunkAny = chunk as any;
            // Use the chunk's URI if available and looks like a map/place link
            if (chunk.web?.uri) {
                uri = chunk.web.uri;
                isVerified = true;
            } else if (chunkAny.maps?.uri) {
                uri = chunkAny.maps.uri;
                isVerified = true;
            }
         }
      }

      // If we still don't have a verified URI from tools, we clear it to force the frontend to use the smart search query.
      // This prevents broken hallucinated links.
      if (!isVerified) {
        uri = undefined; 
      }

      return {
        ...p,
        id: p.id || `place-${idx}-${Date.now()}`,
        googleMapsUri: uri,
        isVerified: isVerified
      };
    });

    return parsed;

  } catch (e: any) {
    if (e.message === "API_KEY_MISSING") throw e;
    console.error("Analysis error:", e);
    if (e.message && e.message.includes("JSON")) throw new Error("AI 分析結果格式錯誤，請重試。");
    if (e.message && e.message.includes("SAFETY")) throw new Error("內容涉及安全限制，無法分析。");
    // status 500 should be caught by retryOperation, but if it bubbles up after retries:
    if (e.status === 500 || e?.error?.code === 500) throw new Error("伺服器繁忙 (500)，請稍後再試。");
    throw new Error("分析失敗，請檢查輸入內容或網路連線。");
  }
};