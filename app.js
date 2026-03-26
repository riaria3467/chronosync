/**
 * ChronoSync - Application Logic (V2.1 - Robust Dashboard)
 */

const firebaseConfig = {
    apiKey: "AIzaSyD3OmNrVAp0UOfwjAygwCwaxjA_XoiogQE",
    authDomain: "chronosync-caaf6.firebaseapp.com",
    projectId: "chronosync-caaf6",
    storageBucket: "chronosync-caaf6.firebasestorage.app",
    messagingSenderId: "90028883606",
    appId: "1:90028883606:web:7bb0d05b1b79e7aba44cb7",
    measurementId: "G-1F5QTB9Q52"
};

// Global State
let db = null;
const HOURS = 24;
const SLOTS_PER_HOUR = 4;
let isDragging = false;
let selectionMode = true; 
let selectedSlots = new Set(); 
let roomData = {};
let roomId = null;
let elements = {};

// 1. Core Initialization
document.addEventListener('DOMContentLoaded', () => {
    console.log("Initializing ChronoSync Dashboard...");
    
    // Cache DOM Elements
    elements = {
        gridBody: document.getElementById('grid-body'),
        groupGridBody: document.getElementById('group-grid-body'),
        syncStatus: document.getElementById('sync-status'),
        usernameInput: document.getElementById('username'),
        userSelector: document.getElementById('user-selector'),
        userSummary: document.getElementById('user-summary'),
        tabButtons: document.querySelectorAll('.tab-btn'),
        tabPanes: document.querySelectorAll('.tab-pane'),
        timezoneIndicator: document.getElementById('timezone-indicator'),
        copyLinkBtn: document.getElementById('copy-link'),
        copyDiscordBtn: document.getElementById('copy-discord'),
        clearBtn: document.getElementById('clear-selection'),
        groupList: document.getElementById('group-list'),
        timestampList: document.getElementById('timestamp-list'),
        weekLabel: document.getElementById('week-label')
    };

    // Firebase Setup
    if (typeof firebase !== 'undefined') {
        firebase.initializeApp(firebaseConfig);
        db = firebase.firestore();
    } else {
        console.error("Firebase SDK missing!");
    }

    // Hash/Room ID Setup
    roomId = window.location.hash.substring(1).split('#')[0];
    if (!roomId) {
        roomId = Math.random().toString(36).substring(2, 10);
        window.location.hash = roomId;
    }

    // UI Listeners
    setupEventListeners();
    
    // Build Grids
    initGrid();
    
    // Start Real-time Sync
    if (db) startSync();
    
    // Load Identity
    loadIdentity();

    console.log(`ChronoSync initialized for room: ${roomId}`);
});

function setupEventListeners() {
    // Tab switching
    elements.tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.tab;
            elements.tabButtons.forEach(b => b.classList.remove('active'));
            elements.tabPanes.forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(target).classList.add('active');
        });
    });

    // Name input
    elements.usernameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') lockName();
    });
    elements.usernameInput.addEventListener('dblclick', () => {
        elements.usernameInput.disabled = false;
        elements.usernameInput.classList.remove('locked');
    });

    // Control buttons
    if (elements.copyLinkBtn) {
        elements.copyLinkBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(window.location.href);
            const originalText = elements.copyLinkBtn.innerText;
            elements.copyLinkBtn.innerText = "COPIED!";
            setTimeout(() => elements.copyLinkBtn.innerText = originalText, 2000);
        });
    }

    if (elements.clearBtn) {
        elements.clearBtn.addEventListener('click', () => {
            selectedSlots.clear();
            document.querySelectorAll('#grid-body .selected').forEach(c => c.classList.remove('selected'));
            updateLocalState();
            debouncedSync();
        });
    }

    if (elements.copyDiscordBtn) {
        elements.copyDiscordBtn.addEventListener('click', copyMyDiscordTags);
    }

    if (elements.userSelector) {
        elements.userSelector.addEventListener('change', renderUserSummary);
    }

    window.addEventListener('mouseup', () => { isDragging = false; });
}

// 2. Grid Construction
function initGrid() {
    // Set Week Dates in Headers
    const now = new Date();
    const dayOffset = (now.getDay() || 7) - 1; 
    const monday = new Date(now);
    monday.setDate(now.getDate() - dayOffset);
    monday.setHours(0,0,0,0);

    const headerDates = document.querySelectorAll('.header-date');
    let mondayDate = null;
    let sundayDate = null;

    headerDates.forEach((span, i) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + (i % 7));
        if (i === 0) mondayDate = d;
        if (i === 6) sundayDate = d;
        span.textContent = `${d.toLocaleString('default', { month: 'short' })} ${d.getDate()}`;
    });

    // Update Week Label
    if (elements.weekLabel && mondayDate && sundayDate) {
        const mMonth = mondayDate.toLocaleString('default', { month: 'long' });
        const sMonth = sundayDate.toLocaleString('default', { month: 'long' });
        if (mMonth === sMonth) {
            elements.weekLabel.textContent = `Schedule: ${mMonth} ${mondayDate.getDate()} - ${sundayDate.getDate()}`;
        } else {
            elements.weekLabel.textContent = `Schedule: ${mMonth} ${mondayDate.getDate()} - ${sMonth} ${sundayDate.getDate()}`;
        }
    }

    // Build Tables
    buildTable(elements.gridBody, true);
    buildTable(elements.groupGridBody, false);

    // Timezone 
    if (elements.timezoneIndicator) {
        try {
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
            elements.timezoneIndicator.textContent = `Timezone: ${tz}`;
        } catch(e) {}
    }
}

