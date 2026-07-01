// ============================================================
//  Фронтенд для симулятора "Государственная Дума"
// ============================================================

// ---------- КОНФИГУРАЦИЯ ----------
const BACKEND_URL = 'https://duma-backend-1.onrender.com';

// ---------- ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ----------
let socket = null;
let peer = null;
let myPeerId = null;
let currentToken = null;
let currentUser = null;
let isAdmin = false;

// ---------- DOM ЭЛЕМЕНТЫ ----------
const userInfo = document.getElementById('user-info');
const adminPanel = document.getElementById('admin-panel');
const deputyInfo = document.getElementById('deputy-info');
const deputyNameDisplay = document.getElementById('deputy-name-display');
const timerDisplay = document.getElementById('timer-display');
const voteStatus = document.getElementById('vote-status');
const resultsDisplay = document.getElementById('results-display');
const breakStatus = document.getElementById('break-status');
const deputiesList = document.getElementById('deputies-list');
const speakerSelect = document.getElementById('speaker-select');
const customTime = document.getElementById('custom-time');
const deputyNameInput = document.getElementById('deputy-name');

// ============================================================
//  ОСНОВНЫЕ ФУНКЦИИ АВТОРИЗАЦИИ
// ============================================================

function showLoginForm() {
    const password = prompt('Введите пароль председателя или токен депутата:');
    if (!password) return;

    if (password === 'duma2026') {
        isAdmin = true;
        currentToken = 'admin';
        currentUser = { name: 'Председатель', isAdmin: true };
        localStorage.setItem('duma_token', 'admin');
        userInfo.textContent = 'Председатель';
        adminPanel.style.display = 'block';
        deputyInfo.style.display = 'none';
        fetchDeputies();
        return;
    } else {
        currentToken = password;
        attemptLogin(password);
    }
}

function attemptLogin(token) {
    fetch(`${BACKEND_URL}/api/session-state`, {
        method: 'GET',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': token 
        }
    })
    .then(res => {
        if (!res.ok) {
            if (res.status === 401) throw new Error('Неверный токен');
            throw new Error('Ошибка сервера');
        }
        return res.json();
    })
    .then(data => {
        if (!data.success) {
            alert('Неверный токен. Попробуйте снова.');
            localStorage.removeItem('duma_token');
            showLoginForm();
            return;
        }
        currentUser = data.user;
        isAdmin = data.user.isAdmin;
        localStorage.setItem('duma_token', token);
        currentToken = token;
        userInfo.textContent = `Депутат: ${data.user.name}`;
        deputyNameDisplay.textContent = data.user.name;
        
        if (isAdmin) {
            adminPanel.style.display = 'block';
            deputyInfo.style.display = 'none';
            fetchDeputies();
        } else {
            adminPanel.style.display = 'none';
            deputyInfo.style.display = 'block';
        }
        initSocket(token);
    })
    .catch(err => {
        console.error('Ошибка входа:', err);
        alert('Ошибка подключения к серверу: ' + err.message);
        localStorage.removeItem('duma_token');
        showLoginForm();
    });
}

// ---------- ЗАГРУЗКА СПИСКА ДЕПУТАТОВ ----------
function fetchDeputies() {
    fetch(`${BACKEND_URL}/api/deputies`)
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            renderDeputies(data.deputies);
            populateSpeakerSelect(data.deputies);
        }
    })
    .catch(console.error);
}

function renderDeputies(deputies) {
    deputiesList.innerHTML = '';
    deputies.forEach(dep => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span>${dep.name}</span>
            <span style="font-size:0.7rem;color:#aaa;">${dep.token}</span>
            <div class="qr-code" id="qr-${dep.id}"></div>
        `;
        deputiesList.appendChild(li);
        const phoneUrl = `${window.location.origin}/phone.html?token=${dep.token}`;
        if (typeof QRCode !== 'undefined') {
            new QRCode(document.getElementById(`qr-${dep.id}`), {
                text: phoneUrl,
                width: 60,
                height: 60
            });
        }
    });
}

function populateSpeakerSelect(deputies) {
    speakerSelect.innerHTML = '';
    deputies.forEach(dep => {
        const opt = document.createElement('option');
        opt.value = dep.id;
        opt.textContent = dep.name;
        speakerSelect.appendChild(opt);
    });
}

// ---------- СОКЕТ И PEER ----------
function initSocket(token) {
    if (socket) socket.disconnect();
    socket = io(BACKEND_URL);
    socket.on('connect', () => {
        console.log('✅ Сокет подключен');
        if (peer && myPeerId) {
            socket.emit('join', { token, peerId: myPeerId });
        }
    });
    socket.on('error', (msg) => {
        alert('Ошибка: ' + msg);
    });
}

// ---------- ИНИЦИАЛИЗАЦИЯ ----------
document.addEventListener('DOMContentLoaded', () => {
    const savedToken = localStorage.getItem('duma_token');
    if (savedToken && savedToken !== 'admin') {
        currentToken = savedToken;
        attemptLogin(savedToken);
    } else if (savedToken === 'admin') {
        isAdmin = true;
        currentUser = { name: 'Председатель', isAdmin: true };
        userInfo.textContent = 'Председатель';
        adminPanel.style.display = 'block';
        deputyInfo.style.display = 'none';
        fetchDeputies();
    } else {
        showLoginForm();
    }
});

// ---------- ОБРАБОТЧИКИ КНОПОК ----------
document.addEventListener('DOMContentLoaded', () => {
    const createDeputyBtn = document.getElementById('create-deputy-btn');
    const giveFloorBtn = document.getElementById('give-floor-btn');
    const revokeFloorBtn = document.getElementById('revoke-floor-btn');
    const startVotingBtn = document.getElementById('start-voting-btn');
    const closeVotingBtn = document.getElementById('close-voting-btn');
    const announceResultsBtn = document.getElementById('announce-results-btn');
    const breakBtn = document.getElementById('break-btn');
    const endBreakBtn = document.getElementById('end-break-btn');
    const clearAllBtn = document.getElementById('clear-all-btn');

    if (createDeputyBtn) {
        createDeputyBtn.addEventListener('click', () => {
            const name = deputyNameInput.value.trim();
            if (!name) return alert('Введите имя');
            fetch(`${BACKEND_URL}/api/create-deputy`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, adminPassword: 'duma2026' })
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    deputyNameInput.value = '';
                    fetchDeputies();
                } else {
                    alert(data.message);
                }
            })
            .catch(console.error);
        });
    }

    // Остальные кнопки по аналогии...
    console.log('🏛️ Симулятор Госдумы загружен');
});
