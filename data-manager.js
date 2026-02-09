/* Data Manager Module */

// ============================================
// Data Manager Functions
// ============================================

function showDataManager() {
    showView(dataManagerView);
    renderDataManager();
}

function renderDataManager() {
    renderReadingProgressEditor();
    renderLastSessionEditor();
}

// ============================================
// Note Export Functions (to be used in note view)
// ============================================

function exportCurrentNote(categoryKey, storyKey) {
    if (!savedWords[categoryKey] || !savedWords[categoryKey][storyKey]) {
        alert('No notes found for this story.');
        return;
    }
    
    let words = savedWords[categoryKey][storyKey];
    
    // Convert Firestore object format to array if needed
    if (words && typeof words === 'object' && !Array.isArray(words)) {
        words = Object.values(words);
    }
    
    if (!Array.isArray(words) || words.length === 0) {
        alert('No notes found for this story.');
        return;
    }
    
    const categorized = categorizeWords(words);
    
    const data = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        category: categoryKey,
        story: storyKey,
        statistics: {
            totalWords: categorized.words.length,
            totalPhrases: categorized.phrases.length,
            totalSentences: categorized.sentences.length,
            total: words.length
        },
        words: categorized.words.map(item => item.word),
        phrases: categorized.phrases.map(item => item.word),
        sentences: categorized.sentences.map(item => item.word),
        allNotes: words
    };
    
    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const fileName = `${categoryKey}-${storyKey}-notes-${new Date().toISOString().slice(0, 10)}.json`;
    a.download = fileName.replace(/[^a-z0-9.-]/gi, '_');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    alert('Note exported successfully!');
}

