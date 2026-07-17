import {
  collection,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/config/firebase";

export interface ConnectionPrompt {
  promptId: string;
  promptText: string;
  promptText_es: string;
  weekOf: Date;
  isActive: boolean;
}

type FirestoreDate =
  | Date
  | number
  | {
      toDate?: () => Date;
      toMillis?: () => number;
    }
  | null
  | undefined;

function tsToDate(value: FirestoreDate): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  if (typeof value.toDate === "function") return value.toDate();
  if (typeof value.toMillis === "function") return new Date(value.toMillis());
  return null;
}

export async function fetchConnectionPrompt(): Promise<ConnectionPrompt | null> {
  try {
    const snapshot = await getDocs(
      query(collection(db, "connectionPrompts"), where("isActive", "==", true), limit(1))
    );

    if (snapshot.empty) return null;

    const promptDoc = snapshot.docs[0];
    const data = promptDoc.data();

    return {
      promptId: promptDoc.id,
      promptText: (data.promptText as string) ?? "",
      promptText_es: (data.promptText_es as string) ?? "",
      weekOf: tsToDate(data.weekOf as FirestoreDate) ?? new Date(),
      isActive: (data.isActive as boolean) ?? false,
    };
  } catch (error) {
    console.warn("[HomeFeedService] fetchConnectionPrompt error:", error);
    return null;
  }
}
