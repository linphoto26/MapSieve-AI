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
  coordinates?: {
    lat: number;
    lng: number;
  };
  googleMapsUri?: string; // Real Google Maps Link from Grounding
  isVerified?: boolean; // True if validated by Google Maps Grounding
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