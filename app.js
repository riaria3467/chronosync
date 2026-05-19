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
const SLOTS_PER_HOUR = 2; // 30-min intervals
let selectedSlots = new Set(); 
let roomData = {};
let roomId = null;
let elements = {};
const userColors = {};
const COLOR_PALETTE = [
    '#f87171', // red
    '#fb923c', // orange
    '#fbbf24', // amber
    '#34d399', // emerald
    '#22d3ee', // cyan
    '#818cf8', // indigo
    '#c084fc', // purple
    '#f472b6'  // pink
];

// 1. Core Initialization
document.addEventListener('DOMContentLoaded', () => {
    console.log("Initializing ChronoSync Dashboard...");
    
    // Cache DOM Elements
    elements = {
        gridBody: document.getElementById('grid-body'),
        groupGridBody: document.getElementById('group-grid-body'),
        syncStatus: document.getElementById('sync-status'),
        usernameInput: document.getElementById('username'),
        pinInput: document.getElementById('user-pin'),
        lockBtn: document.getElementById('lock-identity'),
        authError: document.getElementById('auth-error'),
        userSelector: document.getElementById('user-selector'),
        userSummary: document.getElementById('user-summary'),
        tabButtons: document.querySelectorAll('.tab-btn'),
        tabPanes: document.querySelectorAll('.tab-pane'),
        timezoneIndicator: document.getElementById('timezone-indicator'),
        copyLinkBtn: document.getElementById('copy-link'),
        copyDiscordBtn: document.getElementById('copy-discord'),
        clearBtn: document.getElementById('clear-selection'),
        timestampList: document.getElementById('timestamp-list'),
        weekLabel: document.getElementById('week-label'),
        editBtn: document.getElementById('edit-schedule'),
        saveBtn: document.getElementById('save-schedule'),
        editStatus: document.getElementById('edit-status'),
        availForm: document.getElementById('avail-form'),
        copyAllBtn: document.getElementById('copy-all-timestamps')
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

    // Identity inputs
    const triggerLock = (e) => { if (e.key === 'Enter') attemptLockIdentity(); };
    elements.usernameInput.addEventListener('keypress', triggerLock);
    elements.pinInput.addEventListener('keypress', triggerLock);
    
    if (elements.lockBtn) {
        elements.lockBtn.addEventListener('click', attemptLockIdentity);
    }

    const unlockIdentity = () => {
        elements.usernameInput.disabled = false;
        elements.usernameInput.classList.remove('locked');
        elements.pinInput.disabled = false;
        elements.pinInput.classList.remove('locked');
        elements.authError.textContent = '';
        if (elements.lockBtn) elements.lockBtn.style.display = 'block';
    };

    elements.usernameInput.addEventListener('dblclick', unlockIdentity);
    elements.pinInput.addEventListener('dblclick', unlockIdentity);

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
            // Clear all dropdown selections
            document.querySelectorAll('.avail-select').forEach(s => s.value = '');
            selectedSlots.clear();
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

    if (elements.editBtn) {
        elements.editBtn.addEventListener('click', () => toggleEditMode(true));
    }

    if (elements.saveBtn) {
        elements.saveBtn.addEventListener('click', saveSchedule);
    }

    if (elements.copyAllBtn) {
        elements.copyAllBtn.addEventListener('click', copyAllTimestamps);
    }
}

// 2. UI Construction
const DAY_NAMES   = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const DAY_SHORT   = ['MON','TUE','WED','THU','FRI','SAT','SUN'];

function getMonday() {
    const now = new Date();
    const dayOffset = (now.getDay() || 7) - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - dayOffset);
    monday.setHours(0,0,0,0);
    return monday;
}

function initGrid() {
    const monday = getMonday();

    // Update week label
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    if (elements.weekLabel) {
        const fmt = (d) => d.toLocaleString('default', { month: 'long' });
        const mM = fmt(monday), sM = fmt(sunday);
        elements.weekLabel.textContent = mM === sM
            ? `Schedule: ${mM} ${monday.getDate()} – ${sunday.getDate()}`
            : `Schedule: ${mM} ${monday.getDate()} – ${sM} ${sunday.getDate()}`;
    }

    // Build group results grid (Tab 2)
    buildTable(elements.groupGridBody, false);

    // Update group grid header dates
    document.querySelectorAll('.header-date').forEach((span, i) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        span.textContent = `${d.toLocaleString('default', { month: 'short' })} ${d.getDate()}`;
    });

    // Build availability form (Tab 1)
    buildAvailabilityForm(monday);

    // Timezone
    if (elements.timezoneIndicator) {
        try {
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
            elements.timezoneIndicator.textContent = `Timezone: ${tz}`;
        } catch(e) {}
    }
}

