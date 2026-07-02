const BACKEND_URL = 'https://duma-backend-1.onrender.com';

let socket = null;
let currentUser = null;
let hasVoted = false;
let currentToken = null;

const userNameEl = document.getElementById('user-name');
const timerEl = document.getElementById('timer');
const breakStatusEl = document.getElementById('break-status');
const voteStatusEl = document.getElementById('vote-status');
const voteButtonsContainer = document.getElementById('vote-buttons-container');
const resultsDisplay = document.getElementById('results-display');

function getPhoneToken() {
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');
    if (urlToken) {
        localStorage.setItem('duma_phone_token', urlToken);
        window.history.replaceState({}, document.title, window.location.pathname);
        return urlToken;
    }
    return localStorage.getItem('duma_phone_token');
}

function savePhoneToken(token) {
    localStorage.setItem('duma_phone_token', token);
}

function clearPhoneToken() {
    localStorage.removeItem('duma_phone_token');
}

function logout() {
    if (confirm('Выйти из аккаунта депутата?')) {
        clearPhoneToken();
        if (socket) { socket.disconnect(); socket = null; }
        location.reload();
    }
}

function addLogoutButton() {
    let logoutBtn = document.getElementById('phone-logout-btn');
    if (!logoutBtn) {
        const header = document.querySelector('header');
        if (header) {
            logoutBtn = document.createElement('button');
            logoutBtn.id = 'phone-logout-btn';
            logoutBtn.textContent = '🚪 Выйти';
            logoutBtn.style.cssText = 'background:#e94560;color:white;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;margin-top:10px;font-size:0.9rem;';
            logoutBtn.addEventListener('click', logout);
            header.appendChild(logoutBtn);
        }
    }
}

async function init() {
    currentToken = getPhoneToken();
    if (!currentToken) {
        const tokenInput = prompt('Введите токен депутата:');
        if (tokenInput) {
            currentToken = tokenInput;
            savePhoneToken(tokenInput);
        } else {
            document.body.innerHTML = '<h2 style="color:red;text-align:center;margin-top:50px;">❌ Токен не указан</h2>';
            return;
        }
    }
    try {
        const res = await fetch(`${BACKEND_URL}/api/session-state`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json', 'Authorization': currentToken }
        });
        if (!res.ok) {
            if (res.status === 401) { clearPhoneToken(); alert('Неверный токен'); init(); return; }
            throw new Error('Ошибка сервера');
        }
        const data = await res.json();
        if (!data.success) { clearPhoneToken(); alert('Неверный токен'); init(); return; }
        currentUser = data.user;
        userNameEl.textContent = `Депутат: ${currentUser.name}`;
        addLogoutButton();
        restoreState(data.state, data.voted || false);
        initSocket(currentToken);
    } catch (err) {
        console.error('Ошибка входа:', err);
        alert('Ошибка подключения к серверу: ' + err.message);
        clearPhoneToken();
        init();
    }
}

function restoreState(state, voted) {
    hasVoted = voted || false;
    timerEl.textContent = `⏱️ ${state.time_remaining || 0}`;
    if (state.is_break) breakStatusEl.textContent = '⏸️ ПЕРЕРЫВ';
    else breakStatusEl.textContent = '';
    if (state.is_voting) {
        voteStatusEl.textContent = '🗳️ Идёт голосование';
        if (!hasVoted) showVoteButtons();
        else voteStatusEl.textContent += ' (вы уже проголосовали)';
    } else { voteStatusEl.textContent = 'Голосование не активно'; hideVoteButtons(); }
}

function showVoteButtons() {
    voteButtonsContainer.innerHTML = '';
    const choices = [
        { label: 'ЗА', value: 'for', color: '#2e7d32' },
        { label: 'ПРОТИВ', value: 'against', color: '#c62828' },
        { label: 'ВОЗДЕРЖАЛСЯ', value: 'abstain', color: '#f9a825' }
    ];
    choices.forEach(choice => {
        const btn = document.createElement('button');
        btn.textContent = choice.label;
        btn.style.cssText = `flex:1;min-width:80px;padding:16px 0;border:none;border-radius:12px;font-weight:bold;font-size:1.2rem;cursor:pointer;background:${choice.color};color:${choice.value === 'abstain' ? '#000' : '#fff'};`;
        btn.onclick = () => sendVote(choice.value);
        voteButtonsContainer.appendChild(btn);
    });
}

function hideVoteButtons() {
    voteButtonsContainer.innerHTML = '';
}

function sendVote(vote) {
    voteButtonsContainer.innerHTML = '<p style="color:#ffd700;">⏳ Отправка...</p>';
    fetch(`${BACKEND_URL}/api/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: currentToken, vote })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) { alert('✅ Голос учтён!'); hasVoted = true; hideVoteButtons(); voteStatusEl.textContent = '🗳️ Вы проголосовали'; }
        else { alert('❌ ' + data.message); showVoteButtons(); }
    })
    .catch(err => { console.error(err); alert('❌ Ошибка'); showVoteButtons(); });
}

function initSocket(token) {
    if (socket) { socket.disconnect(); socket = null; }
    socket = io(BACKEND_URL);
    socket.on('connect', () => { console.log('✅ Сокет подключен'); socket.emit('join', { token, peerId: null, authorization: token }); });
    socket.on('session-state', (data) => { currentUser = data.user; restoreState(data.state, hasVoted); });
    socket.on('voting-started', () => { voteStatusEl.textContent = '🗳️ Идёт голосование'; if (!hasVoted) showVoteButtons(); else voteStatusEl.textContent += ' (вы уже проголосовали)'; });
    socket.on('voting-closed', () => { voteStatusEl.textContent = '🔒 Голосование закрыто'; hideVoteButtons(); });
    socket.on('vote-count', (data) => { voteStatusEl.textContent = `🗳️ Проголосовало: ${data.total}`; });
    socket.on('results', (data) => { resultsDisplay.innerHTML = `<strong>ЗА</strong> — ${data.for} | <strong>ПРОТИВ</strong> — ${data.against} | <strong>ВОЗДЕРЖАЛСЯ</strong> — ${data.abstain}`; });
    socket.on('timer-update', (data) => { timerEl.textContent = `⏱️ ${data.time}`; });
    socket.on('break-started', () => { breakStatusEl.textContent = '⏸️ ПЕРЕРЫВ'; });
    socket.on('break-ended', () => { breakStatusEl.textContent = ''; });
    socket.on('floor-changed', (data) => { if (data.speakerId) timerEl.textContent = `⏱️ ${data.time || 0}`; });
    socket.on('clear-all', () => { resultsDisplay.innerHTML = ''; timerEl.textContent = '⏱️ 0'; voteStatusEl.textContent = ''; breakStatusEl.textContent = ''; hideVoteButtons(); hasVoted = false; });
    socket.on('error', (msg) => { console.error('Ошибка сокета:', msg); alert('Ошибка: ' + msg); });
}

document.addEventListener('DOMContentLoaded', init);
