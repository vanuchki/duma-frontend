// ============================================================
//  Мобильный пульт депутата (телефон)
//  ВЕРСИЯ 2.0 - ПРАВИЛЬНАЯ АВТОРИЗАЦИЯ
// ============================================================

const BACKEND_URL = 'https://duma-backend-1.onrender.com';

// ---------- ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ----------
let socket = null;
let currentUser = null;
let hasVoted = false;
let currentToken = null;

// ---------- DOM ЭЛЕМЕНТЫ ----------
const userNameEl = document.getElementById('user-name');
const timerEl = document.getElementById('timer');
const breakStatusEl = document.getElementById('break-status');
const voteStatusEl = document.getElementById('vote-status');
const voteButtonsContainer = document.getElementById('vote-buttons-container');
const resultsDisplay = document.getElementById('results-display');

// ============================================================
//  УПРАВЛЕНИЕ ТОКЕНОМ (ПЕРСОНАЛЬНЫЙ ДЛЯ КАЖДОГО УСТРОЙСТВА)
// ============================================================

// Получить токен из localStorage
function getPhoneToken() {
    // Сначала проверяем URL (параметр token)
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');
    if (urlToken) {
        // Сохраняем токен из URL
        localStorage.setItem('duma_phone_token', urlToken);
        // Убираем токен из URL (чтобы не светился в истории)
        window.history.replaceState({}, document.title, window.location.pathname);
        return urlToken;
    }
    // Иначе берём из localStorage
    return localStorage.getItem('duma_phone_token');
}

// Сохранить токен
function savePhoneToken(token) {
    localStorage.setItem('duma_phone_token', token);
}

// Удалить токен (выход)
function clearPhoneToken() {
    localStorage.removeItem('duma_phone_token');
}

// Проверить, есть ли токен
function hasPhoneToken() {
    return getPhoneToken() !== null;
}

// ============================================================
//  ФУНКЦИИ ВЫХОДА
// ============================================================

function logout() {
    if (confirm('Выйти из аккаунта депутата?')) {
        clearPhoneToken();
        if (socket) {
            socket.disconnect();
            socket = null;
        }
        location.reload();
    }
}

// Добавляем кнопку выхода
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

// ============================================================
//  ОСНОВНЫЕ ФУНКЦИИ
// ============================================================

// Инициализация
async function init() {
    // Получаем токен
    currentToken = getPhoneToken();
    
    if (!currentToken) {
        // Если нет токена в URL и в localStorage
        const tokenInput = prompt('Введите токен депутата:');
        if (tokenInput) {
            currentToken = tokenInput;
            savePhoneToken(tokenInput);
        } else {
            document.body.innerHTML = '<h2 style="color:red;text-align:center;margin-top:50px;">❌ Токен не указан</h2>';
            return;
        }
    }
    
    // Пытаемся войти
    try {
        const res = await fetch(`${BACKEND_URL}/api/session-state`, {
            method: 'GET',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': currentToken 
            }
        });
        
        if (!res.ok) {
            if (res.status === 401) {
                clearPhoneToken();
                alert('Неверный токен. Попробуйте снова.');
                init(); // Повторяем
                return;
            }
            throw new Error('Ошибка сервера');
        }
        
        const data = await res.json();
        if (!data.success) {
            clearPhoneToken();
            alert('Неверный токен');
            init();
            return;
        }
        
        // Успешный вход
        currentUser = data.user;
        userNameEl.textContent = `Депутат: ${currentUser.name}`;
        addLogoutButton();
        
        // Восстанавливаем состояние
        restoreState(data.state, data.voted || false);
        
        // Инициализируем сокет
        initSocket(currentToken);
        
    } catch (err) {
        console.error('Ошибка входа:', err);
        alert('Ошибка подключения к серверу: ' + err.message);
        clearPhoneToken();
        init(); // Повторяем
    }
}

function restoreState(state, voted) {
    hasVoted = voted || false;
    
    // Таймер
    timerEl.textContent = `⏱️ ${state.time_remaining || 0}`;
    
    // Перерыв
    if (state.is_break) {
        breakStatusEl.textContent = '⏸️ ПЕРЕРЫВ';
    } else {
        breakStatusEl.textContent = '';
    }
    
    // Голосование
    if (state.is_voting) {
        voteStatusEl.textContent = '🗳️ Идёт голосование';
        if (!hasVoted) {
            showVoteButtons();
        } else {
            voteStatusEl.textContent += ' (вы уже проголосовали)';
            hideVoteButtons();
        }
    } else {
        voteStatusEl.textContent = 'Голосование не активно';
        hideVoteButtons();
    }
}

