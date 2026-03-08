// ─── Firebase Configuration (same project as educational-games) ───
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyCjq-RUyiKNq-yJLSlSyBo304P0kiiqszQ",
    authDomain: "educational-games-family.firebaseapp.com",
    projectId: "educational-games-family",
    storageBucket: "educational-games-family.firebasestorage.app",
    messagingSenderId: "419182521964",
    appId: "1:419182521964:web:940d5e01f6a78cd5513249"
};

if (!firebase.apps.length) {
    firebase.initializeApp(FIREBASE_CONFIG);
}

const auth = firebase.auth();
const db = firebase.firestore();
let _currentUser = null;

// ─── Auth ───
async function signInWithGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
        await auth.signInWithPopup(provider);
    } catch (e) {
        console.error('Sign in failed:', e.message);
    }
}

async function signOut() {
    try {
        await auth.signOut();
    } catch (e) {
        console.error('Sign out failed:', e.message);
    }
}

// ─── Topic Progress ───
function topicLocalKey(subject, topicId) {
    return `staar_${subject}_${topicId}`;
}

async function saveTopicProgress(subject, topicId, data) {
    const key = topicLocalKey(subject, topicId);
    localStorage.setItem(key, JSON.stringify(data));

    if (_currentUser) {
        try {
            await db.collection('users').doc(_currentUser.uid)
                .collection('staar-topics').doc(`${subject}-${topicId}`)
                .set({
                    ...data,
                    subject,
                    topicId,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
        } catch (e) {
            console.error('Firestore save failed:', e.message);
        }
    }
}

async function loadTopicProgress(subject, topicId) {
    if (_currentUser) {
        try {
            const doc = await db.collection('users').doc(_currentUser.uid)
                .collection('staar-topics').doc(`${subject}-${topicId}`).get();
            if (doc.exists) {
                const data = doc.data();
                localStorage.setItem(topicLocalKey(subject, topicId), JSON.stringify(data));
                return data;
            }
        } catch (e) {
            console.error('Firestore load failed:', e.message);
        }
    }
    const stored = localStorage.getItem(topicLocalKey(subject, topicId));
    return stored ? JSON.parse(stored) : null;
}

async function loadAllTopicProgress(subject) {
    const result = {};

    if (_currentUser) {
        try {
            const snap = await db.collection('users').doc(_currentUser.uid)
                .collection('staar-topics')
                .where('subject', '==', subject)
                .get();
            snap.forEach(doc => {
                const data = doc.data();
                result[data.topicId] = data;
            });
            return result;
        } catch (e) {
            console.error('Firestore load all failed:', e.message);
        }
    }

    // Fall back to localStorage
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const prefix = `staar_${subject}_`;
        if (key && key.startsWith(prefix)) {
            const topicId = key.slice(prefix.length);
            try { result[topicId] = JSON.parse(localStorage.getItem(key)); } catch {}
        }
    }
    return result;
}

// ─── Test Results ───
async function saveTestResult(data) {
    const testId = `test_${Date.now()}`;
    localStorage.setItem(`staar_test_${testId}`, JSON.stringify(data));

    if (_currentUser) {
        try {
            await db.collection('users').doc(_currentUser.uid)
                .collection('staar-tests').doc(testId)
                .set({
                    ...data,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
        } catch (e) {
            console.error('Firestore test save failed:', e.message);
        }
    }
    return testId;
}

// ─── Auth State Listener ───
auth.onAuthStateChanged(async (user) => {
    _currentUser = user;

    if (user) {
        db.collection('users').doc(user.uid).set({
            displayName: user.displayName,
            email: user.email,
            photoURL: user.photoURL,
            lastSeen: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true }).catch(() => {});
    }

    window.dispatchEvent(new CustomEvent('authStateChanged', { detail: { user } }));
});

// ─── Global API ───
window.staarAuth = {
    signInWithGoogle,
    signOut,
    getUser: () => _currentUser,
    saveTopicProgress,
    loadTopicProgress,
    loadAllTopicProgress,
    saveTestResult
};
