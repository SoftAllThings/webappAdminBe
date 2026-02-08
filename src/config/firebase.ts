import admin from "firebase-admin";
import path from "path";
import fs from "fs";

let serviceAccount: admin.ServiceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
} else {
  const serviceAccountPath = path.resolve(
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "./serviceAccountKey.json"
  );
  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error(
      `Firebase service account key not found. Set FIREBASE_SERVICE_ACCOUNT_KEY env var or provide the file at ${serviceAccountPath}`
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  serviceAccount = require(serviceAccountPath);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log("✅ Firebase Admin SDK initialized successfully");
}

export const db = admin.firestore();