function exportAllNotes() {
    // Normalize savedWords to array format
    const normalizedNotes = {};
    let totalCount = 0;
    
    Object.keys(savedWords).forEach(category => {
        normalizedNotes[category] = {};
        Object.keys(savedWords[category]).forEach(story => {
            let words = savedWords[category][story];
            
            // Convert Firestore object format to array if needed
            if (words && typeof words === 'object' && !Array.isArray(words)) {
                words = Object.values(words);
            }
            
            if (Array.isArray(words) && words.length > 0) {
                const categorized = categorizeWords(words);
                normalizedNotes[category][story] = {
                    statistics: {
                        totalWords: categorized.words.length,
                        totalPhrases: categorized.phrases.length,
                        totalSentences: categorized.sentences.length,
                        total: words.length
                    },
                    words: categorized.words.map(item => item.word),
                    phrases: categorized.phrases.map(item => item.word),
                    sentences: categorized.sentences.map(item => item.word),
                    allNotes: words
                };
                totalCount += words.length;
            }
        });
        
        // Remove empty categories
        if (Object.keys(normalizedNotes[category]).length === 0) {
            delete normalizedNotes[category];
        }
    });
    
    if (totalCount === 0) {
        alert('No notes to export.');
        return;
    }
    
    const data = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        totalNotes: totalCount,
        notes: normalizedNotes
    };
    
    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `all-notes-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    alert(`Exported ${totalCount} notes successfully!`);
}

// Helper function to categorize words by type (same logic as in note view)
function categorizeWords(words) {
    const categorized = {
        words: [],
        phrases: [],
        sentences: []
    };
    
    words.forEach((word, index) => {
        const trimmed = word.trim();
        const wordCount = trimmed.split(/\s+/).length;
        
        if (wordCount === 1) {
            categorized.words.push({ word: trimmed, index });
        } else if (wordCount >= 2 && wordCount <= 5) {
            categorized.phrases.push({ word: trimmed, index });
        } else {
            categorized.sentences.push({ word: trimmed, index });
        }
    });
    
    return categorized;
}

// ============================================
// Reading Progress Editor
// ============================================

function renderReadingProgressEditor() {
    if (!readingProgressEditor) return;
    
    readingProgressEditor.innerHTML = '';
    
    const progressData = localStorage.getItem(SUB_CATEGORY_SESSION_KEY);
    if (!progressData) {
        readingProgressEditor.innerHTML = '<div class="empty-state">No reading progress data.</div>';
        return;
    }
    
    try {
        const progress = JSON.parse(progressData);
        
        if (Object.keys(progress).length === 0) {
            readingProgressEditor.innerHTML = '<div class="empty-state">No reading progress data.</div>';
            return;
        }
        
        Object.keys(progress).forEach(key => {
            const item = document.createElement('div');
            item.className = 'data-item';
            
            const header = document.createElement('div');
            header.className = 'data-item-header';
            header.textContent = key;
            item.appendChild(header);
            
            const content = document.createElement('div');
            content.className = 'data-item-content';
            content.textContent = JSON.stringify(progress[key], null, 2);
            item.appendChild(content);
            
            const actions = document.createElement('div');
            actions.className = 'data-item-actions';
            
            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = 'Delete';
            deleteBtn.className = 'secondary';
            deleteBtn.addEventListener('click', () => {
                if (confirm(`Delete progress for "${key}"?`)) {
                    delete progress[key];
                    localStorage.setItem(SUB_CATEGORY_SESSION_KEY, JSON.stringify(progress));
                    renderReadingProgressEditor();
                }
            });
            
            actions.appendChild(deleteBtn);
            item.appendChild(actions);
            
            readingProgressEditor.appendChild(item);
        });
    } catch (e) {
        readingProgressEditor.innerHTML = '<div class="empty-state">Error parsing progress data.</div>';
    }
}

// ============================================
// Last Session Editor
// ============================================

function renderLastSessionEditor() {
    if (!lastSessionEditor) return;
    
    lastSessionEditor.innerHTML = '';
    
    const sessionData = localStorage.getItem(LAST_SESSION_KEY);
    if (!sessionData) {
        lastSessionEditor.innerHTML = '<div class="empty-state">No last session data.</div>';
        return;
    }
    
    try {
        const session = JSON.parse(sessionData);
        
        const item = document.createElement('div');
        item.className = 'data-item';
        
        const header = document.createElement('div');
        header.className = 'data-item-header';
        header.textContent = 'Last Session';
        item.appendChild(header);
        
        const content = document.createElement('div');
        content.className = 'data-item-content';
        content.textContent = JSON.stringify(session, null, 2);
        item.appendChild(content);
        
        const actions = document.createElement('div');
        actions.className = 'data-item-actions';
        
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = 'Clear';
        deleteBtn.className = 'secondary';
        deleteBtn.addEventListener('click', () => {
            if (confirm('Clear last session data?')) {
                localStorage.removeItem(LAST_SESSION_KEY);
                renderLastSessionEditor();
            }
        });
        
        actions.appendChild(deleteBtn);
        item.appendChild(actions);
        
        lastSessionEditor.appendChild(item);
    } catch (e) {
        lastSessionEditor.innerHTML = '<div class="empty-state">Error parsing session data.</div>';
    }
}

// ============================================
// Export / Import Functions
// ============================================

function exportAllData() {
    // Normalize savedWords to array format
    const normalizedSavedWords = {};
    
    Object.keys(savedWords).forEach(category => {
        normalizedSavedWords[category] = {};
        Object.keys(savedWords[category]).forEach(story => {
            let words = savedWords[category][story];
            
            // Convert Firestore object format to array if needed
            if (words && typeof words === 'object' && !Array.isArray(words)) {
                words = Object.values(words);
            }
            
            // Ensure it's an array
            normalizedSavedWords[category][story] = Array.isArray(words) ? words : [];
        });
    });
    
    const data = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        savedWords: normalizedSavedWords,
        readingProgress: {},
        lastSession: null
    };
    
    // Get reading progress
    const progressData = localStorage.getItem(SUB_CATEGORY_SESSION_KEY);
    if (progressData) {
        try {
            data.readingProgress = JSON.parse(progressData);
        } catch (e) {
            console.error('Error parsing reading progress:', e);
        }
    }
    
    // Get last session
    const sessionData = localStorage.getItem(LAST_SESSION_KEY);
    if (sessionData) {
        try {
            data.lastSession = JSON.parse(sessionData);
        } catch (e) {
            console.error('Error parsing last session:', e);
        }
    }
    
    // Create and download file
    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reading-challenge-data-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    alert('Data exported successfully!');
}

function importData(file) {
    const reader = new FileReader();
    
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            
            // Validate data structure
            if (!data.version) {
                throw new Error('Invalid data format: missing version');
            }
            
            const confirmMsg = `Import data from ${data.exportDate}?\n\nThis will:\n- Merge saved words\n- Replace reading progress\n- Replace last session\n\nContinue?`;
            
            if (!confirm(confirmMsg)) {
                return;
            }
            
            // Import saved words (merge)
            if (data.savedWords) {
                Object.keys(data.savedWords).forEach(category => {
                    if (!savedWords[category]) {
                        savedWords[category] = {};
                    }
                    Object.keys(data.savedWords[category]).forEach(story => {
                        if (!savedWords[category][story]) {
                            savedWords[category][story] = [];
                        }
                        
                        // Handle both array format (localStorage) and object format (Firestore)
                        let importedWords = data.savedWords[category][story];
                        
                        // If it's a Firestore object format, convert to array
                        if (importedWords && typeof importedWords === 'object' && !Array.isArray(importedWords)) {
                            // Firestore format: { "0": "word1", "1": "word2", ... }
                            importedWords = Object.values(importedWords);
                        }
                        
                        // Make sure it's an array
                        if (!Array.isArray(importedWords)) {
                            console.warn(`Skipping invalid data for ${category}/${story}`);
                            return;
                        }
                        
                        // Merge and remove duplicates
                        const combined = [...savedWords[category][story], ...importedWords];
                        savedWords[category][story] = [...new Set(combined)];
                    });
                });
                saveWordsToStorage();
            }
            
            // Import reading progress (replace)
            if (data.readingProgress) {
                localStorage.setItem(SUB_CATEGORY_SESSION_KEY, JSON.stringify(data.readingProgress));
            }
            
            // Import last session (replace)
            if (data.lastSession) {
                localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(data.lastSession));
            }
            
            renderDataManager();
            alert('Data imported successfully!');
            
        } catch (e) {
            alert('Error importing data: ' + e.message);
            console.error('Import error:', e);
        }
    };
    
    reader.readAsText(file);
}

function saveWordsToStorage() {
    if (currentUser && !currentUser.isAnonymous) {
        // Save to Firestore
        saveWordsToFirestore();
    } else {
        // Save to localStorage
        localStorage.setItem(SAVED_WORDS_KEY, JSON.stringify(savedWords));
    }
}

// ============================================
// Event Listeners
// ============================================

if (goToDataManagerBtn) {
    goToDataManagerBtn.addEventListener('click', showDataManager);
}

if (backToHomeFromDataManagerBtn) {
    backToHomeFromDataManagerBtn.addEventListener('click', () => {
        showView(homeView);
        renderHome();
    });
}

if (exportAllDataBtn) {
    exportAllDataBtn.addEventListener('click', exportAllData);
}

if (importDataBtn) {
    importDataBtn.addEventListener('click', () => {
        importDataInput.click();
    });
}

if (importDataInput) {
    importDataInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            importData(file);
        }
        // Reset input so same file can be selected again
        e.target.value = '';
    });
}

// Note export buttons
if (exportCurrentNoteJsonBtn) {
    exportCurrentNoteJsonBtn.addEventListener('click', () => {
        if (noteViewCategory && noteViewTitle) {
            exportCurrentNote(noteViewCategory, noteViewTitle);
        } else {
            alert('Please open a specific story note first.');
        }
    });
}

if (exportAllNotesJsonBtn) {
    exportAllNotesJsonBtn.addEventListener('click', () => {
        exportAllNotes();
    });
}