function slotLabel(slot) {
    const totalMins = slot * 30;
    let h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    
    // Special case for 12:00 AM next day (slot 48)
    if (h === 24) return "12:00 AM";
    
    const ampm = h < 12 ? 'AM' : 'PM';
    const h12 = h % 12 || 12;
    return `${h12}:${m.toString().padStart(2,'0')} ${ampm}`;
}

function dropdownOptions(selectedVal, isEnd = false) {
    let html = `<option value="">--</option>`;
    // End times go up to 48 (Midnight), start times only to 47 (11:30 PM)
    const limit = isEnd ? 48 : 47;
    for (let s = 0; s <= limit; s++) {
        const sel = (s.toString() === selectedVal.toString()) ? 'selected' : '';
        html += `<option value="${s}" ${sel}>${slotLabel(s)}</option>`;
    }
    return html;
}

function buildAvailabilityForm(monday) {
    const container = document.getElementById('avail-form');
    if (!container) return;
    container.innerHTML = '';

    for (let d = 0; d < 7; d++) {
        const date = new Date(monday);
        date.setDate(monday.getDate() + d);
        const dateLabel = date.toLocaleString('default', { month: 'short', day: 'numeric' });

        const dayRow = document.createElement('div');
        dayRow.className = 'avail-day-row';
        dayRow.dataset.dayIndex = d;
        dayRow.innerHTML = `
            <div class="avail-day-label">
                <span class="avail-day-name">${DAY_NAMES[d]}</span>
                <span class="avail-day-date">${dateLabel}</span>
            </div>
            <div class="avail-slots" data-day="${d}">
                <!-- slots rendered here -->
            </div>
        `;
        container.appendChild(dayRow);

        // Start with one empty slot row per day
        addSlotRow(dayRow.querySelector('.avail-slots'), d);
    }
}

function addSlotRow(slotsContainer, dayIndex) {
    const row = document.createElement('div');
    row.className = 'avail-slot-entry';
    row.innerHTML = `
        <button class="btn-add-slot" title="Add another time range for this day">+ Add Time Range</button>
        <button class="btn-remove-slot">− Remove Time Range</button>
        <select class="avail-select start-select" data-day="${dayIndex}">
            ${dropdownOptions('', false)}
        </select>
        <span class="avail-to">to</span>
        <select class="avail-select end-select" data-day="${dayIndex}">
            ${dropdownOptions('', true)}
        </select>
        <span class="avail-time-preview"></span>
        <span class="avail-error"></span>
    `;
    slotsContainer.appendChild(row);

    const startSel = row.querySelector('.start-select');
    const endSel   = row.querySelector('.end-select');
    const preview  = row.querySelector('.avail-time-preview');
    const errSpan  = row.querySelector('.avail-error');

    function updatePreview() {
        const sv = startSel.value;
        const ev = endSel.value;
        if (sv === '' || ev === '') {
            preview.textContent = '';
            errSpan.textContent = '';
            return;
        }
        const s = parseInt(sv);
        const e = parseInt(ev);
        if (e <= s) {
            preview.textContent = '';
            errSpan.innerHTML = '<span class="warn-icon">⚠</span> END MUST BE AFTER START <span class="warn-icon">⚠</span>';
        } else {
            errSpan.textContent = '';
            const totalMins = (e - s) * 30;
            const hrs = Math.floor(totalMins / 60);
            const mins = totalMins % 60;
            const hPart = hrs  > 0 ? `${hrs} ${hrs  === 1 ? 'hour'   : 'hours'}`   : '';
            const mPart = mins > 0 ? `${mins} ${mins === 1 ? 'minute' : 'minutes'}` : '';
            const dur = hPart && mPart ? `${hPart} & ${mPart}` : hPart || mPart;
            preview.textContent = dur;
        }
    }

    row.querySelectorAll('.avail-select').forEach(sel => {
        sel.addEventListener('change', () => { updatePreview(); recalcSlotsFromForm(); });
    });
    row.querySelector('.btn-add-slot').addEventListener('click', () => {
        addSlotRow(slotsContainer, dayIndex);
        updateRemoveButtons(slotsContainer);
    });
    row.querySelector('.btn-remove-slot').addEventListener('click', () => {
        row.remove();
        updateRemoveButtons(slotsContainer);
        recalcSlotsFromForm();
    });

    updateRemoveButtons(slotsContainer);
}

