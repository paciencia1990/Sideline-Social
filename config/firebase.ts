import { getApp, getApps, initializeApp } from "firebase/app";
import type { FirebaseOptions } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getDatabase } from "firebase/database";

const firebaseConfig: FirebaseOptions = {
  apiKey: "AIzaSyCG4ym5jJQPG724Pp_Da7yBj3wBdPEOdOs",
  authDomain: "sideline-squad.firebaseapp.com",
  projectId: "sideline-squad",
  storageBucket: "sideline-squad.firebasestorage.app",
  messagingSenderId: "903830626771",
  appId: "1:903830626771:android:01ec28e1c555059bdfcf26",
  databaseURL: "https://sideline-squad-default-rtdb.firebaseio.com",
};

export const firebaseApp = getApps().length
  ? getApp()
  : initializeApp(firebaseConfig);

export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
export const storage = getStorage(firebaseApp);

// Realtime Database for Bomb Defusal
export const rtdb = getDatabase(firebaseApp);
