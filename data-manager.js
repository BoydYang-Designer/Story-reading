/* Data Manager Module */

// ============================================
// Data Manager Functions
// ============================================

function showDataManager() {
    showView(dataManagerView);
    renderDataManager();
}

function renderDataManager() {
    renderSavedWordsEditor();
    renderReadingProgressEditor();
    renderLastSessionEditor();
}

// ============================================
// Saved Words Editor
// ============================================

function renderSavedWordsEditor() {
    if (!savedWordsEditor) return;
    
    savedWordsEditor.innerHTML = '';
    
    if (!savedWords || Object.keys(savedWords).length === 0) {
        savedWordsEditor.innerHTML = '<div class="empty-state">No saved words yet.</div>';
        return;
    }
    
    // Calculate statistics
    let totalWords = 0, totalPhrases = 0, totalSentences = 0;
    Object.keys(savedWords).forEach(categoryKey => {
        Object.keys(savedWords[categoryKey]).forEach(storyKey => {
            const words = savedWords[categoryKey][storyKey];
            if (words && words.length > 0) {
                const categorized = categorizeWords(words);
                totalWords += categorized.words.length;
                totalPhrases += categorized.phrases.length;
                totalSentences += categorized.sentences.length;
            }
        });
    });
    
    // Display statistics
    const statsDiv = document.createElement('div');
    statsDiv.className = 'data-stats';
    statsDiv.innerHTML = `
        <div class="stat-item">
            <div class="stat-number">${totalWords}</div>
            <div class="stat-label">Words</div>
        </div>
        <div class="stat-item">
            <div class="stat-number">${totalPhrases}</div>
            <div class="stat-label">Phrases</div>
        </div>
        <div class="stat-item">
            <div class="stat-number">${totalSentences}</div>
            <div class="stat-label">Sentences</div>
        </div>
        <div class="stat-item">
            <div class="stat-number">${totalWords + totalPhrases + totalSentences}</div>
            <div class="stat-label">Total</div>
        </div>
    `;
    savedWordsEditor.appendChild(statsDiv);
    
    // Group by category and story
    Object.keys(savedWords).forEach(categoryKey => {
        const categoryGroup = document.createElement('div');
        categoryGroup.className = 'category-group';
        
        const categoryTitle = document.createElement('div');
        categoryTitle.className = 'category-group-title';
        categoryTitle.textContent = categoryKey;
        categoryGroup.appendChild(categoryTitle);
        
        Object.keys(savedWords[categoryKey]).forEach(storyKey => {
            const storyGroup = document.createElement('div');
            storyGroup.className = 'story-group';
            
            const storyTitle = document.createElement('div');
            storyTitle.className = 'story-group-title';
            storyTitle.textContent = storyKey;
            storyGroup.appendChild(storyTitle);
            
            const words = savedWords[categoryKey][storyKey];
            if (words && words.length > 0) {
                // Categorize words by type
                const categorized = categorizeWords(words);
                
                // Display Words
                if (categorized.words.length > 0) {
                    const wordsSection = document.createElement('div');
                    wordsSection.className = 'word-type-section';
                    
                    const wordsHeader = document.createElement('div');
                    wordsHeader.className = 'word-type-header';
                    wordsHeader.textContent = `Words (${categorized.words.length})`;
                    wordsSection.appendChild(wordsHeader);
                    
                    categorized.words.forEach(item => {
                        const wordEntry = createWordEntry(item.word, categoryKey, storyKey, item.index);
                        wordsSection.appendChild(wordEntry);
                    });
                    
                    storyGroup.appendChild(wordsSection);
                }
                
                // Display Phrases
                if (categorized.phrases.length > 0) {
                    const phrasesSection = document.createElement('div');
                    phrasesSection.className = 'word-type-section';
                    
                    const phrasesHeader = document.createElement('div');
                    phrasesHeader.className = 'word-type-header';
                    phrasesHeader.textContent = `Phrases (${categorized.phrases.length})`;
                    phrasesSection.appendChild(phrasesHeader);
                    
                    categorized.phrases.forEach(item => {
                        const wordEntry = createWordEntry(item.word, categoryKey, storyKey, item.index);
                        phrasesSection.appendChild(wordEntry);
                    });
                    
                    storyGroup.appendChild(phrasesSection);
                }
                
                // Display Sentences
                if (categorized.sentences.length > 0) {
                    const sentencesSection = document.createElement('div');
                    sentencesSection.className = 'word-type-section';
                    
                    const sentencesHeader = document.createElement('div');
                    sentencesHeader.className = 'word-type-header';
                    sentencesHeader.textContent = `Sentences (${categorized.sentences.length})`;
                    sentencesSection.appendChild(sentencesHeader);
                    
                    categorized.sentences.forEach(item => {
                        const wordEntry = createWordEntry(item.word, categoryKey, storyKey, item.index);
                        sentencesSection.appendChild(wordEntry);
                    });
                    
                    storyGroup.appendChild(sentencesSection);
                }
            }
            
            // Add new word button
            const addWordForm = createAddWordForm(categoryKey, storyKey);
            storyGroup.appendChild(addWordForm);
            
            categoryGroup.appendChild(storyGroup);
        });
        
        savedWordsEditor.appendChild(categoryGroup);
    });
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

function createWordEntry(word, categoryKey, storyKey, index) {
    const entry = document.createElement('div');
    entry.className = 'word-entry';
    
    const text = document.createElement('div');
    text.className = 'word-entry-text';
    text.textContent = word;
    
    // Add word length indicator
    const wordCount = word.trim().split(/\s+/).length;
    if (wordCount > 1) {
        const badge = document.createElement('span');
        badge.className = 'word-count-badge';
        badge.textContent = `${wordCount} words`;
        text.appendChild(badge);
    }
    
    entry.appendChild(text);
    
    const actions = document.createElement('div');
    actions.className = 'word-entry-actions';
    
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete';
    deleteBtn.className = 'secondary';
    deleteBtn.addEventListener('click', () => {
        deleteWord(categoryKey, storyKey, index);
    });
    
    actions.appendChild(deleteBtn);
    entry.appendChild(actions);
    
    return entry;
}

function createAddWordForm(categoryKey, storyKey) {
    const form = document.createElement('div');
    form.className = 'add-word-inline';
    
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Add new word...';
    
    const addBtn = document.createElement('button');
    addBtn.textContent = 'Add';
    addBtn.addEventListener('click', () => {
        const word = input.value.trim();
        if (word) {
            addWord(categoryKey, storyKey, word);
            input.value = '';
        }
    });
    
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            addBtn.click();
        }
    });
    
    form.appendChild(input);
    form.appendChild(addBtn);
    
    return form;
}

function deleteWord(categoryKey, storyKey, index) {
    if (!savedWords[categoryKey] || !savedWords[categoryKey][storyKey]) return;
    
    const word = savedWords[categoryKey][storyKey][index];
    if (confirm(`Delete "${word}"?`)) {
        savedWords[categoryKey][storyKey].splice(index, 1);
        
        // Clean up empty arrays/objects
        if (savedWords[categoryKey][storyKey].length === 0) {
            delete savedWords[categoryKey][storyKey];
        }
        if (Object.keys(savedWords[categoryKey]).length === 0) {
            delete savedWords[categoryKey];
        }
        
        saveWordsToStorage();
        renderSavedWordsEditor();
    }
}

function addWord(categoryKey, storyKey, word) {
    if (!savedWords[categoryKey]) {
        savedWords[categoryKey] = {};
    }
    if (!savedWords[categoryKey][storyKey]) {
        savedWords[categoryKey][storyKey] = [];
    }
    
    savedWords[categoryKey][storyKey].push(word);
    saveWordsToStorage();
    renderSavedWordsEditor();
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
    const data = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        savedWords: savedWords,
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
                        // Merge and remove duplicates
                        const combined = [...savedWords[category][story], ...data.savedWords[category][story]];
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
