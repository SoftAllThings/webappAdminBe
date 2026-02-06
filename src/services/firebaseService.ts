import { db } from "../config/firebase";

export type FirebaseUser = {
  id: string;
  [key: string]: unknown;
};

export class FirebaseService {
  async getRandomUser(): Promise<FirebaseUser> {
    const snapshot = await db.collection("users").limit(50).get();

    if (snapshot.empty) {
      throw new Error("No users found in Firestore");
    }

    const randomIndex = Math.floor(Math.random() * snapshot.docs.length);
    const randomDoc = snapshot.docs[randomIndex];

    if (!randomDoc) {
      throw new Error("Failed to select a random user");
    }

    return {
      id: randomDoc.id,
      ...randomDoc.data(),
    };
  }
}

export const firebaseService = new FirebaseService();
