// Firebase Configuration Template
// 
// INSTRUCTIONS:
// 1. Go to https://console.firebase.google.com/
// 2. Select your project (or create a new one)
// 3. Go to Project Settings > General
// 4. Scroll down to "Your apps" section
// 5. Click on the Web app (</>) icon to register a web app
// 6. Copy the firebaseConfig object and replace the placeholder below
// 7. Enable Authentication (Google Sign-In) and Firestore in your Firebase console

const firebaseConfig = {
  apiKey: "YOUR_API_KEY_HERE",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Optional: Export for use in other files
// window.firebaseApp = firebase.app();
// window.firebaseAuth = firebase.auth();
// window.firebaseFirestore = firebase.firestore();