function updateRemoveButtons(slotsContainer) {
    const rows = slotsContainer.querySelectorAll('.avail-slot-entry');
    rows.forEach(r => {
        const btn = r.querySelector('.btn-remove-slot');
        if (btn) btn.disabled = rows.length === 1;
    });
}

function recalcSlotsFromForm() {
    selectedSlots.clear();
    document.querySelectorAll('.avail-slot-entry').forEach(row => {
        const startSel = row.querySelector('.start-select');
        const endSel   = row.querySelector('.end-select');
        const d = parseInt(startSel.dataset.day);
        const startS = parseInt(startSel.value);
        const endS   = parseInt(endSel.value);
        if (isNaN(startS) || isNaN(endS) || endS <= startS) return;
        for (let s = startS; s < endS; s++) {
            selectedSlots.add(`${d}-${s}`);
        }
    });
    updateLocalState();
    // debouncedSync(); // REMOVED auto-sync on every change
}

function toggleEditMode(enable) {
    if (enable) {
        elements.availForm.classList.remove('readonly');
        elements.editBtn.style.display = 'none';
        elements.saveBtn.style.display = 'block';
        elements.editStatus.style.display = 'inline-flex';
    } else {
        elements.availForm.classList.add('readonly');
        elements.editBtn.style.display = 'block';
        elements.saveBtn.style.display = 'none';
        elements.editStatus.style.display = 'none';
    }
}

async function saveSchedule() {
    if (!db || !roomId) return;
    
    const name = elements.usernameInput.value || 'Anonymous';
    const pin = elements.pinInput ? elements.pinInput.value : '';
    
    // Check if we need to lock identity first
    if (!elements.usernameInput.disabled) {
        await attemptLockIdentity();
    }
    
    const originalText = elements.saveBtn.innerText;
    elements.saveBtn.innerText = "Saving...";
    elements.saveBtn.disabled = true;

    try {
        await db.collection("rooms").doc(roomId).set({
            [name]: { slots: Array.from(selectedSlots), pin: pin }
        }, { merge: true });
        
        toggleEditMode(false);
        elements.saveBtn.innerText = "✓ Saved!";
        setTimeout(() => {
            elements.saveBtn.innerText = originalText;
            elements.saveBtn.disabled = false;
        }, 2000);
    } catch (e) {
        console.error(e);
        elements.saveBtn.innerText = "Error!";
        setTimeout(() => {
            elements.saveBtn.innerText = originalText;
            elements.saveBtn.disabled = false;
        }, 2000);
    }
}


