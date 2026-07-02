// ============================================================
//  Фронтенд для симулятора "Государственная Дума"
//  ВЕРСИЯ 2.0 - ПРАВИЛЬНАЯ АВТОРИЗАЦИЯ
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
let myStream = null;
let isMuted = true;

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
//  УПРАВЛЕНИЕ ТОКЕНОМ (ПЕРСОНАЛЬНЫЙ ДЛЯ КАЖДОЙ ВКЛАДКИ)
// ============================================================

// Получить токен из localStorage (только для ЭТОЙ вкладки)
function getToken() {
    return localStorage.getItem('duma_token_' + window.location.host);
}

// Сохранить токен (только для ЭТОЙ вкладки)
function saveToken(token) {
    localStorage.setItem('duma_token_' + window.location.host, token);
}

// Удалить токен (выход из аккаунта)
function clearToken() {
    localStorage.removeItem('duma_token_' + window.location.host);
}

// Проверить, есть ли токен
function hasToken() {
    return getToken() !== null;
}

// ============================================================
//  ФУНКЦИИ АВТОРИЗАЦИИ
// ============================================================

function clearTokenAndReload() {
    clearToken();
    // Закрываем сокет
    if (socket) {
        socket.disconnect();
        socket = null;
    }
    // Закрываем Peer
    if (peer) {
        peer.destroy();
        peer = null;
    }
    // Останавливаем поток
    if (myStream) {
        myStream.getTracks().forEach(track => track.stop());
        myStream = null;
    }
    location.reload();
}

function logout() {
    if (confirm('Выйти из аккаунта?')) {
        clearTokenAndReload();
    }
}

// Добавляем кнопку выхода
function addLogoutButton() {
    let logoutBtn = document.getElementById('logout-btn');
    if (!logoutBtn) {
        const header = document.querySelector('header');
        if (header) {
            logoutBtn = document.createElement('button');
            logoutBtn.id = 'logout-btn';
            logoutBtn.textContent = '🚪 Выйти';
            logoutBtn.style.cssText = 'background:#e94560;color:white;border:none;padding:6px 14px;border-radius:6px;cursor:pointer;margin-left:10px;';
            logoutBtn.addEventListener('click', logout);
            header.appendChild(logoutBtn);
        }
    }
}

function showLoginForm() {
    // Если уже есть токен — используем его
    const savedToken = getToken();
    if (savedToken) {
        attemptLogin(savedToken);
        return;
    }
    
    const input = prompt('Введите пароль председателя или токен депутата:');
    if (!input) return;

    // Проверяем, может это пароль председателя
    if (input === 'duma2026') {
        // Председатель НЕ СОХРАНЯЕТСЯ как токен, он просто входит
        isAdmin = true;
        currentToken = 'admin';
        currentUser = { name: 'Председатель', isAdmin: true };
        userInfo.textContent = 'Председатель';
        adminPanel.style.display = 'block';
        deputyInfo.style.display = 'none';
        fetchDeputies();
        initSocket('admin');
        addLogoutButton();
        return;
    }
    
    // Иначе это токен депутата — пробуем войти
    saveToken(input);
    attemptLogin(input);
}

function attemptLogin(token) {
    // Показываем загрузку
    userInfo.textContent = 'Загрузка...';
    
    fetch(`${BACKEND_URL}/api/session-state`, {
        method: 'GET',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': token 
        }
    })
    .then(res => {
        if (!res.ok) {
            if (res.status === 401) {
                clearToken();
                throw new Error('Неверный токен');
            }
            throw new Error('Ошибка сервера');
        }
        return res.json();
    })
    .then(data => {
        if (!data.success) {
            clearToken();
            alert('Неверный токен');
            showLoginForm();
            return;
        }
        
        currentUser = data.user;
        isAdmin = data.user.isAdmin;
        currentToken = token;
        
        // Обновляем интерфейс
        userInfo.textContent = isAdmin ? 'Председатель' : `Депутат: ${data.user.name}`;
        deputyNameDisplay.textContent = data.user.name;
        
        if (isAdmin) {
            adminPanel.style.display = 'block';
            deputyInfo.style.display = 'none';
            fetchDeputies();
            addLogoutButton();
        } else {
            adminPanel.style.display = 'none';
            deputyInfo.style.display = 'block';
            // Запрашиваем камеру для депутата
            startLocalStream();
            addLogoutButton();
        }
        initSocket(token);
    })
    .catch(err => {
        console.error('Ошибка входа:', err);
        alert('Ошибка: ' + err.message);
        clearToken();
        showLoginForm();
    });
}

// ---------- ЗАПРОС КАМЕРЫ ДЛЯ ДЕПУТАТА ----------
function startLocalStream() {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then(stream => {
            myStream = stream;
            console.log('✅ Камера и микрофон включены');
            // Отображаем своё видео
            showLocalVideo(stream);
        })
        .catch(err => {
            console.warn('⚠️ Нет доступа к камере/микрофону:', err);
            // Не блокируем работу, просто предупреждаем
        });
}

function showLocalVideo(stream) {
    // Добавляем локальное видео в интерфейс
    const container = document.getElementById('video-container') || document.body;
    const videoWrapper = document.createElement('div');
    videoWrapper.className = 'video-item';
    videoWrapper.id = 'local-video';
    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;
    video.muted = true;
    videoWrapper.appendChild(video);
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = 'Вы (депутат)';
    videoWrapper.appendChild(label);
    container.appendChild(videoWrapper);
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

// ---------- СОКЕТ ----------
function initSocket(token) {
    if (socket) {
        socket.disconnect();
        socket = null;
    }
    socket = io(BACKEND_URL);
    socket.on('connect', () => {
        console.log('✅ Сокет подключен');
        // Отправляем join с токеном
        socket.emit('join', { token, peerId: myPeerId || null });
    });
    socket.on('error', (msg) => {
        console.error('Ошибка сокета:', msg);
    });
}

// ---------- ИНИЦИАЛИЗАЦИЯ ----------
document.addEventListener('DOMContentLoaded', () => {
    const savedToken = getToken();
    if (savedToken) {
        attemptLogin(savedToken);
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

    console.log('🏛️ Симулятор Госдумы загружен');
});

// ---------- ДЕБАГ: ПОКАЗАТЬ ТЕКУЩИЙ ТОКЕН ----------
window.showCurrentToken = function() {
    console.log('Текущий токен:', getToken());
    console.log('Пользователь:', currentUser);
};
