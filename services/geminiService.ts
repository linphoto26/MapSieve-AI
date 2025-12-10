
import { GoogleGenAI, GenerateContentResponse, Chat } from "@google/genai";
import { AnalysisResult, CategoryType, Place } from "../types";

/**
 * Helper to safely extract and parse JSON from AI response text.
 * Enhanced to handle markdown blocks, raw text, and common JSON errors.
 */
const cleanAndParseJSON = (text: string): AnalysisResult => {
  // 1. Remove Markdown code block delimiters (greedy replace to handle variations)
  // Replaces ```json, ```JSON, or just ``` with empty string
  let cleanText = text.replace(/```(?:json)?/gi, '').replace(/```/g, '');

  // 2. Find the outer-most JSON object boundaries
  const firstBrace = cleanText.indexOf('{');
  const lastBrace = cleanText.lastIndexOf('}');
  
  if (firstBrace === -1 || lastBrace === -1) {
    // If no object found, check if it's an array (though we asked for object)
    if (cleanText.trim().startsWith('[') && cleanText.trim().endsWith(']')) {
       // It's a raw array, likely just places. We need to wrap it.
       try {
         const places = JSON.parse(cleanText);
         return { summary: "AI Generated Summary", places: places };
       } catch (e) { /* continue to error */ }
    }
    throw new Error("No JSON object found in response.");
  }

  const jsonCandidate = cleanText.substring(firstBrace, lastBrace + 1);

  // 3. Try parsing
  try {
    return JSON.parse(jsonCandidate);
  } catch (e) {
    // 4. Common Fix: Remove trailing commas before closing braces/brackets
    try {
       const fixedJson = jsonCandidate.replace(/,(\s*[}\]])/g, '$1');
       return JSON.parse(fixedJson);
    } catch (e2) {
       // 5. If specific "Script error" or other unreadable errors happen during parse, 
       // explicitly throw a readable error.
       console.error("JSON Parse Failed. Candidate:", jsonCandidate);
       throw new Error("JSON structure is malformed.");
    }
  }
};

/**
 * Smart deduplication of places.
 * Prioritizes:
 * 1. Verified entries (Google Maps Grounding)
 * 2. Entries with Coordinates
 * 3. Entries with more data (Address, Image, Description length)
 * 
 * Preserves the ID of the first occurrence (usually the existing one in an append scenario)
 * to maintain UI state, unless the new entry completely replaces it.
 */
export const deduplicatePlaces = (places: Place[]): Place[] => {
  const uniqueMap = new Map<string, Place>();

  places.forEach(p => {
    // Generate a unique key
    // Priority 1: Valid Google Maps URI (ignores generic search links)
    let key = "";
    if (p.googleMapsUri && !p.googleMapsUri.includes('search')) {
        key = `URI:${p.googleMapsUri}`;
    } else {
        // Priority 2: Name + (optional) Location/City to distinguish chains
        // Normalize name: lowercase, remove spaces
        const normName = p.name.toLowerCase().replace(/\s+/g, '');
        // We assume the AI follows instruction to add City to chain names, 
        // but adding locationGuess helps if name is just "7-Eleven"
        const normLoc = (p.locationGuess || '').split(' ')[0].toLowerCase().replace(/\s+/g, ''); 
        key = `NAME:${normName}-${normLoc}`;
    }

    const existing = uniqueMap.get(key);

    if (!existing) {
        uniqueMap.set(key, p);
    } else {
        // MERGE LOGIC: Keep the "better" one
        
        // 1. Verified status wins immediately if the other is not
        if (!existing.isVerified && p.isVerified) {
            // New one is better, replace but KEEP OLD ID
            uniqueMap.set(key, { ...p, id: existing.id });
            return;
        }
        if (existing.isVerified && !p.isVerified) return; // Existing is better

        // 2. Data completeness (score based)
        let scoreExisting = 0;
        let scoreNew = 0;
        
        if (existing.coordinates) scoreExisting += 2;
        if (p.coordinates) scoreNew += 2;
        
        if (existing.address) scoreExisting += 1;
        if (p.address) scoreNew += 1;

        if (existing.imageUri) scoreExisting += 1;
        if (p.imageUri) scoreNew += 1;

        if ((existing.description?.length || 0) > (p.description?.length || 0)) scoreExisting += 0.5;
        else scoreNew += 0.5;

        // If new one has significantly better data, replace
        if (scoreNew > scoreExisting) {
            // Replace but preserve ID
            uniqueMap.set(key, { ...p, id: existing.id });
        }
        // Else keep existing
    }
  });
  
  return Array.from(uniqueMap.values());
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
    // GUARD: Ensure error object exists to prevent "Script error" when accessing properties on null/undefined
    if (!error) {
        if (retries <= 0) throw new Error("Unknown error occurred (Script Error).");
    } else {
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
        
        if (!isRetryable) {
          throw error;
        }
    }
    
    if (retries <= 0) {
        throw error;
    }
    
    console.warn(`Gemini API Error. Retrying... ${retries} attempts left.`);
    await new Promise(resolve => setTimeout(resolve, delay));
    return retryOperation(operation, retries - 1, delay * 2);
  }
}

