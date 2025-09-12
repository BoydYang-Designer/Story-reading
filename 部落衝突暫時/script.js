document.addEventListener('DOMContentLoaded', () => {
    const app = {
        // --- 設定 ---
        ITEMS_PER_PAGE: 20,
        STORAGE_KEY: 'personalTrackerData',
        
        // --- 狀態 ---
        data: null,
        
        // --- 可用的 Icon 列表 ---
        availableIcons: [
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAP+6SURBVHgB/1sJ/xXVffb/z73JvUlCCEEECCEk9957773fUCAUAQVFFBBRQXxABVTUqIgfBBUU0UUQRUQFBUR8r7333nvv/c5kMv/v9+zZ92RyyWRmSTIfz/nxyTzjzZ6zZ89+s2fPnj1/f//jH/+44f7773+Lfvzxxz/40Y9+9OM//elPf/rzn//85z//+c9//vOf//znP//5z3/+85///Oc///nPf/7zn//85z//+c9///Of//znP//5z3/+85///Oc///nPf/7zn//85z//+c9///Of//znP//5z3/+85///Oc///nPf/7zn//85z//+c9///Of//znP//5z3/+85///Oc///nPf/7zn//85z//+c9///Of//znP//5z3/+85///Oc///nPf/7zn//85z//+c9///Of//znP//5z3/+85///Oc///nPf/7zn//85z//+c9///Of//znP//5z3/+85///Oc///nPf/7zn//85z//+c9///Of//znP//5z3/+85///Oc///nPf/7zn//85z//+c9///Of//znP//5z3/+85///Oc///nPf/7zn//85z//+c9///Of//znP//5z3/+85///Oc///nPf/7zn//85z//+c9///Of//znP//5z3/+85///Oc///nPf/7zn//85z//+c9///Of//znP//5z3/+85///Oc///nPf/7zn//85z//+c9///Of//znP//5z3/+85///Oc///nPf/7zn//85z//+c9///Of//znP//5z3/+85///Oc///nPf/7zn//85z//+c9///Of//znP//5z3/+85///Oc///nPf/7zn//85z//+c9///Of//znP//5z3/+85///Oc///nPf/7zn//85z//+c9///Of//znP//5z3/+85///Oc///nPf/7zn//85z//+c9///Of//znP//5z3/+85///Oc///nPf/7zn//85z//+c9///Of//znP//5z3/+85///Oc///nPf/7zn//85z//+c9///Of//znP//5z3/+85///Oc///nPf/7zn//85z//+c9///Of//znP//5z3/+85///Oc///nPf/7zn//85z//+c9///Of//znP//5z3/+85///Oc///nPf/7zn//85z//+c9///Of//znP//81//+5z+f+9znfvd3f/eXv/zl3/zN3/75z3/++9///vd///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///d///-TRADEMARK_SIGN-9d62d2a452a8a5f0391696b99330a7796d13636f2e26922d4f23e429f0326442',
            'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzQ3NTU2OSIgd2lkdGg9IjI0cHgiIGhlaWdodD0iMjRweCI+PHBhdGggZD0iTTEyIDJDNi40OCAyIDIgNi40OCAyIDEyczQuNDggMTAgMTAgMTAgMTAtNC40OCAxMC0xMFMxNy41MiAyIDEyIDJ6bTEgMTVoLTJ2LTJoMnYyem0wLTRoLTJWN2gydjZ6Ii8+PC9zdmc+',
            'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzQ3NTU2OSIgd2lkdGg9IjI0cHgiIGhlaWdodD0iMjRweCI+PHBhdGggZD0iTTcgMTBoMnY3SDd6bTRtMWgzdjdIMTJ6bTRtMWgydjdoLTJ6TTIyIDRINlYyaDR2Mmg4di0yaDR2MnpNMjAgMjJINEwxIDdoMjJ6Ii8+PC9zdmc+',
            'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzQ3NTU2OSIgd2lkdGg9IjI0cHgiIGhlaWdodD0iMjRweCI+PHBhdGggZD0iTTIgMTdoMjBWMkgydjE1em0yMC0zSDE0di0yaDR2Mmgyek0yIDIxaDIwdjRIMnoiLz48L3N2Zz4=',
            'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzQ3NTU2OSIgd2lkdGg9IjI0cHgiIGhlaWdodD0iMjRweCI+PHBhdGggZD0iTTExLjggMi4xTDQgNnY1MnY2bDcuOCAzLjlsNy44LTMuOVY2bC03LjgtMy45ek0xMiAxMi4yTDUgOGw3LTN2Ny4yem0wIDEwLjNsNy0zLjVWOGwtNyA0LjJ2OC4zek02IDE2LjVsNiAzLjJWMTMuMkw2IDEwLjR2Ni4xek0xOCAxNi41TDEyIDE5LjlWMTMuMmw2LTMuMnY2LjF6Ii8+PC9zdmc+',
            'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0iIzQ3NTU2OSIgd2lkdGg9IjI0cHgiIGhlaWdodD0iMjRweCI+PHBhdGggZD0iTTEwIDE4aDQuOHYtMkgxMHpNMyAyMmgxOFYySDN2MjB6bTItMTZoMTR2MTQuMzZIMVY2aDR6Ii8+PC9zdmc+',
        ],

        // --- DOM 元素 ---
        mainContent: document.getElementById('main-content'),
        iconPopup: document.getElementById('icon-select-popup'),

        // --- 初始化 ---
        init() {
            this.loadData();
            this.populateIconPopup();
            this.render();
            this.addGlobalListeners();
        },

        // --- 資料處理 ---
        getDefaultData() {
            return {
                mainTitles: Array.from({ length: 5 }, (_, i) => ({
                    id: `main-${i + 1}`,
                    name: `主標題 ${i + 1}`,
                    icon: this.availableIcons[i % this.availableIcons.length],
                    subtitles: Array.from({ length: 2 }, (_, j) => ({
                        id: `sub-${i + 1}-${j + 1}`,
                        name: `副標題 ${(i * 2) + j + 1}`,
                        icon: this.availableIcons[(j + 1) % this.availableIcons.length],
                        isCollapsed: true,
                        data: [],
                        currentPage: 1,
                    }))
                }))
            };
        },

        loadData() {
            const savedData = localStorage.getItem(this.STORAGE_KEY);
            if (savedData) {
                this.data = JSON.parse(savedData);
            } else {
                this.data = this.getDefaultData();
            }
        },

        saveData() {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.data));
        },

        // --- 渲染 ---
        render() {
            this.mainContent.innerHTML = this.data.mainTitles.map(mainTitle => this.renderMainTitle(mainTitle)).join('');
        },
        
        renderMainTitle(mainTitle) {
            return `
                <div class="bg-white rounded-lg shadow-md mb-6" data-id="${mainTitle.id}">
                    <div class="p-4 border-b border-slate-200 flex justify-between items-center">
                        <div class="flex items-center gap-3 w-full">
                            <img src="${mainTitle.icon}" alt="icon" class="w-8 h-8 rounded-full cursor-pointer flex-shrink-0" data-action="show-icon-popup" data-type="main" data-id="${mainTitle.id}">
                            <h2 class="text-xl font-bold text-slate-800 w-full cursor-pointer" data-action="edit-title" data-type="main" data-id="${mainTitle.id}">${mainTitle.name}</h2>
                        </div>
                    </div>
                    <div class="p-4 space-y-4">
                        ${mainTitle.subtitles.map(subtitle => this.renderSubtitle(subtitle)).join('')}
                    </div>
                </div>
            `;
        },
        
        renderSubtitle(subtitle) {
            const isCollapsed = subtitle.isCollapsed;
            return `
                <div class="border border-slate-200 rounded-lg" data-id="${subtitle.id}">
                    <div class="p-3 bg-slate-50 rounded-t-lg flex justify-between items-center cursor-pointer" data-action="toggle-collapse" data-id="${subtitle.id}">
                        <div class="flex items-center gap-3 w-full">
                            <img src="${subtitle.icon}" alt="icon" class="w-7 h-7 rounded-full cursor-pointer flex-shrink-0" data-action="show-icon-popup" data-type="sub" data-id="${subtitle.id}">
                            <h3 class="text-lg font-semibold text-slate-700 w-full" data-action="edit-title" data-type="sub" data-id="${subtitle.id}">${subtitle.name}</h3>
                        </div>
                        <svg class="w-6 h-6 text-slate-500 transform transition-transform flex-shrink-0 ${isCollapsed ? '' : 'rotate-180'}" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                    </div>
                    <div class="subtitle-content ${isCollapsed ? 'hidden' : ''}">
                        ${this.renderDataTable(subtitle)}
                    </div>
                </div>
            `;
        },

        renderDataTable(subtitle) {
            const totalItems = subtitle.data.length;
            const totalPages = Math.ceil(totalItems / this.ITEMS_PER_PAGE);
            const start = (subtitle.currentPage - 1) * this.ITEMS_PER_PAGE;
            const end = start + this.ITEMS_PER_PAGE;
            const paginatedData = subtitle.data.slice(start, end);

            return `
                <div class="p-4">
                    <div class="overflow-x-auto">
                        <table class="min-w-full bg-white">
                            <thead class="table-header">
                                <tr>
                                    <th class="table-cell w-2/5">名稱</th>
                                    <th class="table-cell w-1/5">時間長度</th>
                                    <th class="table-cell w-1/5">單位</th>
                                    <th class="table-cell w-2/5">提醒時間</th>
                                    <th class="table-cell w-1/12">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${paginatedData.map(row => `
                                    <tr data-id="${row.id}" class="hover:bg-slate-50">
                                        <td class="table-cell">${row.name}</td>
                                        <td class="table-cell">${row.duration}</td>
                                        <td class="table-cell">${{minutes: '分鐘', hours: '小時', days: '天'}[row.unit]}</td>
                                        <td class="table-cell">${new Date(row.reminderTime).toLocaleString('zh-TW')}</td>
                                        <td class="table-cell">
                                            <button class="text-red-500 hover:text-red-700 font-semibold" data-action="delete-row" data-subtitle-id="${subtitle.id}" data-row-id="${row.id}">刪除</button>
                                        </td>
                                    </tr>
                                `).join('')}
                                ${totalItems === 0 ? '<tr><td colspan="5" class="text-center p-4 text-slate-500">暫無資料</td></tr>' : ''}
                            </tbody>
                        </table>
                    </div>
                   
                    <form class="mt-4 p-4 bg-slate-50 rounded-lg flex flex-wrap items-center gap-4" data-action="add-row" data-id="${subtitle.id}">
                        <input type="text" name="name" placeholder="名稱" class="form-input flex-grow rounded-md border-slate-300" required>
                        <input type="number" name="duration" placeholder="時間長度" class="form-input w-28 rounded-md border-slate-300" min="1" required>
                        <select name="unit" class="form-select rounded-md border-slate-300">
                            <option value="minutes">分鐘</option>
                            <option value="hours">小時</option>
                            <option value="days">天</option>
                        </select>
                        <button type="submit" class="bg-blue-600 text-white font-bold py-2 px-4 rounded-md hover:bg-blue-700 transition-colors">新增一列</button>
                    </form>

                    ${totalPages > 1 ? this.renderPagination(subtitle.id, subtitle.currentPage, totalPages) : ''}
                </div>
            `;
        },

        renderPagination(subtitleId, currentPage, totalPages) {
            let pagesHtml = '';
            for (let i = 1; i <= totalPages; i++) {
                pagesHtml += `<button class="px-3 py-1 rounded-md ${i === currentPage ? 'bg-blue-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}" data-action="change-page" data-subtitle-id="${subtitleId}" data-page="${i}">${i}</button>`;
            }
            return `
                <div class="mt-4 flex justify-center items-center gap-2">
                    <button class="px-3 py-1 rounded-md bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-50" data-action="change-page" data-subtitle-id="${subtitleId}" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''}>上一頁</button>
                    ${pagesHtml}
                    <button class="px-3 py-1 rounded-md bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-50" data-action="change-page" data-subtitle-id="${subtitleId}" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''}>下一頁</button>
                </div>
            `;
        },

        populateIconPopup() {
            this.iconPopup.innerHTML = this.availableIcons.map(iconSrc => `
                <img src="${iconSrc}" class="w-10 h-10 p-1 cursor-pointer rounded-full hover:bg-slate-200" data-action="select-icon" data-icon-src="${iconSrc}">
            `).join('');
        },

        // --- 事件處理 ---
        addGlobalListeners() {
            this.mainContent.addEventListener('click', this.handleMainContentClick.bind(this));
            this.mainContent.addEventListener('submit', this.handleFormSubmit.bind(this));
            this.iconPopup.addEventListener('click', this.handleIconSelect.bind(this));
            document.addEventListener('click', this.handleDocumentClick.bind(this));
        },

        handleMainContentClick(e) {
            const target = e.target;
            const action = target.dataset.action;

            if (!action) return;

            // Stop propagation if we're editing a title to prevent parent actions (like toggle)
            if (action === 'edit-title') {
                e.stopPropagation();
                this.editTitle(target);
                return;
            }

            // For other actions, find the closest element with that action
            const actionTarget = target.closest(`[data-action="${action}"]`);
            if (!actionTarget) return;

            e.stopPropagation();

            switch (action) {
                case 'toggle-collapse':
                    this.toggleCollapse(actionTarget.dataset.id);
                    break;
                case 'delete-row':
                    this.deleteRow(actionTarget.dataset.subtitleId, actionTarget.dataset.rowId);
                    break;
                case 'show-icon-popup':
                    this.showIconPopup(actionTarget);
                    break;
                case 'change-page':
                    this.changePage(actionTarget.dataset.subtitleId, parseInt(actionTarget.dataset.page));
                    break;
            }
        },

        handleFormSubmit(e) {
            if (e.target.dataset.action !== 'add-row') return;
            e.preventDefault();
            
            const form = e.target;
            const subtitleId = form.dataset.id;
            const name = form.elements.name.value;
            const duration = parseInt(form.elements.duration.value);
            const unit = form.elements.unit.value;

            if (name && duration > 0) {
                this.addRow(subtitleId, { name, duration, unit });
                form.reset();
            }
        },
        
        handleDocumentClick(e) {
            if (!this.iconPopup.contains(e.target) && e.target.dataset.action !== 'show-icon-popup') {
                this.iconPopup.classList.remove('show');
            }
        },
        
        handleIconSelect(e) {
            const target = e.target;
            if (target.dataset.action === 'select-icon') {
                const iconSrc = target.dataset.iconSrc;
                const { type, id } = JSON.parse(this.iconPopup.dataset.context);
                this.updateIcon(type, id, iconSrc);
                this.iconPopup.classList.remove('show');
            }
        },
        
        // --- 動作 ---
        findSubtitle(subtitleId) {
            for (const mainTitle of this.data.mainTitles) {
                const subtitle = mainTitle.subtitles.find(s => s.id === subtitleId);
                if (subtitle) return subtitle;
            }
            return null;
        },

        editTitle(element) {
            const originalText = element.textContent.trim();
            const originalClassName = element.className;
            const type = element.dataset.type;
            const id = element.dataset.id;

            const input = document.createElement('input');
            input.type = 'text';
            input.value = originalText;
            input.className = `${originalClassName} editing-input`;

            element.replaceWith(input);
            input.focus();
            input.select();

            const saveAndReplace = () => {
                const newText = input.value.trim() || originalText;

                if (type === 'main') {
                    const mainTitle = this.data.mainTitles.find(mt => mt.id === id);
                    if (mainTitle) mainTitle.name = newText;
                } else if (type === 'sub') {
                    const subtitle = this.findSubtitle(id);
                    if (subtitle) subtitle.name = newText;
                }
                this.saveData();

                const newTitleElement = document.createElement(element.tagName); // H2 or H3
                newTitleElement.className = originalClassName;
                newTitleElement.dataset.action = 'edit-title';
                newTitleElement.dataset.type = type;
                newTitleElement.dataset.id = id;
                newTitleElement.textContent = newText;
                
                input.replaceWith(newTitleElement);
            };

            input.addEventListener('blur', saveAndReplace, { once: true });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    input.blur();
                } else if (e.key === 'Escape') {
                    input.removeEventListener('blur', saveAndReplace);
                    input.replaceWith(element);
                }
            });
        },

        toggleCollapse(subtitleId) {
            const subtitle = this.findSubtitle(subtitleId);
            if (subtitle) {
                subtitle.isCollapsed = !subtitle.isCollapsed;
                this.saveData();
                this.render();
            }
        },
        
        addRow(subtitleId, rowData) {
            const subtitle = this.findSubtitle(subtitleId);
            if (subtitle) {
                const now = new Date();
                let reminderTime = new Date(now);
                
                switch (rowData.unit) {
                    case 'minutes': reminderTime.setMinutes(now.getMinutes() + rowData.duration); break;
                    case 'hours': reminderTime.setHours(now.getHours() + rowData.duration); break;
                    case 'days': reminderTime.setDate(now.getDate() + rowData.duration); break;
                }

                const newRow = {
                    id: `row-${Date.now()}`,
                    name: rowData.name,
                    duration: rowData.duration,
                    unit: rowData.unit,
                    reminderTime: reminderTime.toISOString()
                };
                
                subtitle.data.push(newRow);
                subtitle.currentPage = Math.ceil(subtitle.data.length / this.ITEMS_PER_PAGE);
                this.saveData();
                this.render();
            }
        },

        deleteRow(subtitleId, rowId) {
            if (confirm('確定要刪除此筆資料嗎？')) {
                const subtitle = this.findSubtitle(subtitleId);
                if (subtitle) {
                    subtitle.data = subtitle.data.filter(row => row.id !== rowId);
                    
                    const totalPages = Math.ceil(subtitle.data.length / this.ITEMS_PER_PAGE) || 1;
                    if (subtitle.currentPage > totalPages) {
                        subtitle.currentPage = totalPages;
                    }

                    this.saveData();
                    this.render();
                }
            }
        },

        showIconPopup(target) {
            const rect = target.getBoundingClientRect();
            this.iconPopup.style.top = `${rect.bottom + window.scrollY + 5}px`;
            this.iconPopup.style.left = `${rect.left + window.scrollX}px`;
            this.iconPopup.dataset.context = JSON.stringify({ type: target.dataset.type, id: target.dataset.id });
            this.iconPopup.classList.add('show');
        },
        
        updateIcon(type, id, iconSrc) {
            if (type === 'main') {
                const mainTitle = this.data.mainTitles.find(mt => mt.id === id);
                if (mainTitle) mainTitle.icon = iconSrc;
            } else if (type === 'sub') {
                const subtitle = this.findSubtitle(id);
                if (subtitle) subtitle.icon = iconSrc;
            }
            this.saveData();
            this.render();
        },

        changePage(subtitleId, page) {
            const subtitle = this.findSubtitle(subtitleId);
            if (subtitle) {
                const totalPages = Math.ceil(subtitle.data.length / this.ITEMS_PER_PAGE) || 1;
                if(page > 0 && page <= totalPages) {
                    subtitle.currentPage = page;
                    this.saveData();
                    this.render();
                }
            }
        },
    };

    app.init();
});