function showVoteButtons() {
    voteButtonsContainer.innerHTML = '';
    const choices = [
        { label: 'ЗА', value: 'for', cls: 'for' },
        { label: 'ПРОТИВ', value: 'against', cls: 'against' },
        { label: 'ВОЗДЕРЖАЛСЯ', value: 'abstain', cls: 'abstain' }
    ];
    choices.forEach(choice => {
        const btn = document.createElement('button');
        btn.textContent = choice.label;
        btn.className = choice.cls;
        btn.style.cssText = `
            flex: 1;
            min-width: 80px;
            padding: 16px 0;
            border: none;
            border-radius: 12px;
            font-weight: bold;
            font-size: 1.2rem;
            cursor: pointer;
            background: ${choice.cls === 'for' ? '#2e7d32' : choice.cls === 'against' ? '#c62828' : '#f9a825'};
            color: ${choice.cls === 'abstain' ? '#000' : '#fff'};
            transition: 0.2s;
        `;
        btn.addEventListener('click', () => {
            sendVote(choice.value);
        });
        voteButtonsContainer.appendChild(btn);
    });
}

function hideVoteButtons() {
    voteButtonsContainer.innerHTML = '';
}

function sendVote(vote) {
    // Блокируем кнопки, чтобы нельзя было проголосовать дважды
    voteButtonsContainer.innerHTML = '<p style="color:#ffd700;">⏳ Отправка голоса...</p>';
    
    fetch(`${BACKEND_URL}/api/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: currentToken, vote })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            alert('✅ Ваш голос учтён!');
            hasVoted = true;
            hideVoteButtons();
            voteStatusEl.textContent = '🗳️ Идёт голосование (вы уже проголосовали)';
        } else {
            alert('❌ ' + data.message);
            showVoteButtons(); // Возвращаем кнопки
        }
    })
    .catch(err => {
        console.error('Ошибка при голосовании:', err);
        alert('❌ Ошибка отправки голоса');
        showVoteButtons();
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
        // Отправляем join (без видео)
        socket.emit('join', { token, peerId: null });
    });
    
    socket.on('session-state', (data) => {
        currentUser = data.user;
        restoreState(data.state, hasVoted);
    });
    
    socket.on('voting-started', () => {
        voteStatusEl.textContent = '🗳️ Идёт голосование';
        if (!hasVoted) {
            showVoteButtons();
        } else {
            voteStatusEl.textContent += ' (вы уже проголосовали)';
        }
    });
    
    socket.on('voting-closed', () => {
        voteStatusEl.textContent = '🔒 Голосование закрыто';
        hideVoteButtons();
    });
    
    socket.on('vote-count', (data) => {
        voteStatusEl.textContent = `🗳️ Проголосовало: ${data.total}`;
    });
    
    socket.on('results', (data) => {
        resultsDisplay.innerHTML = `
            <strong>ЗА</strong> — ${data.for} &nbsp;|&nbsp;
            <strong>ПРОТИВ</strong> — ${data.against} &nbsp;|&nbsp;
            <strong>ВОЗДЕРЖАЛСЯ</strong> — ${data.abstain}
        `;
    });
    
    socket.on('timer-update', (data) => {
        timerEl.textContent = `⏱️ ${data.time}`;
    });
    
    socket.on('break-started', () => {
        breakStatusEl.textContent = '⏸️ ПЕРЕРЫВ';
    });
    
    socket.on('break-ended', () => {
        breakStatusEl.textContent = '';
    });
    
    socket.on('floor-changed', (data) => {
        if (data.speakerId) {
            // Кто-то говорит
            timerEl.textContent = `⏱️ ${data.time || 0}`;
        }
    });
    
    socket.on('clear-all', () => {
        resultsDisplay.innerHTML = '';
        timerEl.textContent = '⏱️ 0';
        voteStatusEl.textContent = '';
        breakStatusEl.textContent = '';
        hideVoteButtons();
        hasVoted = false;
    });
    
    socket.on('error', (msg) => {
        console.error('Ошибка сокета:', msg);
        alert('Ошибка: ' + msg);
    });
}

// ============================================================
//  ЗАПУСК
// ============================================================

// Запускаем при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    init();
});

// Дебаг: показать текущий токен
window.showPhoneToken = function() {
    console.log('Текущий токен:', getPhoneToken());
    console.log('Пользователь:', currentUser);
};

// Обработчик для восстановления при ошибках соединения
window.addEventListener('online', () => {
    console.log('🔄 Интернет восстановлен, переподключаемся...');
    if (!socket || !socket.connected) {
        initSocket(currentToken);
    }
});
