// Local Storage Fallback Configuration
// This allows the app to work without Firebase using only browser localStorage
// Perfect for testing or offline use

// Mock Firebase initialization to prevent errors
window.firebase = window.firebase || {};

// Create a simple localStorage-based auth system
const mockAuth = {
  currentUser: null,
  isGuest: true,
  
  onAuthStateChanged(callback) {
    // Check if user was previously signed in
    const savedUser = localStorage.getItem('mockUser');
    if (savedUser) {
      this.currentUser = JSON.parse(savedUser);
      this.isGuest = this.currentUser.isGuest || false;
    } else {
      this.currentUser = null;
      this.isGuest = true;
    }
    callback(this.currentUser);
    return () => {}; // Return unsubscribe function
  },
  
  signInWithPopup(provider) {
    return Promise.resolve({
      user: {
        uid: 'local-user-' + Date.now(),
        email: 'local@example.com',
        displayName: 'Local User',
        isGuest: false
      }
    }).then(result => {
      this.currentUser = result.user;
      this.isGuest = false;
      localStorage.setItem('mockUser', JSON.stringify(result.user));
      return result;
    });
  },
  
  signInAnonymously() {
    return Promise.resolve({
      user: {
        uid: 'guest-' + Date.now(),
        isGuest: true,
        displayName: 'Guest'
      }
    }).then(result => {
      this.currentUser = result.user;
      this.isGuest = true;
      localStorage.setItem('mockUser', JSON.stringify(result.user));
      return result;
    });
  },
  
  signOut() {
    return Promise.resolve().then(() => {
      this.currentUser = null;
      this.isGuest = true;
      localStorage.removeItem('mockUser');
    });
  }
};

// Create a simple localStorage-based Firestore mock
const mockFirestore = {
  collection(collectionName) {
    return {
      doc(docId) {
        const fullPath = `${collectionName}/${docId}`;
        return {
          set(data, options) {
            const key = `firestore_${fullPath}`;
            const existing = localStorage.getItem(key);
            let finalData = data;
            
            if (options && options.merge && existing) {
              finalData = { ...JSON.parse(existing), ...data };
            }
            
            localStorage.setItem(key, JSON.stringify(finalData));
            return Promise.resolve();
          },
          
          get() {
            const key = `firestore_${fullPath}`;
            const data = localStorage.getItem(key);
            return Promise.resolve({
              exists: !!data,
              data() {
                return data ? JSON.parse(data) : null;
              }
            });
          },
          
          update(data) {
            const key = `firestore_${fullPath}`;
            const existing = localStorage.getItem(key);
            if (existing) {
              const updated = { ...JSON.parse(existing), ...data };
              localStorage.setItem(key, JSON.stringify(updated));
            }
            return Promise.resolve();
          },
          
          delete() {
            const key = `firestore_${fullPath}`;
            localStorage.removeItem(key);
            return Promise.resolve();
          }
        };
      }
    };
  }
};

// Mock Google Auth Provider
const GoogleAuthProvider = function() {};

// Initialize mock Firebase
if (!firebase.apps || firebase.apps.length === 0) {
  firebase.initializeApp = () => ({});
  firebase.auth = () => mockAuth;
  firebase.firestore = () => mockFirestore;
  firebase.auth.GoogleAuthProvider = GoogleAuthProvider;
  
  console.log('📱 Running in LOCAL MODE - Using localStorage instead of Firebase');
  console.log('💡 To use real Firebase, replace this file with your firebase-config.js');
}
