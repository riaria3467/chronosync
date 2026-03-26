/**
 * ChronoSync - Application Logic (V2 - Tabbed Dashboard)
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

// Initialize Firebase
let db = null;
if (typeof firebase !== 'undefined') {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
}

const syncAvailability = async (roomId, userName, slots) => {
    if (!db || !roomId) return;
    try {
        await db.collection("rooms").doc(roomId).set({
            [userName]: Array.from(slots)
        }, { merge: true });
    } catch (e) { console.warn("Sync Failed:", e); }
};

const listenToRoom = (roomId, callback) => {
    if (!db || !roomId) return;
    return db.collection("rooms").doc(roomId).onSnapshot((doc) => {
        if (doc.exists) callback(doc.data());
    });
};

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const HOURS = 24;
const SLOTS_PER_HOUR = 4;
const TOTAL_SLOTS = HOURS * SLOTS_PER_HOUR;

// DOM Elements
const gridBody = document.getElementById('grid-body');
const groupGridBody = document.getElementById('group-grid-body');
const syncStatus = document.getElementById('sync-status');
const usernameInput = document.getElementById('username');
const clearBtn = document.getElementById('clear-selection');
const copyLinkBtn = document.getElementById('copy-link');
const copyDiscordBtn = document.getElementById('copy-discord');
const timezoneIndicator = document.getElementById('timezone-indicator');
const userSelector = document.getElementById('user-selector');
const userSummary = document.getElementById('user-summary');
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');

let isDragging = false;
let selectionMode = true; 
let selectedSlots = new Set(); 
let roomData = {};

// 1. Tab Switching
tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
        tabButtons.forEach(b => b.classList.remove('active'));
        tabPanes.forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(target).classList.add('active');
    });
});

// 2. Timezone & Initialization
function detectTimezone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (e) { return "UTC"; }
}
timezoneIndicator.textContent = `Your Timezone: ${detectTimezone()}`;

function initGrid() {
    const now = new Date();
    const dayOffset = (now.getDay() || 7) - 1; 
    const monday = new Date(now);
    monday.setDate(now.getDate() - dayOffset);
    monday.setHours(0,0,0,0);

    const headerDates = document.querySelectorAll('.header-date');
    headerDates.forEach((span, i) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + (i % 7));
        span.textContent = `${d.toLocaleString('default', { month: 'short' })} ${d.getDate()}`;
    });

    buildGridTable(gridBody, true);
    buildGridTable(groupGridBody, false);
}

function buildGridTable(container, isInput) {
    if (!container) return;
    for (let h = 0; h < HOURS; h++) {
        for (let s = 0; s < SLOTS_PER_HOUR; s++) {
            const row = document.createElement('tr');
            
            // Time Column
            const timeCol = document.createElement('td');
            timeCol.className = 'time-col';
            if (s === 0) {
                const hourLabel = h % 12 || 12;
                const ampm = h < 12 ? 'AM' : 'PM';
                timeCol.innerHTML = `<b>${hourLabel}:00</b> <span class='ampm'>${ampm}</span>`;
            } else {
                timeCol.textContent = `:${s * 15}`;
                timeCol.classList.add('sub-hour');
            }
            row.appendChild(timeCol);

            // Day Columns
            for (let d = 0; d < 7; d++) {
                const cell = document.createElement('td');
                const slotId = `${d}-${h * SLOTS_PER_HOUR + s}`;
                cell.dataset.slotId = slotId;
                if (isInput) {
                    cell.addEventListener('mousedown', (e) => startSelection(e, slotId));
                    cell.addEventListener('mouseover', (e) => handleMouseOver(e, slotId));
                } else {
                    cell.innerHTML = '<div class="slot-names"></div>';
                }
                row.appendChild(cell);
            }
            container.appendChild(row);
        }
    }
}

// 3. Selection Logic
function startSelection(e, slotId) {
    isDragging = true;
    selectionMode = !selectedSlots.has(slotId);
    toggleSlot(slotId);
}

function handleMouseOver(e, slotId) {
    if (isDragging) toggleSlot(slotId, true);
}

function toggleSlot(slotId, forceMode = false) {
    const cell = document.querySelector(`#grid-body [data-slot-id="${slotId}"]`);
    if (!cell) return;
    if (forceMode) {
        if (selectionMode) { selectedSlots.add(slotId); cell.classList.add('selected'); }
        else { selectedSlots.delete(slotId); cell.classList.remove('selected'); }
    } else {
        if (selectedSlots.has(slotId)) { selectedSlots.delete(slotId); cell.classList.remove('selected'); }
        else { selectedSlots.add(slotId); cell.classList.add('selected'); }
    }
    updateRoomData();
    debouncedSync();
}

window.addEventListener('mouseup', () => {
    isDragging = false;
    document.body.classList.remove('dragging');
});

// 4. Group View Rendering
function renderGroupGrid() {
    document.querySelectorAll('#group-grid-body .slot-names').forEach(div => div.innerHTML = "");
    Object.keys(roomData).forEach(user => {
        const slots = roomData[user];
        if (!slots) return;
        slots.forEach(slotId => {
            const cell = document.querySelector(`#group-grid-body [data-slot-id="${slotId}"] .slot-names`);
            if (cell) {
                const tag = document.createElement('span');
                tag.className = 'name-tag';
                tag.textContent = user;
                cell.appendChild(tag);
            }
        });
    });
}

function updateRoomData() {
    const myName = usernameInput.value || 'Anonymous';
    roomData[myName] = Array.from(selectedSlots);
    renderGroupGrid();
    updateDropdown();
}

function updateDropdown() {
    const currentVal = userSelector.value;
    userSelector.innerHTML = '<option value="">Select a user...</option>';
    Object.keys(roomData).sort().forEach(user => {
        const opt = document.createElement('option');
        opt.value = user;
        opt.textContent = user;
        userSelector.appendChild(opt);
    });
    userSelector.value = currentVal;
    renderUserSummary();
}

userSelector.addEventListener('change', renderUserSummary);

function renderUserSummary() {
    const user = userSelector.value;
    if (!user || !roomData[user]) {
        userSummary.innerHTML = '<p class="placeholder">Select a user to see their schedule.</p>';
        return;
    }

    const slots = roomData[user];
    let html = `<h4>${user}'s Schedule</h4><div class='tag-list'>`;
    
    // Group and format
    const blocks = groupSlots(slots);
    blocks.forEach(b => {
        const endUnix = getUnixForSlot(b.day, b.lastSlot + 1);
        html += `<div class='summary-line'><b><t:${b.startTime}:F></b><br>to <t:${endUnix}:t></div>`;
    });
    html += `</div>`;
    userSummary.innerHTML = html;
}

function groupSlots(slots) {
    const sorted = Array.from(slots).sort((a, b) => {
        const [da, sa] = a.split('-').map(Number);
        const [db, sb] = b.split('-').map(Number);
        return da !== db ? da - db : sa - sb;
    });
    let blocks = [];
    let cur = null;
    sorted.forEach(id => {
        const [d, s] = id.split('-').map(Number);
        if (!cur || cur.day !== d || cur.lastSlot + 1 !== s) {
            if (cur) blocks.push(cur);
            cur = { day: d, startSlot: s, lastSlot: s, startTime: getUnixForSlot(d, s) };
        } else { cur.lastSlot = s; }
    });
    if (cur) blocks.push(cur);
    return blocks;
}

function getUnixForSlot(dayIndex, slotIndex) {
    const now = new Date();
    const dayOffset = (now.getDay() || 7) - 1; 
    const monday = new Date(now);
    monday.setDate(now.getDate() - dayOffset);
    monday.setHours(0, 0, 0, 0);
    const date = new Date(monday.getTime() + (dayIndex * 24 * 60 + slotIndex * 15) * 60000);
    return Math.floor(date.getTime() / 1000);
}

// 5. Lifecycle & Sync
const roomId = getRoomId();
function getRoomId() {
    let hash = window.location.hash.substring(1).split('#')[0]; // Clean hash
    if (!hash) { hash = Math.random().toString(36).substring(2, 10); window.location.hash = hash; }
    return hash;
}

listenToRoom(roomId, (data) => {
    roomData = data;
    syncStatus.textContent = `Room: ${roomId} | ${Object.keys(data).length} Active`;
    renderGroupGrid();
    updateDropdown();
});

let syncTimeout = null;
function debouncedSync() {
    clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => {
        const name = usernameInput.value || 'Anonymous';
        syncAvailability(roomId, name, selectedSlots);
    }, 1000);
}

copyLinkBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
        const originalText = copyLinkBtn.innerText;
        copyLinkBtn.innerText = "LINK COPIED!";
        setTimeout(() => copyLinkBtn.innerText = originalText, 2000);
    });
});

clearBtn.addEventListener('click', () => {
    selectedSlots.clear();
    document.querySelectorAll('#grid-body .selected').forEach(c => c.classList.remove('selected'));
    updateRoomData();
    debouncedSync();
});

copyDiscordBtn.addEventListener('click', () => {
    const myName = usernameInput.value || 'Anonymous';
    const mySlots = roomData[myName] || [];
    if (mySlots.length === 0) return;

    let text = `**${myName}'s Availability:**\n`;
    const blocks = groupSlots(mySlots);

    blocks.forEach(b => {
        const endUnix = getUnixForSlot(b.day, b.lastSlot + 1);
        text += `- <t:${b.startTime}:F> to <t:${endUnix}:t>\n`;
    });

    navigator.clipboard.writeText(text).then(() => {
        const originalText = copyDiscordBtn.innerText;
        copyDiscordBtn.innerText = "COPIED!";
        setTimeout(() => copyDiscordBtn.innerText = originalText, 2000);
    });
});

// Identity Persistence
let savedName = localStorage.getItem('chronosync_name');
if (savedName) { usernameInput.value = savedName; lockName(); }

function lockName() {
    if (usernameInput.value.trim() === "") return;
    usernameInput.disabled = true;
    localStorage.setItem('chronosync_name', usernameInput.value);
    usernameInput.classList.add('locked');
}

usernameInput.addEventListener('dblclick', () => {
    usernameInput.disabled = false;
    usernameInput.classList.remove('locked');
    usernameInput.focus();
});

usernameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') lockName(); });

initGrid();
console.log(`ChronoSync initialized: ${roomId}`);
