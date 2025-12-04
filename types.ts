export enum CategoryType {
  FOOD = 'FOOD',
  DRINK = 'DRINK',
  SIGHTSEEING = 'SIGHTSEEING',
  SHOPPING = 'SHOPPING',
  ACTIVITY = 'ACTIVITY',
  LODGING = 'LODGING',
  OTHER = 'OTHER'
}

export interface Place {
  id: string;
  name: string;
  originalText: string; // The text from the user input used to identify this
  category: CategoryType;
  subCategory: string; // e.g., "Ramen Shop", "Park", "Museum"
  description: string; // AI generated brief description
  ratingPrediction: number; // Estimated rating based on fame (1-5)
  priceLevel: 'Free' | '$' | '$$' | '$$$' | '$$$$' | 'Unknown';
  tags: string[]; // e.g., ["Cozy", "Tourist Favorite", "Hidden Gem"]
  locationGuess: string; // City or Area guess
  address?: string; // Full address
  openingHours?: string; // e.g. "10:00 - 22:00"
  coordinates?: {
    lat: number;
    lng: number;
  };
  googleMapsUri?: string; // Real Google Maps Link from Grounding
  isVerified?: boolean; // True if validated by Google Maps Grounding
  imageUri?: string; // URL of an image representing the place
  websiteUri?: string; // URL to the official website or specific blog post section
}

export interface AnalysisResult {
  places: Place[];
  summary: string;
  suggestedItinerary?: string; // Optional brief suggestion or route plan
}

export interface UserProfile {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}

// Extend Window interface for IDX or AI Studio environments
declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }

  interface Window {
    aistudio?: AIStudio;
  }
}