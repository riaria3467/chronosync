/**
 * ChronoSync - Firebase Integration
 * Handles real-time syncing of availability across users.
 */

// NOTE: You will need to replace these with your actual Firebase project config
// To get this: Go to Firebase Console > Project Settings > Apps > Add App (Web)
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "YOUR_MESSAGING_ID",
    appId: "YOUR_APP_ID"
};

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, doc, onSnapshot, setDoc, updateDoc, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export async function syncAvailability(roomId, userName, slots) {
    if (!roomId) return;
    const roomRef = doc(db, "rooms", roomId);
    
    await setDoc(roomRef, {
        [userName]: Array.from(slots)
    }, { merge: true });
}

export function listenToRoom(roomId, callback) {
    if (!roomId) return;
    const roomRef = doc(db, "rooms", roomId);
    
    return onSnapshot(roomRef, (doc) => {
        if (doc.exists()) {
            callback(doc.data());
        }
    });
}