function buildTable(container, isInput) {
    if (!container || isInput) return; // Input no longer uses a table
    container.innerHTML = '';
    for (let h = 0; h < HOURS; h++) {
        for (let s = 0; s < SLOTS_PER_HOUR; s++) {
            const row = document.createElement('tr');
            row.dataset.slotIndex = h * SLOTS_PER_HOUR + s;
            const tCol = document.createElement('td');
            tCol.className = 'time-col';
            // Show full time label on every row (30-min intervals)
            const totalMins = (h * SLOTS_PER_HOUR + s) * 30;
            const hh = Math.floor(totalMins / 60);
            const mm = totalMins % 60;
            const ampm = hh < 12 ? 'AM' : 'PM';
            const h12 = hh % 12 || 12;
            tCol.innerHTML = `<b>${h12}:${mm.toString().padStart(2,'0')}</b><span class='ampm'> ${ampm}</span>`;
            row.appendChild(tCol);
            for (let d = 0; d < 7; d++) {
                const cell = document.createElement('td');
                const sid = `${d}-${h * SLOTS_PER_HOUR + s}`;
                cell.dataset.slotId = sid;
                cell.innerHTML = '<div class="slot-names"></div>';
                row.appendChild(cell);
            }
            container.appendChild(row);
        }
    }
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
    // This function is now effectively unused for schedule updates 
    // but kept for compatibility with other triggers if needed.
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
        if (!db || !roomId) return;
        const name = elements.usernameInput.value || 'Anonymous';
        const pin = elements.pinInput ? elements.pinInput.value : '';
        // No longer auto-syncing slots here
        if (!elements.usernameInput.disabled) lockName();
    }, 1200);
}

function updateLocalState() {
    const name = elements.usernameInput.value || 'Anonymous';
    const pin = elements.pinInput ? elements.pinInput.value : '';
    roomData[name] = { slots: Array.from(selectedSlots), pin: pin };
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
        let slots = roomData[user];
        if (slots && !Array.isArray(slots)) slots = slots.slots || [];
        if (!Array.isArray(slots)) return;
        slots.forEach(sid => {
            const target = document.querySelector(`#group-grid-body [data-slot-id="${sid}"] .slot-names`);
            if (target) {
                const tag = document.createElement('span');
                tag.className = 'name-tag';
                tag.textContent = user;
                tag.style.backgroundColor = getUserColor(user);
                target.appendChild(tag);
            }
        });
    });
    // Trim grid rows to match data range
    adjustGroupGridRows();
}

function adjustGroupGridRows() {
    const allRows = document.querySelectorAll('#group-grid-body tr');

    // Find min/max slot index across all users
    let minSlot = Infinity, maxSlot = -Infinity;
    Object.values(roomData).forEach(data => {
        let slots = data;
        if (slots && !Array.isArray(slots)) slots = slots.slots || [];
        if (!Array.isArray(slots)) return;
        slots.forEach(sid => {
            const s = parseInt(sid.split('-')[1]);
            if (s < minSlot) minSlot = s;
            if (s > maxSlot) maxSlot = s;
        });
    });

    // No data yet — show all rows (12am to midnight)
    if (minSlot === Infinity) {
        allRows.forEach(row => row.style.display = '');
        return;
    }

    // Add 1-hour padding (2 slots) around the data range
    const padding = 2;
    const showMin = Math.max(0, minSlot - padding);
    const showMax = Math.min(47, maxSlot + padding);

    allRows.forEach(row => {
        const idx = parseInt(row.dataset.slotIndex);
        row.style.display = (idx >= showMin && idx <= showMax) ? '' : 'none';
    });
}

