/**
 * ChronoSync - Application Logic
 * Optimized for local file access (file://)
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

// Initialize Firebase (Compat mode for global access)
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
    } catch (e) { console.warn("Firebase Sync Failed:", e); }
};

const listenToRoom = (roomId, callback) => {
    if (!db || !roomId) return;
    return db.collection("rooms").doc(roomId).onSnapshot((doc) => {
        if (doc.exists) callback(doc.data());
    });
};

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const HOURS = 24;
const SLOTS_PER_HOUR = 4; // 15 min intervals

const gridBody = document.getElementById('grid-body');
const timezoneIndicator = document.getElementById('timezone-indicator');
const groupList = document.getElementById('group-list');
const timestampList = document.getElementById('timestamp-list');
const copyBtn = document.getElementById('copy-discord');
const clearBtn = document.getElementById('clear-selection');
const copyLinkBtn = document.getElementById('copy-link');
const usernameInput = document.getElementById('username');
const syncStatus = document.getElementById('sync-status');
const weekLabel = document.getElementById('week-label');

let isDragging = false;
let selectionMode = true; 
let selectedSlots = new Set(); 
let roomData = {}; // Store all users' slots locally

// 1. Robust Timezone Detection
function detectTimezone() {
    try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (tz) return tz;
    } catch (e) {}
    return "UTC";
}
timezoneIndicator.textContent = `Your Timezone: ${detectTimezone()}`;

// 2. Build Grid
function initGrid() {
    const now = new Date();
    const dayOffset = (now.getDay() || 7) - 1; 
    const monday = new Date(now);
    monday.setDate(now.getDate() - dayOffset);
    monday.setHours(0,0,0,0);

    const mondayStr = monday.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
    weekLabel.textContent = `Schedule for Week of ${mondayStr}`;

    const headerCells = document.querySelectorAll('#grid-header th:not(.time-col)');
    headerCells.forEach((th, i) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        th.innerHTML = `${DAYS[i]}<br><span class="header-date">${d.toLocaleString('default', { month: 'short' })} ${d.getDate()}</span>`;
    });

    for (let h = 0; h < HOURS; h++) {
        for (let s = 0; s < SLOTS_PER_HOUR; s++) {
            const row = document.createElement('tr');
            const timeCol = document.createElement('td');
            timeCol.className = 'time-col';
            if (s === 0) {
                const hourLabel = h % 12 || 12;
                const ampm = h < 12 ? 'AM' : 'PM';
                timeCol.textContent = `${hourLabel}:00 ${ampm}`;
            } else {
                timeCol.textContent = `:${s * 15}`;
                timeCol.classList.add('sub-hour');
            }
            row.appendChild(timeCol);

            for (let d = 0; d < 7; d++) {
                const cell = document.createElement('td');
                const slotId = `${d}-${h * SLOTS_PER_HOUR + s}`;
                cell.dataset.slotId = slotId;
                cell.addEventListener('mousedown', (e) => startSelection(e, slotId));
                cell.addEventListener('mouseover', (e) => handleMouseOver(e, slotId));
                row.appendChild(cell);
            }
            gridBody.appendChild(row);
        }
    }
}

// 3. Selection Logic
function startSelection(e, slotId) {
    isDragging = true;
    document.body.classList.add('dragging');
    selectionMode = !selectedSlots.has(slotId);
    toggleSlot(slotId);
}

function handleMouseOver(e, slotId) {
    if (isDragging) toggleSlot(slotId, true);
}

function toggleSlot(slotId, forceMode = false) {
    const cell = document.querySelector(`[data-slot-id="${slotId}"]`);
    if (forceMode) {
        if (selectionMode) {
            selectedSlots.add(slotId);
            cell.classList.add('selected');
        } else {
            selectedSlots.delete(slotId);
            cell.classList.remove('selected');
        }
    } else {
        if (selectedSlots.has(slotId)) {
            selectedSlots.delete(slotId);
            cell.classList.remove('selected');
        } else {
            selectedSlots.add(slotId);
            cell.classList.add('selected');
        }
    }
    updateLists();
    handleSync();
}

window.addEventListener('mouseup', () => {
    isDragging = false;
    document.body.classList.remove('dragging');
});

// 4. List Rendering Logic
function updateLists() {
    const myName = usernameInput.value || 'Anonymous';
    roomData[myName] = Array.from(selectedSlots);
    renderGroupAvailability();
    renderDiscordTimestamps();
}

function renderGroupAvailability() {
    groupList.innerHTML = "";
    Object.keys(roomData).forEach(user => {
        const slots = roomData[user];
        if (!slots || slots.length === 0) return;

        const container = document.createElement('div');
        container.className = 'user-block';
        container.innerHTML = `<h4>${user}</h4>`;

        groupAdjacentSlots(slots).forEach(block => {
            const start = new Date(getUnixForSlot(block.day, block.startSlot) * 1000);
            const end = new Date(getUnixForSlot(block.day, block.lastSlot + 1) * 1000);
            const timeStr = `${start.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} - ${end.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
            const dateStr = start.toLocaleDateString([], {weekday: 'short', month: 'short', day: 'numeric'});
            
            const p = document.createElement('div');
            p.textContent = `${dateStr}: ${timeStr}`;
            container.appendChild(p);
        });
        groupList.appendChild(container);
    });
}

function renderDiscordTimestamps() {
    timestampList.innerHTML = "";
    Object.keys(roomData).forEach(user => {
        const slots = roomData[user];
        if (!slots || slots.length === 0) return;

        const container = document.createElement('div');
        container.className = 'user-block';
        container.innerHTML = `<h4>${user}</h4>`;

        groupAdjacentSlots(slots).forEach(block => {
            const span = document.createElement('span');
            span.className = 'timestamp-text';
            span.textContent = formatBlock(block);
            container.appendChild(span);
        });
        timestampList.appendChild(container);
    });
}

function groupAdjacentSlots(slots) {
    const sorted = Array.from(slots).sort((a, b) => {
        const [da, sa] = a.split('-').map(Number);
        const [db, sb] = b.split('-').map(Number);
        return da !== db ? da - db : sa - sb;
    });

    let blocks = [];
    let current = null;
    sorted.forEach(slotId => {
        const [day, slot] = slotId.split('-').map(Number);
        if (!current || current.day !== day || current.lastSlot + 1 !== slot) {
            if (current) blocks.push(current);
            current = { day, startSlot: slot, lastSlot: slot, startTime: getUnixForSlot(day, slot) };
        } else {
            current.lastSlot = slot;
        }
    });
    if (current) blocks.push(current);
    return blocks;
}

function getUnixForSlot(dayIndex, slotIndex) {
    const now = new Date();
    const dayOffset = (now.getDay() || 7) - 1; 
    const monday = new Date(now);
    monday.setDate(now.getDate() - dayOffset);
    monday.setHours(0, 0, 0, 0);

    const slotMinutes = (dayIndex * 24 * 60) + (slotIndex * 15);
    const date = new Date(monday.getTime() + slotMinutes * 60000);
    return Math.floor(date.getTime() / 1000);
}

function formatBlock(block) {
    const endUnix = getUnixForSlot(block.day, block.lastSlot + 1);
    return `<t:${block.startTime}:F> to <t:${endUnix}:t>`;
}

// 5. App Controls & Sync
const roomId = getRoomId();

let savedName = localStorage.getItem('chronosync_name');
if (savedName) {
    usernameInput.value = savedName;
    lockName();
}

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

usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') lockName();
});

let syncTimeout = null;
function handleSync() {
    clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => {
        const name = usernameInput.value || 'Anonymous';
        syncAvailability(roomId, name, selectedSlots);
        if (!usernameInput.disabled) lockName();
    }, 1000);
}

function getRoomId() {
    let hash = window.location.hash.substring(1);
    if (!hash) {
        hash = Math.random().toString(36).substring(2, 10);
        window.location.hash = hash;
    }
    return hash;
}

listenToRoom(roomId, (data) => {
    roomData = data;
    document.querySelectorAll('.other-user').forEach(c => {
        c.classList.remove('other-user');
        c.title = "";
    });

    const myName = usernameInput.value || 'Anonymous';
    Object.keys(data).forEach(user => {
        if (user === myName) return; 
        data[user].forEach(slotId => {
            const cell = document.querySelector(`[data-slot-id="${slotId}"]`);
            if (cell) {
                cell.classList.add('other-user');
                cell.title = (cell.title ? cell.title + ", " : "") + user;
            }
        });
    });
    
    syncStatus.textContent = `Room: ${roomId} | ${Object.keys(data).length} User(s) Active`;
    renderGroupAvailability();
    renderDiscordTimestamps();
});

copyLinkBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
        const originalText = copyLinkBtn.innerText;
        copyLinkBtn.innerText = "LINK COPIED!";
        setTimeout(() => copyLinkBtn.innerText = originalText, 2000);
    });
});

clearBtn.addEventListener('click', () => {
    selectedSlots.clear();
    document.querySelectorAll('.selected').forEach(c => c.classList.remove('selected'));
    updateLists();
    handleSync();
});

copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(timestampList.innerText).then(() => {
        const originalText = copyBtn.innerText;
        copyBtn.innerText = "COPIED!";
        setTimeout(() => copyBtn.innerText = originalText, 2000);
    });
});

initGrid();
console.log(`ChronoSync initialized: ${roomId}`);
