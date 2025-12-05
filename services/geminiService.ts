import { GoogleGenAI, GenerateContentResponse, Chat } from "@google/genai";
import { AnalysisResult, CategoryType, Place } from "../types";

// Lazy initialization helper to prevent top-level crashes if API_KEY is missing
const getAiClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("Gemini API Key 未設定。請確認環境變數 process.env.API_KEY 已正確配置。");
  }
  return new GoogleGenAI({ apiKey });
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
      "suggestedItinerary": "string (Optional daily route plan extracted from the text. e.g. 'Day 1: A -> B -> C')",
      "places": [
        {
          "name": "string (Full specific name, e.g. 'Starbucks Shibuya Tsutaya' not just 'Starbucks')",
          "category": "FOOD" | "DRINK" | "SIGHTSEEING" | "SHOPPING" | "ACTIVITY" | "LODGING" | "OTHER",
          "subCategory": "string (e.g. 拉麵店)",
          "description": "string (Traditional Chinese summary of why it is recommended)",
          "ratingPrediction": number (1-5),
          "priceLevel": "Free" | "$" | "$$" | "$$$" | "$$$$" | "Unknown",
          "tags": ["string"],
          "locationGuess": "string (Strict format: 'City District' e.g. '台北市 信義區', '京都市 右京區'. DO NOT include Country names like 'Taiwan' or 'Japan'. MUST use a space to separate City and District/Township. If District is unknown, use '市區')",
          "address": "string (Full specific address if available in the text/source, otherwise null)",
          "openingHours": "string (e.g. 'Mon-Sun 10:00-22:00' or 'Unknown' if not found)",
          "coordinates": { "lat": number, "lng": number },
          "googleMapsUri": "string (LEAVE EMPTY unless you have a GROUNDED Google Maps URL. DO NOT GUESS.)",
          "imageUri": "string (URL of an image representing this place found in the content. Must be a valid image URL ending in .jpg, .png, etc. or null)",
          "websiteUri": "string (URL to the official website or the specific blog section/link for this place, or null)"
        }
      ]
    }
