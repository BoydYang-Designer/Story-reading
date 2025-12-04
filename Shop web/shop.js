let db = [];
const STORAGE_KEY = 'shopping_app_data_v1';

// 初始化
function init() {
    const storedData = localStorage.getItem(STORAGE_KEY);
    if (storedData) {
        try {
            db = JSON.parse(storedData);
        } catch(e) {
            console.error("資料損毀，重置資料庫");
            db = [];
        }
    }
    
    // 如果資料庫完全是空的，才加入預設資料，避免每次覆蓋
    if (db.length === 0) {
        // 這裡可以放您之前的預設 initialData，或保持空白
    }
    
    setupTabs();
    populateYears();
    renderList('all');
    document.getElementById('date').valueAsDate = new Date();
}

function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    renderList(getCurrentCategory());
}

// --- 匯入與匯出功能區 ---

const importBtn = document.getElementById('importBtn');
const importFile = document.getElementById('importFile');
const exportBtn = document.getElementById('exportBtn');

// 觸發檔案選擇
importBtn.addEventListener('click', () => {
    importFile.click();
});

// 處理檔案讀取
importFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const importedData = JSON.parse(event.target.result);
            if (!Array.isArray(importedData)) {
                alert("檔案格式錯誤：內容不是清單陣列");
                return;
            }
            mergeData(importedData);
        } catch (error) {
            alert("匯入失敗：檔案格式不正確 (JSON 解析錯誤)");
            console.error(error);
        }
        // 清空 input 讓下次能再選同個檔案
        importFile.value = '';
    };
    reader.readAsText(file);
});

// 資料合併邏輯 (防止重複)
function mergeData(newData) {
    let addedCount = 0;
    
    // 建立現有資料的特徵雜湊 (Unique Key: Date + Store + Name + Price)
    // 這樣就算 ID 不同，但內容完全一樣的舊資料就不會被重複加入
    const existingSignatures = new Set(db.map(item => 
        `${item.date}|${item.store}|${item.name.trim()}|${item.price}`
    ));

    newData.forEach(item => {
        // 確保必要欄位存在
        if (!item.date || !item.name) return;

        const signature = `${item.date}|${item.store}|${item.name.trim()}|${item.price}`;
        
        if (!existingSignatures.has(signature)) {
            // 賦予新 ID 避免 ID 衝突 (如果是從 Python 來的已經有 UUID，如果是舊備份則可能有衝突)
            // 簡單起見，如果是外部匯入，我們可以信任它的 ID 或是重產一個，這裡選擇保留 Python 產的 ID
            // 但為了安全，檢查 ID 是否已存在
            const idExists = db.some(d => d.id === item.id);
            if(idExists) {
                item.id = Date.now() + Math.random().toString(16).slice(2);
            }
            
            db.push(item);
            existingSignatures.add(signature);
            addedCount++;
        }
    });

    if (addedCount > 0) {
        saveData();
        populateYears();
        alert(`成功匯入 ${addedCount} 筆新資料！\n(已自動忽略 ${newData.length - addedCount} 筆重複資料)`);
        // 重新整理頁面
        location.reload(); 
    } else {
        alert("匯入資料似乎都已存在於系統中，沒有新增任何項目。");
    }
}