function buildTable(container, isInput) {
    if (!container) return;
    container.innerHTML = ""; // Clear
    for (let h = 0; h < HOURS; h++) {
        for (let s = 0; s < SLOTS_PER_HOUR; s++) {
            const row = document.createElement('tr');
            
            // Time Col
            const tCol = document.createElement('td');
            tCol.className = 'time-col';
            if (s === 0) {
                const hourLabel = h % 12 || 12;
                const ampm = h < 12 ? 'AM' : 'PM';
                tCol.innerHTML = `<b>${hourLabel}:00</b> <span class='ampm'>${ampm}</span>`;
            } else {
                tCol.textContent = `:${s * 15}`;
                tCol.classList.add('sub-hour');
            }
            row.appendChild(tCol);

            // Day Cols
            for (let d = 0; d < 7; d++) {
                const cell = document.createElement('td');
                const sid = `${d}-${h * SLOTS_PER_HOUR + s}`;
                cell.dataset.slotId = sid;
                if (isInput) {
                    cell.addEventListener('mousedown', (e) => {
                        isDragging = true;
                        selectionMode = !selectedSlots.has(sid);
                        toggleSlot(sid);
                    });
                    cell.addEventListener('mouseover', () => {
                        if (isDragging) toggleSlot(sid, true);
                    });
                } else {
                    cell.innerHTML = '<div class="slot-names"></div>';
                }
                row.appendChild(cell);
            }
            container.appendChild(row);
        }
    }
}

function toggleSlot(sid, forceMode = false) {
    const cell = document.querySelector(`#grid-body [data-slot-id="${sid}"]`);
    if (!cell) return;
    
    if (forceMode) {
        if (selectionMode) { selectedSlots.add(sid); cell.classList.add('selected'); }
        else { selectedSlots.delete(sid); cell.classList.remove('selected'); }
    } else {
        if (selectedSlots.has(sid)) { selectedSlots.delete(sid); cell.classList.remove('selected'); }
        else { selectedSlots.add(sid); cell.classList.add('selected'); }
    }
    
    updateLocalState();
    debouncedSync();
}

// 3. Synchronization
function startSync() {
    db.collection("rooms").doc(roomId).onSnapshot((doc) => {
        if (doc.exists) {
            roomData = doc.data();
            const count = Object.keys(roomData).length;
            elements.syncStatus.textContent = `Active: ${count} users`;
            refreshAllResults();
        }
    });
}

let syncTimer = null;
function debouncedSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
        if (!db || !roomId) return;
        const name = elements.usernameInput.value || 'Anonymous';
        db.collection("rooms").doc(roomId).set({
            [name]: Array.from(selectedSlots)
        }, { merge: true }).catch(console.error);
        lockName();
    }, 1200);
}

function updateLocalState() {
    const name = elements.usernameInput.value || 'Anonymous';
    roomData[name] = Array.from(selectedSlots);
    refreshAllResults();
}

// 4. Rendering & Summaries
function refreshAllResults() {
    renderGroupGrid();
    refreshUserDropdown();
    renderGroupList();
    renderTimestampList();
}

function renderGroupGrid() {
    document.querySelectorAll('#group-grid-body .slot-names').forEach(div => div.innerHTML = "");
    Object.keys(roomData).forEach(user => {
        const slots = roomData[user];
        if (!Array.isArray(slots)) return;
        slots.forEach(sid => {
            const target = document.querySelector(`#group-grid-body [data-slot-id="${sid}"] .slot-names`);
            if (target) {
                const tag = document.createElement('span');
                tag.className = 'name-tag';
                tag.textContent = user;
                target.appendChild(tag);
            }
        });
    });
}

function refreshUserDropdown() {
    if (!elements.userSelector) return;
    const current = elements.userSelector.value;
    elements.userSelector.innerHTML = '<option value="">Select a user...</option>';
    Object.keys(roomData).sort().forEach(user => {
        const opt = document.createElement('option');
        opt.value = user;
        opt.textContent = user;
        elements.userSelector.appendChild(opt);
    });
    elements.userSelector.value = current;
    renderUserSummary();
}