`;

/**
 * Creates a chat session contextualized with the current itinerary.
 */
export const createChatSession = (places: Place[]): Chat => {
    const ai = getAiClient();
    const simplifiedPlaces = places.map(p => ({
        name: p.name,
        category: p.category,
        subCategory: p.subCategory,
        location: p.locationGuess,
        desc: p.description,
        rating: p.ratingPrediction,
        price: p.priceLevel,
        address: p.address,
        hours: p.openingHours
    }));

    const systemInstruction = `
        You are a helpful travel consultant for the "MapSieve AI" app.
        The user has an active itinerary with ${places.length} places.
        
        Here is the JSON data of the current places:
        ${JSON.stringify(simplifiedPlaces)}
        
        Your Goal:
        1. Answer questions about these specific places (e.g., "Which one is best for kids?", "How to arrange route for Kyoto places?").
        2. Suggest logical routes or grouping based on the 'location' field.
        3. Be concise, friendly, and use Traditional Chinese (zh-TW).
        4. Do not make up facts about places not in the list unless asked for general travel advice in that area.
    `;

    return ai.chats.create({
        model: 'gemini-2.5-flash',
        config: {
            systemInstruction: systemInstruction,
        }
    });
};

/**
 * Analyze an image using gemini-3-pro-preview with fallback to 2.5-flash
 */
export const analyzeImage = async (base64Image: string, mimeType: string): Promise<AnalysisResult> => {
  const ai = getAiClient();
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
    const response = await retryOperation<GenerateContentResponse>(() => ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: contents
    }));

    if (!response.text) throw new Error("No response from Gemini");
    const parsed = cleanAndParseJSON(response.text);
    parsed.places = parsed.places.map((p, idx) => ({ ...p, id: p.id || `img-place-${idx}-${Date.now()}` }));
    return parsed;

  } catch (e: any) {
    console.warn("Gemini 3 Pro failed, attempting fallback to Gemini 2.5 Flash...", e);
    
    // Fallback to Gemini 2.5 Flash if 3 Pro fails
    try {
       const response = await retryOperation<GenerateContentResponse>(() => ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: contents
      }));
      
      if (!response.text) throw new Error("No response from Gemini");
      const parsed = cleanAndParseJSON(response.text);
      parsed.places = parsed.places.map((p, idx) => ({ ...p, id: p.id || `img-place-${idx}-${Date.now()}` }));
      return parsed;

    } catch (fallbackError: any) {
      console.error("Image analysis error:", fallbackError);
      throw new Error("圖片分析失敗，請確保圖片清晰包含文字或地點。");
    }
  }
};

/**
 * Analyze text/URL using gemini-2.5-flash with Google Maps Grounding
 */
export const analyzeMapData = async (rawText: string, categoryHint?: string): Promise<AnalysisResult> => {
  const ai = getAiClient();
  const modelId = "gemini-2.5-flash"; // Flash supports grounding efficiently
  const trimmedInput = rawText.trim();
  const isUrl = trimmedInput.match(/^https?:\/\//i);
  const isHtml = trimmedInput.match(/^\s*<(!doctype|html|div|section|body|ul|ol|li)/i);

  const categoryContext = categoryHint && categoryHint !== 'AUTO' 
    ? `IMPORTANT: The user has specified that these items belong to the category "${categoryHint}". Prioritize this category.` 
    : "";

  let prompt = "";
  let tools: any[] = [{ googleMaps: {} }]; // Default to using Maps Grounding

  // --- MODE 1: URL Handling (Enhanced Accuracy & Extraction) ---
  if (isUrl) {
    tools = [{ googleSearch: {} }]; 
    
    prompt = `
      You are an EXPERT Web Scraper and Travel Data Analyst.
      The user provided a URL: "${rawText}".
      ${categoryContext}
      
      Your Goal: DEEPLY PARSE content to build a highly accurate itinerary with RICH MEDIA.
      
      *** PHASE 1: CONTENT EXTRACTION ***
      - **Scope**: specific recommended places in the main article body. IGNORE sidebars, footers, "You might also like", and ads.
      - **Itinerary**: Extract chronological markers ("Day 1", "Morning") into 'suggestedItinerary'.
      
      *** PHASE 2: ENTITY RESOLUTION & VALIDATION (CRITICAL) ***
      - **Name Precision**:
         - If the text says "Ichiran", find the context. Is it "Ichiran Asakusa"? Use the full specific name.
         - If a Google Maps link is present (e.g., maps.app.goo.gl/...), use the name from that link target.
      - **Location Hierarchy**:
         - Deduce the City/District from the Article Title if not explicitly stated next to the place.
         - Format 'locationGuess' strictly as "City District" (e.g., "Kyoto Arashiyama").
      - **Cross-Reference**:
         - Does the extracted address match the inferred city? If not, trust the address.
         - If a place has no description or is just a link in a footer, IGNORE it.
      
      *** PHASE 3: MEDIA & DETAILS ***
      - **Images**: Find the <img> tag visually associated with the place header.
      - **Links**: Extract official websites or booking links into 'websiteUri'.
      - **Metadata**: specific address and opening hours.
      
      ${JSON_STRUCTURE_PROMPT}
      Output in Traditional Chinese (zh-TW).
    `;
  } 
  
  // --- MODE 2: HTML Source Code ---
  else if (isHtml) {
    prompt = `
      You are an HTML Parser for Travel Data.
      Parse this HTML source code to extract places and itinerary.
      HTML Input: "${trimmedInput.substring(0, 30000)}"
      ${categoryContext}
      
      Strategy:
      1. Identify the recurring DOM structure (e.g. repeating <div class="place-card"> or <li> items).
      2. Extract Name, Address, Opening Hours, and Description from each item.
      3. **Images & Links**: Look for <img src="..."> and <a href="..."> tags within the place block. Extract them to 'imageUri' and 'websiteUri'.
      4. Look for H1-H6 tags to identify sections and itinerary days.
      5. Ignore navigation menus, footers, and comment sections.
      
      ${JSON_STRUCTURE_PROMPT}
      Output in Traditional Chinese (zh-TW).
    `;
  }

  // --- MODE 3: Plain Text (Standard) ---
  else {
    prompt = `
      Analyze this text input to extract travel places.
      Input: "${trimmedInput}"
      ${categoryContext}

      Use the Google Maps tool to VERIFY these places.
      - If a place exists on Google Maps, use its EXACT coordinates, correct official name, full address, and opening hours if available.
      - DO NOT invent a googleMapsUri unless the tool explicitly provides a deep link.
      
      ${JSON_STRUCTURE_PROMPT}
      Output in Traditional Chinese (zh-TW).
    `;
  }

  try {
    const response = await retryOperation<GenerateContentResponse>(() => ai.models.generateContent({
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
    console.error("Analysis error:", e);
    if (e.message && e.message.includes("JSON")) throw new Error("AI 分析結果格式錯誤，請重試。");
    if (e.message && e.message.includes("SAFETY")) throw new Error("內容涉及安全限制，無法分析。");
    if (e.status === 500 || e?.error?.code === 500) throw new Error("伺服器繁忙 (500)，請稍後再試。");
    throw e;
  }
};