// OPTIMIZED PROMPT FOR MVP
const JSON_STRUCTURE_PROMPT = `
    OUTPUT RAW JSON ONLY. NO MARKDOWN. NO \`\`\`.
    
    Task: Extract specific Points of Interest (POIs) from the text.

    RULES:
    1. **Specific POIs Only**: Restaurants, hotels, tourist spots, shops.
    2. **Ignore Broad Locations**: No cities, airports, or generic terms like "Station".
    3. **Chain Stores**: If generic (e.g. "Starbucks"), output "Starbucks + City" (e.g. "Starbucks Taipei").
    4. **Sentiment**: 'description' must be the Author's specific comment/review.
    5. **Coordinates**: Use Google Maps tool.

    Schema:
    {
      "summary": "One sentence summary in Traditional Chinese",
      "places": [
        {
          "name": "Full specific name",
          "category": "FOOD|DRINK|SIGHTSEEING|SHOPPING|ACTIVITY|LODGING|OTHER",
          "subCategory": "e.g. Ramen Shop",
          "description": "Author's review",
          "ratingPrediction": 1-5 (number),
          "priceLevel": "Free|$|$$|$$$|$$$$|Unknown",
          "tags": ["tag1", "tag2"],
          "locationGuess": "City District",
          "address": "Full address or null",
          "openingHours": "e.g. 10:00-22:00 or Unknown",
          "coordinates": { "lat": number, "lng": number },
          "googleMapsUri": "Grounded URL or null",
          "imageUri": "Image URL or null",
          "websiteUri": "Website URL or null"
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
  // Combined tools configuration
  let tools: any[] = [{ googleMaps: {} }];

  if (isUrl) {
    // When using multiple tools, it's often safer to combine them in one tool object or list them if supported.
    // For GenAI SDK, we add googleSearch.
    tools = [{ googleSearch: {}, googleMaps: {} }]; 
    prompt = `
      Read content from URL: "${rawText}".
      ${JSON_STRUCTURE_PROMPT}
      Output in Traditional Chinese (zh-TW).
    `;
  } else {
    prompt = `
      Analyze this text: "${trimmedInput}".
      ${JSON_STRUCTURE_PROMPT}
      Output in Traditional Chinese (zh-TW).
    `;
  }

  try {
    const response = await retryOperation<GenerateContentResponse>(() => ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: { 
          tools: tools,
          // NOTE: responseMimeType: "application/json" IS NOT SUPPORTED with Google Maps tool
      }
    }));

    if (!response.text) {
        // Check if it was blocked
        if (response.candidates?.[0]?.finishReason) {
            console.warn("Finish Reason:", response.candidates[0].finishReason);
        }
        throw new Error("No response content generated (possibly filtered).");
    }
    
    const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
    
    // Parse JSON
    const parsed = cleanAndParseJSON(response.text);

    // Post-process places
    if (parsed.places && Array.isArray(parsed.places)) {
        parsed.places = parsed.places.map((p, idx) => {
        let uri = p.googleMapsUri;
        let isVerified = false;

        // Enhance verification with grounding metadata if available
        if (groundingChunks) {
            const chunk = groundingChunks.find(c => {
                const chunkAny = c as any;
                const title = c.web?.title || chunkAny.maps?.title || "";
                const url = c.web?.uri || chunkAny.maps?.uri || "";
                return title && (title.includes(p.name) || (url && url.includes(encodeURIComponent(p.name))));
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

        // Deduplicate places from the single batch analysis
        parsed.places = deduplicatePlaces(parsed.places);

    } else {
        parsed.places = [];
    }

    return parsed;

  } catch (e: any) {
    console.error("Analysis error:", e);
    
    // Provide more specific error messages to the user
    // Guard against null/undefined 'e'
    if (!e) throw new Error("發生未知錯誤 (Unknown Error)");

    if (e.status === 403 || e.message?.includes("API key")) {
        throw new Error("API Key 無效或額度已滿，請檢查設定。");
    }
    if (e.message?.includes("unsupported")) {
        // Fallback or specific error for tool conflict if config slips through
        throw new Error("系統配置錯誤 (Tool/MimeType Conflict)。");
    }
    if (e.message?.includes("JSON") || e.message?.includes("malformed")) {
        throw new Error("AI 回傳資料格式有誤，請再試一次。");
    }
    if (e.status === 500 || e.status === 503) {
        throw new Error("伺服器繁忙 (500/503)，請稍後再試。");
    }
    
    // Fallback for other errors
    throw new Error(e.message || "發生未知錯誤");
  }
};