// 匯出
exportBtn.addEventListener('click', () => {
    const dataStr = JSON.stringify(db, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `購物備份_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
});

// --- 以下為既有的 UI 邏輯 (保持不變，或微調) ---

const searchYear = document.getElementById('searchYear');
const searchMonth = document.getElementById('searchMonth');
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');
const analysisOutput = document.getElementById('analysisOutput');
const shoppingListEl = document.getElementById('shoppingList');
const addForm = document.getElementById('addForm');
let currentEditId = null;

function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.target).classList.add('active');
        });
    });
}

function populateYears() {
    searchYear.innerHTML = '<option value="">所有年份</option>';
    const years = [...new Set(db.map(item => item.date.split('-')[0]))].sort().reverse();
    years.forEach(y => {
        const opt = document.createElement('option');
        opt.value = y;
        opt.textContent = y + '年';
        searchYear.appendChild(opt);
    });
}

function renderList(category) {
    shoppingListEl.innerHTML = '';
    let filtered = db.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    if (category !== 'all') {
        filtered = filtered.filter(item => item.tags && item.tags.includes(category));
    }

    // 限制顯示數量以提升效能 (手機上如果資料太多會卡)
    const displayLimit = 50; 
    const displayList = filtered.slice(0, displayLimit);

    displayList.forEach(item => {
        const card = document.createElement('div');
        card.className = `item-card store-${item.store}`;
        
        // 判斷是否為歷史最低價
        const history = db.filter(i => i.name === item.name);
        const minPrice = history.length > 0 ? Math.min(...history.map(i => i.price)) : 0;
        const isLowest = history.length > 1 && item.price <= minPrice && item.price > 0;

        card.innerHTML = `
            <div class="item-header">
                <div>
                    <div class="item-name">${item.name}</div>
                    <div class="item-meta">${item.date} | ${item.store} ${item.spec ? '| ' + item.spec : ''}</div>
                </div>
                <div class="item-price">$${item.price}</div>
            </div>
            <div class="item-tags">
                ${item.tags ? item.tags.map(t => `<span>${t}</span>`).join('') : ''}
            </div>
            ${item.note ? `<div style="font-size:0.8rem; color:#888; margin-top:5px;">${item.note}</div>` : ''}
            ${isLowest ? `<div class="cp-badge"><i class="fas fa-thumbs-up"></i> 歷史最低</div>` : ''}
            <button class="edit-btn" onclick="editItem('${item.id}')"><i class="fas fa-edit"></i></button>
        `;
        shoppingListEl.appendChild(card);
    });
    
    if (filtered.length > displayLimit) {
        const moreDiv = document.createElement('div');
        moreDiv.style.textAlign = 'center';
        moreDiv.style.padding = '10px';
        moreDiv.style.color = '#666';
        moreDiv.textContent = `還有 ${filtered.length - displayLimit} 筆資料... 請使用搜尋功能查看`;
        shoppingListEl.appendChild(moreDiv);
    }
}

function getCurrentCategory() {
    const activeBtn = document.querySelector('.cat-btn.active');
    if (!activeBtn) return 'all';
    if (activeBtn.textContent.includes('Home')) return 'Home';
    if (activeBtn.textContent.includes('Family')) return 'Family';
    if (activeBtn.textContent.includes('舅舅')) return 'Uncle';
    return 'all';
}

function filterCategory(cat) {
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    renderList(cat);
}

// 搜尋與分析
function performSearch() {
    const year = searchYear.value;
    const month = searchMonth.value;
    const kw = searchInput.value.toLowerCase().trim();

    searchResults.innerHTML = '';
    analysisOutput.innerHTML = '';

    if (!kw && !year && !month) return;

    const results = db.filter(item => {
        const d = new Date(item.date);
        const matchYear = year ? d.getFullYear().toString() === year : true;
        const matchMonth = month ? (d.getMonth() + 1).toString() === month : true;
        const matchName = kw ? (item.name.toLowerCase().includes(kw) || item.store.toLowerCase().includes(kw)) : true;
        return matchYear && matchMonth && matchName;
    });

    results.forEach(item => {
        const div = document.createElement('div');
        div.className = 'history-row';
        div.innerHTML = `<span>${item.date} (${item.store})</span><span>${item.name} - <b>$${item.price}</b></span>`;
        div.onclick = () => analyzeItem(item.name);
        div.style.cursor = 'pointer';
        searchResults.appendChild(div);
    });

    if (results.length === 0) searchResults.innerHTML = '<p style="text-align:center; color:#999;">沒有找到紀錄</p>';
    if (kw && results.length > 0) analyzeItem(results[0].name);
}

function analyzeItem(itemName) {
    const history = db.filter(i => i.name === itemName).sort((a, b) => new Date(a.date) - new Date(b.date));
    if (history.length === 0) return;

    const prices = history.map(i => i.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const avgPrice = (prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(0);

    let freqText = "資料不足";
    if (history.length > 1) {
        const days = (new Date(history[history.length-1].date) - new Date(history[0].date)) / (1000*3600*24);
        if (days > 0) freqText = `平均每 ${(days / (history.length - 1)).toFixed(0)} 天 1 次`;
    }

    const bestDate = history.find(i => i.price === minPrice).date;

    analysisOutput.innerHTML = `
        <div style="background:#f8fafc; padding:10px; border-radius:8px; border:1px solid #e2e8f0;">
            <h4 style="color:#2563eb; margin-bottom:8px;">${itemName}</h4>
            <p>頻率: ${history.length} 次 (${freqText})</p>
            <p>價格: $${minPrice} ~ $${maxPrice} (均 $${avgPrice})</p>
            <p class="lowest-highlight">最佳購買點: $${minPrice} (${bestDate})</p>
        </div>
    `;
}

searchInput.addEventListener('input', performSearch);
searchYear.addEventListener('change', performSearch);
searchMonth.addEventListener('change', performSearch);

// 編輯與新增
addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const tags = [];
    if (document.getElementById('tagHome').checked) tags.push('Home');
    if (document.getElementById('tagFamily').checked) tags.push('Family');
    if (document.getElementById('tagUncle').checked) tags.push('Uncle');

    const item = {
        id: currentEditId || (Date.now() + Math.random().toString(16).slice(2)),
        date: document.getElementById('date').value,
        store: document.getElementById('store').value,
        name: document.getElementById('itemName').value,
        price: parseInt(document.getElementById('price').value),
        spec: document.getElementById('spec').value,
        tags: tags,
        note: document.getElementById('note').value
    };

    if (currentEditId) {
        const index = db.findIndex(i => i.id === currentEditId);
        if(index !== -1) db[index] = item;
    } else {
        db.push(item);
    }
    
    saveData();
    resetForm();
    alert('儲存成功！');
    populateYears();
});

function editItem(id) {
    const item = db.find(i => i.id === id);
    if (!item) return;
    document.getElementById('date').value = item.date;
    document.getElementById('store').value = item.store;
    document.getElementById('itemName').value = item.name;
    document.getElementById('price').value = item.price;
    document.getElementById('spec').value = item.spec || '';
    document.getElementById('note').value = item.note || '';
    document.getElementById('tagHome').checked = item.tags && item.tags.includes('Home');
    document.getElementById('tagFamily').checked = item.tags && item.tags.includes('Family');
    document.getElementById('tagUncle').checked = item.tags && item.tags.includes('Uncle');

    currentEditId = id;
    document.getElementById('formTitle').textContent = '編輯項目';
    document.querySelector('.submit-btn').textContent = '更新資料';
    document.getElementById('cancelEdit').style.display = 'block';
    document.querySelector('[data-target="add"]').click();
}

function resetForm() {
    addForm.reset();
    currentEditId = null;
    document.getElementById('formTitle').textContent = '新增購買紀錄';
    document.querySelector('.submit-btn').textContent = '儲存資料';
    document.getElementById('cancelEdit').style.display = 'none';
    document.getElementById('date').valueAsDate = new Date();
}

document.getElementById('cancelEdit').addEventListener('click', resetForm);

init();