import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getDatabase, type Database } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyBg-02uBzlfAhmq_DgiH1-RMBoKt3_H0dU",
  authDomain: "insig-55d5d.firebaseapp.com",
  databaseURL: "https://insig-55d5d-default-rtdb.firebaseio.com",
  projectId: "insig-55d5d",
  storageBucket: "insig-55d5d.firebasestorage.app",
  messagingSenderId: "710375461789",
  appId: "1:710375461789:web:f91c725d1f4d435f629574",
};

let app: FirebaseApp | null = null;
let database: Database | null = null;

export function clientDb() {
  if (typeof window === "undefined") {
    throw new Error("Firebase is only used in the browser.");
  }
  if (!database) {
    app = getApps()[0] ?? initializeApp(firebaseConfig);
    database = getDatabase(app);
  }
  return database;
}