function getUserColor(user) {
    if (userColors[user]) return userColors[user];
    
    // Simple hash to pick from palette
    let hash = 0;
    for (let i = 0; i < user.length; i++) {
        hash = user.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % COLOR_PALETTE.length;
    userColors[user] = COLOR_PALETTE[index];
    return userColors[user];
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

    let slots = roomData[user];
    if (slots && !Array.isArray(slots)) slots = slots.slots || [];
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
        let slots = roomData[user];
        if (slots && !Array.isArray(slots)) slots = slots.slots || [];
        const userSlots = new Set(slots);
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
        const displayCode = `<t:${b.startTime}:F> <t:${endUnix}:t>`;
        const copyCode = `<t:${b.startTime}:F> to <t:${endUnix}:t>`;
        const readable = getReadableTimeRange(b.day, b.startSlot, b.lastSlot + 1);
        
        html += `
            <div class='summary-line timestamp-entry'>
                <div class="timestamp-text-pair">
                    <code>${displayCode}</code>
                    <span class="readable-time">${readable}</span>
                </div>
                <button class="btn btn-small btn-secondary copy-btn" onclick="copyText('${copyCode}')">Copy</button>
            </div>`;
    });
    html += "</div>";
    elements.groupList.innerHTML = html;
}

function renderTimestampList() {
    if (!elements.timestampList) return;
    let html = "";
    Object.keys(roomData).forEach(user => {
        let slots = roomData[user];
        if (slots && !Array.isArray(slots)) slots = slots.slots || [];
        if (!Array.isArray(slots) || slots.length === 0) return;
        const blocks = groupSlotsIntoBlocks(slots);
        
        html += `
            <details class='user-timestamp-detail' open>
                <summary>
                    ${user}
                    <button class="btn btn-small btn-secondary copy-btn" onclick="copyUserTimestamps('${user}', event)">Copy User's Times</button>
                </summary>
                <div class='timestamp-codes'>`;
        
        blocks.forEach(b => {
            const endUnix = getUnixAtSlot(b.day, b.lastSlot + 1);
            const displayCode = `<t:${b.startTime}:F> <t:${endUnix}:t>`;
            const copyCode = `<t:${b.startTime}:F> to <t:${endUnix}:t>`;
            const readable = getReadableTimeRange(b.day, b.startSlot, b.lastSlot + 1);
            
            html += `
                <div class="timestamp-entry">
                    <div class="timestamp-text-pair">
                        <code>${displayCode}</code>
                        <span class="readable-time">${readable}</span>
                    </div>
                    <button class="btn btn-small btn-secondary copy-btn" onclick="copyText('${copyCode}')">Copy</button>
                </div>`;
        });
        html += `</div></details>`;
    });
    elements.timestampList.innerHTML = html || "Select blocks to see codes...";
}

function getReadableTimeRange(dayIdx, startSlot, endSlot) {
    const start = slotLabel(startSlot);
    const end = slotLabel(endSlot);
    return `${DAY_NAMES[dayIdx]}, ${start} - ${end}`;
}

function copyText(text) {
    navigator.clipboard.writeText(text).then(() => {
        // Visual feedback is handled by button hover/active usually, 
        // but we could add a toast if needed.
    });
}

function copyUserTimestamps(user, event) {
    if (event) event.preventDefault(); // Stop details from toggling
    
    let slots = roomData[user];
    if (slots && !Array.isArray(slots)) slots = slots.slots || [];
    if (!Array.isArray(slots)) return;
    
    let text = `**${user}'s Availability:**\n`;
    const blocks = groupSlotsIntoBlocks(slots);
    blocks.forEach(b => {
        const endUnix = getUnixAtSlot(b.day, b.lastSlot + 1);
        text += `- <t:${b.startTime}:F> to <t:${endUnix}:t> (${getReadableTimeRange(b.day, b.startSlot, b.lastSlot + 1)})\n`;
    });
    
    navigator.clipboard.writeText(text);
}

