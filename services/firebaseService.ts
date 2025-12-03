import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, User } from "firebase/auth";
import { getFirestore, doc, setDoc, onSnapshot, Firestore } from "firebase/firestore";
import { AnalysisResult } from "../types";

export const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyCNicQhF26qv6-z1PmuRt-5Dw6jTMCCUsU",
  authDomain: "mapsieve-ai.firebaseapp.com",
  projectId: "mapsieve-ai",
  storageBucket: "mapsieve-ai.firebasestorage.app",
  messagingSenderId: "598181757192",
  appId: "1:598181757192:web:d7294f982ed64558096cbd",
  measurementId: "G-MS4B47R9WW"
};

let app: FirebaseApp | undefined;
let auth: any;
let db: Firestore;

export const isFirebaseInitialized = () => !!app;

export const initializeFirebase = (config: any = DEFAULT_FIREBASE_CONFIG) => {
  if (!getApps().length) {
    try {
      app = initializeApp(config);
      auth = getAuth(app);
      db = getFirestore(app);
      return true;
    } catch (e) {
      console.error("Firebase init error:", e);
      return false;
    }
  } else {
    app = getApp();
    auth = getAuth(app);
    db = getFirestore(app);
    return true;
  }
};

export const loginWithGoogle = async () => {
  if (!auth) throw new Error("Firebase not initialized");
  const provider = new GoogleAuthProvider();
  return signInWithPopup(auth, provider);
};

export const logout = async () => {
  if (!auth) return;
  return signOut(auth);
};

export const onUserChange = (callback: (user: User | null) => void) => {
  if (!auth) return () => {};
  return onAuthStateChanged(auth, callback);
};

export const saveUserData = async (uid: string, data: AnalysisResult) => {
  if (!db) return;
  try {
    await setDoc(doc(db, "users", uid), {
      analysisResult: data,
      lastUpdated: new Date()
    }, { merge: true });
  } catch (e) {
    console.error("Error saving data:", e);
  }
};

export const subscribeToUserData = (uid: string, callback: (data: AnalysisResult | null) => void) => {
  if (!db) return () => {};
  const unsub = onSnapshot(doc(db, "users", uid), (doc) => {
    if (doc.exists()) {
      const data = doc.data();
      if (data.analysisResult) {
        callback(data.analysisResult as AnalysisResult);
      }
    } else {
      callback(null);
    }
  });
  return unsub;
};