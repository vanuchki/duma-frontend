// ============================================================
//  Мобильный пульт депутата (телефон)
//  Только управление голосованием и отображение статуса
// ============================================================

const BACKEND_URL = 'http://localhost:3000'; // замените на ваш бэкенд

// Получаем токен из URL
const urlParams = new URLSearchParams(window.location.search);
const token = urlParams.get('token');
let currentUser = null;
let socket = null;
let hasVoted = false;

// DOM
const userNameEl = document.getElementById('user-name');
const timerEl = document.getElementById('timer');
const breakStatusEl = document.getElementById('break-status');
const voteStatusEl = document.getElementById('vote-status');
const voteButtonsContainer = document.getElementById('vote-buttons-container');
const resultsDisplay = document.getElementById('results-display');

if (!token) {
    document.body.innerHTML = '<h2 style="color:red;">Ошибка: токен не указан</h2>';
    throw new Error('Токен не указан');
}

// Попытка входа
async function init() {
    try {
        const res = await fetch(`${BACKEND_URL}/api/session-state`, {
            headers: { 'Authorization': token }
        });
        const data = await res.json();
        if (!data.success) {
            alert('Неверный токен');
            return;
        }
        currentUser = data.user;
        userNameEl.textContent = `Депутат: ${currentUser.name}`;
        // Сохраняем токен в localStorage для перезагрузки
        localStorage.setItem('duma_token', token);
        // Инициализируем сокет
        initSocket(token);
        // Восстанавливаем состояние
        restoreState(data.state, data.voted);
    } catch (err) {
        console.error(err);
        alert('Ошибка подключения к серверу');
    }
}

function restoreState(state, voted) {
    hasVoted = voted || false;
    if (state.is_break) {
        breakStatusEl.textContent = '⏸️ ПЕРЕРЫВ';
    } else {
        breakStatusEl.textContent = '';
    }
    if (state.is_voting) {
        voteStatusEl.textContent = '🗳️ Идёт голосование';
        if (!hasVoted) {
            showVoteButtons();
        } else {
            voteStatusEl.textContent += ' (вы уже проголосовали)';
        }
    } else {
        voteStatusEl.textContent = 'Голосование не активно';
        hideVoteButtons();
    }
    timerEl.textContent = `⏱️ ${state.time_remaining || 0}`;
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
    fetch(`${BACKEND_URL}/api/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, vote })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            alert('Ваш голос учтён!');
            hasVoted = true;
            hideVoteButtons();
            voteStatusEl.textContent = '🗳️ Идёт голосование (вы уже проголосовали)';
        } else {
            alert(data.message);
        }
    })
    .catch(err => {
        console.error(err);
        alert('Ошибка при голосовании');
    });
}

function initSocket(token) {
    socket = io(BACKEND_URL);
    socket.on('connect', () => {
        console.log('Сокет подключен');
        // Отправляем join (без peerId, т.к. видео не нужно)
        socket.emit('join', { token, peerId: null });
    });

    socket.on('session-state', (data) => {
        currentUser = data.user;
        restoreState(data.state, false);
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
        voteStatusEl.textContent = 'Голосование закрыто';
        hideVoteButtons();
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

    socket.on('clear-all', () => {
        // Очистка
        resultsDisplay.innerHTML = '';
        timerEl.textContent = '⏱️ 0';
        voteStatusEl.textContent = '';
        breakStatusEl.textContent = '';
        hideVoteButtons();
        hasVoted = false;
    });

    socket.on('error', (msg) => {
        alert('Ошибка: ' + msg);
    });
}

// Запуск
init();