function renderUserSummary() {
    if (!elements.userSummary) return;
    const user = elements.userSelector.value;
    if (!user || !roomData[user]) {
        elements.userSummary.innerHTML = '<p class="placeholder">Select a user to see their availability.</p>';
        return;
    }

    const slots = roomData[user];
    const blocks = groupSlotsIntoBlocks(slots);
    
    let html = `<h4>${user}'s Availability</h4><div class='tag-list local-friendly'>`;
    blocks.forEach(b => {
        const start = new Date(b.startTime * 1000);
        const end = new Date(getUnixAtSlot(b.day, b.lastSlot + 1) * 1000);
        
        const dateStr = start.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
        const startStr = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        const endStr = end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        
        html += `<div class='summary-line'><b>${dateStr}</b><br>${startStr} - ${endStr}</div>`;
    });
    html += `</div>`;
    elements.userSummary.innerHTML = html;
}

function renderGroupList() {
    if (!elements.groupList) return;
    
    const userNames = Object.keys(roomData);
    if (userNames.length < 2) {
        elements.groupList.innerHTML = "<p class='placeholder'>Add more users to find shared times...</p>";
        return;
    }

    // INTERSECTION LOGIC
    let sharedSlots = null;
    userNames.forEach(user => {
        const userSlots = new Set(roomData[user]);
        if (sharedSlots === null) {
            sharedSlots = userSlots;
        } else {
            sharedSlots = new Set([...sharedSlots].filter(x => userSlots.has(x)));
        }
    });

    if (!sharedSlots || sharedSlots.size === 0) {
        elements.groupList.innerHTML = "<p class='placeholder'>No overlapping availability found.</p>";
        return;
    }

    const blocks = groupSlotsIntoBlocks(Array.from(sharedSlots));
    let html = "<div class='timestamp-list discord-friendly'>";
    blocks.forEach(b => {
        const endUnix = getUnixAtSlot(b.day, b.lastSlot + 1);
        html += `<div class='summary-line'><code>&lt;t:${b.startTime}:F&gt; to &lt;t:${endUnix}:t&gt;</code></div>`;
    });
    html += "</div>";
    elements.groupList.innerHTML = html;
}

function renderTimestampList() {
    if (!elements.timestampList) return;
    let html = "";
    Object.keys(roomData).forEach(user => {
        const slots = roomData[user];
        if (!Array.isArray(slots) || slots.length === 0) return;
        const blocks = groupSlotsIntoBlocks(slots);
        html += `<details class='user-timestamp-detail'><summary>${user}</summary><div class='timestamp-codes'>`;
        blocks.forEach(b => {
            const endUnix = getUnixAtSlot(b.day, b.lastSlot + 1);
            html += `<p><code>&lt;t:${b.startTime}:F&gt; to &lt;t:${endUnix}:t&gt;</code></p>`;
        });
        html += `</div></details>`;
    });
    elements.timestampList.innerHTML = html || "Select blocks to see codes...";
}

function copyMyDiscordTags() {
    const myName = elements.usernameInput.value || 'Anonymous';
    const mySlots = selectedSlots;
    if (mySlots.size === 0) return;

    let text = `**${myName}'s Availability:**\n`;
    const blocks = groupSlotsIntoBlocks(mySlots);
    blocks.forEach(b => {
        const endUnix = getUnixAtSlot(b.day, b.lastSlot + 1);
        text += `- <t:${b.startTime}:F> to <t:${endUnix}:t>\n`;
    });

    navigator.clipboard.writeText(text);
    const originalText = elements.copyDiscordBtn.innerText;
    elements.copyDiscordBtn.innerText = "COPIED!";
    setTimeout(() => elements.copyDiscordBtn.innerText = originalText, 2000);
}

// 5. Helpers
function groupSlotsIntoBlocks(slots) {
    const sorted = Array.from(slots).sort((a, b) => {
        const [da, sa] = a.split('-').map(Number);
        const [db, sb] = b.split('-').map(Number);
        return da !== db ? da - db : sa - sb;
    });
    const blocks = [];
    let cur = null;
    sorted.forEach(id => {
        const [d, s] = id.split('-').map(Number);
        if (!cur || cur.day !== d || cur.lastSlot + 1 !== s) {
            if (cur) blocks.push(cur);
            cur = { day: d, startSlot: s, lastSlot: s, startTime: getUnixAtSlot(d, s) };
        } else { cur.lastSlot = s; }
    });
    if (cur) blocks.push(cur);
    return blocks;
}

function getUnixAtSlot(dayIdx, slotIdx) {
    const now = new Date();
    const dayOffset = (now.getDay() || 7) - 1; 
    const monday = new Date(now);
    monday.setDate(now.getDate() - dayOffset);
    monday.setHours(0, 0, 0, 0);
    const date = new Date(monday.getTime() + (dayIdx * 24 * 60 + slotIdx * 15) * 60000);
    return Math.floor(date.getTime() / 1000);
}

function loadIdentity() {
    const saved = localStorage.getItem('chronosync_name');
    if (saved) {
        elements.usernameInput.value = saved;
        lockName();
    }
}

function lockName() {
    if (elements.usernameInput.value.trim() === "") return;
    elements.usernameInput.disabled = true;
    localStorage.setItem('chronosync_name', elements.usernameInput.value);
    elements.usernameInput.classList.add('locked');
}