function copyAllTimestamps() {
    let allText = "### ChronoSync Availability Summary\n\n";
    Object.keys(roomData).sort().forEach(user => {
        let slots = roomData[user];
        if (slots && !Array.isArray(slots)) slots = slots.slots || [];
        if (!Array.isArray(slots) || slots.length === 0) return;
        
        allText += `**${user}**:\n`;
        const blocks = groupSlotsIntoBlocks(slots);
        blocks.forEach(b => {
            const endUnix = getUnixAtSlot(b.day, b.lastSlot + 1);
            const readable = getReadableTimeRange(b.day, b.startSlot, b.lastSlot + 1);
            allText += `- <t:${b.startTime}:F> to <t:${endUnix}:t> (${readable})\n`;
        });
        allText += "\n";
    });
    
    navigator.clipboard.writeText(allText);
    const originalText = elements.copyAllBtn.innerText;
    elements.copyAllBtn.innerText = "COPIED!";
    setTimeout(() => elements.copyAllBtn.innerText = originalText, 2000);
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
    const date = new Date(monday.getTime() + (dayIdx * 24 * 60 + slotIdx * 30) * 60000);
    return Math.floor(date.getTime() / 1000);
}

function loadIdentity() {
    // REMOVED manual localStorage load to allow browser-native autocomplete
}

async function attemptLockIdentity() {
    const name = elements.usernameInput.value.trim();
    if (!name) return;
    const pin = elements.pinInput.value.trim();

    elements.authError.textContent = 'Checking...';

    // If db is not yet loaded, lock optimistically or wait. 
    // Here we'll just check existing roomData from the realtime snapshot.
    // However, if it's the very first load, roomData might be empty.
    // Let's do a direct fetch to be safe if db exists.
    if (db && roomId) {
        try {
            const doc = await db.collection("rooms").doc(roomId).get();
            if (doc.exists) {
                const data = doc.data();
                if (data[name]) {
                    const userData = data[name];
                    const existingPin = !Array.isArray(userData) ? userData.pin : undefined;
                    
                    if (existingPin && existingPin !== pin) {
                        elements.authError.textContent = 'Incorrect password/PIN.';
                        return; // Deny access
                    } else if (!existingPin && pin) {
                        // User exists as legacy, now adding PIN
                    } else {
                        // Match or both no PIN
                        if (!Array.isArray(userData)) {
                            loadSlotsIntoForm(userData.slots || []);
                        } else {
                            loadSlotsIntoForm(userData);
                        }
                    }
                }
            }
        } catch (e) {
            console.error(e);
        }
    }

    elements.authError.textContent = '';
    lockName();
    if (pin) {
        elements.pinInput.disabled = true;
        elements.pinInput.classList.add('locked');
    }
    if (elements.lockBtn) elements.lockBtn.style.display = 'none';
}

function lockName() {
    if (elements.usernameInput.value.trim() === "") return;
    elements.usernameInput.disabled = true;
    elements.usernameInput.classList.add('locked');
}

function loadSlotsIntoForm(slots) {
    if (!slots || slots.length === 0) return;
    
    selectedSlots = new Set(slots);
    const blocks = groupSlotsIntoBlocks(slots);
    
    // Create a map of day -> blocks
    const dayBlocks = {};
    for (let i = 0; i < 7; i++) dayBlocks[i] = [];
    
    blocks.forEach(b => {
        dayBlocks[b.day].push(b);
    });

    // Rebuild form
    document.querySelectorAll('.avail-day-row').forEach(row => {
        const d = parseInt(row.dataset.dayIndex);
        const slotsContainer = row.querySelector('.avail-slots');
        slotsContainer.innerHTML = '';
        
        const dBlocks = dayBlocks[d];
        if (dBlocks.length === 0) {
            addSlotRow(slotsContainer, d); // Add empty row
        } else {
            dBlocks.forEach(b => {
                addSlotRow(slotsContainer, d);
                // The newly added row is the last one
                const newRow = slotsContainer.lastElementChild;
                const startSel = newRow.querySelector('.start-select');
                const endSel = newRow.querySelector('.end-select');
                
                startSel.value = b.startSlot;
                
                // Ensure end selector has the correct options before setting value
                endSel.innerHTML = dropdownOptions(b.lastSlot + 1, true);
                endSel.value = b.lastSlot + 1;
                
                // Trigger change event to update preview
                const event = new Event('change');
                startSel.dispatchEvent(event);
            });
        }
    });
}
