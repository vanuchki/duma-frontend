// ============================================================
//  Фронтенд для симулятора "Государственная Дума"
//  ВЕРСИЯ 4.0 - МГНОВЕННОЕ ОБНОВЛЕНИЕ ДЛЯ ВСЕХ
// ============================================================

// ---------- КОНФИГУРАЦИЯ ----------
const BACKEND_URL = 'https://duma-backend-1.onrender.com';
const ADMIN_PASSWORD = 'duma2026';

// ---------- ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ----------
let socket = null;
let peer = null;
let myPeerId = null;
let currentToken = null;
let currentUser = null;
let isAdmin = false;
let myStream = null;
let isMuted = true;
let currentSpeakerId = null;
let currentTime = 0;
let timerInterval = null;
let peerConnections = {};
let activePeers = [];
let hasVoted = false;

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
const videoContainer = document.getElementById('video-container');
const centerVideo = document.getElementById('center-video');
const centerWrapper = document.getElementById('center-video-wrapper');
const centerLabel = document.getElementById('center-label');

// ============================================================
//  УПРАВЛЕНИЕ ТОКЕНОМ
// ============================================================

function getToken() {
    return localStorage.getItem('duma_token_' + window.location.host);
}

function saveToken(token) {
    localStorage.setItem('duma_token_' + window.location.host, token);
}

function clearToken() {
    localStorage.removeItem('duma_token_' + window.location.host);
}

// ============================================================
//  ВЫХОД
// ============================================================

function clearTokenAndReload() {
    clearToken();
    if (socket) { socket.disconnect(); socket = null; }
    if (peer) { peer.destroy(); peer = null; }
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

// ============================================================
//  АВТОРИЗАЦИЯ
// ============================================================

function showLoginForm() {
    const savedToken = getToken();
    if (savedToken) {
        attemptLogin(savedToken);
        return;
    }
    
    const input = prompt('Введите пароль председателя или токен депутата:');
    if (!input) return;

    if (input === ADMIN_PASSWORD) {
        isAdmin = true;
        currentToken = 'admin';
        currentUser = { name: 'Председатель', isAdmin: true };
        userInfo.textContent = 'Председатель';
        adminPanel.style.display = 'block';
        deputyInfo.style.display = 'none';
        fetchDeputies();
        initSocket('admin');
        initPeer('admin');
        addLogoutButton();
        return;
    }
    
    saveToken(input);
    attemptLogin(input);
}

function attemptLogin(token) {
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
        hasVoted = data.voted || false;
        
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
            startLocalStream();
            addLogoutButton();
        }
        initSocket(token);
        initPeer(token);
        
        // Восстанавливаем состояние
        if (data.state) {
            restoreState(data.state);
        }
    })
    .catch(err => {
        console.error('Ошибка входа:', err);
        alert('Ошибка: ' + err.message);
        clearToken();
        showLoginForm();
    });
}

// ============================================================
//  PEERJS (ВИДЕО)
// ============================================================

function initPeer(token) {
    const peerId = token === 'admin' ? 'admin' : 'deputy_' + token.replace(/-/g, '');
    myPeerId = peerId;
    
    peer = new Peer(peerId, {
        debug: 2,
        config: { 'iceServers': [{ 'urls': 'stun:stun.l.google.com:19302' }] }
    });
    
    peer.on('open', (id) => {
        console.log('✅ Peer открыт, id:', id);
        if (socket) {
            socket.emit('join', { token, peerId: id });
        }
    });
    
    peer.on('call', (call) => {
        if (myStream) {
            call.answer(myStream);
            call.on('stream', (remoteStream) => {
                addRemoteVideo(call.peer, remoteStream);
            });
        } else {
            console.warn('Нет локального потока для ответа');
        }
    });
    
    peer.on('error', (err) => {
        console.error('Peer error:', err);
    });
}

function startLocalStream() {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then(stream => {
            myStream = stream;
            stream.getAudioTracks().forEach(track => track.enabled = false);
            isMuted = true;
            addLocalVideo(stream);
            // Соединяемся с уже активными пирами
            setTimeout(() => {
                activePeers.forEach(peerId => {
                    if (peerId !== myPeerId && !peerConnections[peerId]) {
                        connectToPeer(peerId);
                    }
                });
            }, 1000);
            console.log('✅ Камера и микрофон включены');
        })
        .catch(err => {
            console.warn('⚠️ Нет доступа к камере/микрофону:', err);
        });
}

function connectToPeer(peerId) {
    if (peerId === myPeerId) return;
    if (peerConnections[peerId]) return;
    if (!myStream) return;
    
    const call = peer.call(peerId, myStream);
    call.on('stream', (remoteStream) => {
        addRemoteVideo(peerId, remoteStream);
    });
    call.on('close', () => {
        delete peerConnections[peerId];
        const videoEl = document.querySelector(`.video-item[data-peer="${peerId}"]`);
        if (videoEl) videoEl.remove();
    });
    peerConnections[peerId] = call;
}

function addLocalVideo(stream) {
    const wrapper = document.createElement('div');
    wrapper.className = 'video-item';
    wrapper.dataset.peer = myPeerId;
    wrapper.dataset.name = currentUser ? currentUser.name : 'Я';
    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;
    video.muted = true;
    wrapper.appendChild(video);
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = 'Вы';
    wrapper.appendChild(label);
    videoContainer.appendChild(wrapper);
}

function addRemoteVideo(peerId, stream) {
    let existing = document.querySelector(`.video-item[data-peer="${peerId}"]`);
    if (existing) {
        const video = existing.querySelector('video');
        if (video) video.srcObject = stream;
        return;
    }
    const wrapper = document.createElement('div');
    wrapper.className = 'video-item';
    wrapper.dataset.peer = peerId;
    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;
    wrapper.appendChild(video);
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = 'Депутат';
    wrapper.appendChild(label);
    videoContainer.appendChild(wrapper);
}

// ============================================================
//  ВОССТАНОВЛЕНИЕ СОСТОЯНИЯ
// ============================================================

function restoreState(state) {
    // Таймер
    currentTime = state.time_remaining || 0;
    timerDisplay.textContent = `⏱️ ${currentTime}`;
    
    // Перерыв
    if (state.is_break) {
        breakStatus.textContent = '⏸️ ПЕРЕРЫВ';
        document.body.style.background = '#1a237e';
    } else {
        breakStatus.textContent = '';
        document.body.style.background = '#1a1a2e';
    }
    
    // Голосование
    if (state.is_voting) {
        voteStatus.textContent = '🗳️ Идёт голосование';
        if (!isAdmin && !hasVoted) {
            showVoteButtons();
        }
    } else {
        voteStatus.textContent = '';
        hideVoteButtons();
    }
    
    // Спикер
    if (state.current_speaker_id) {
        currentSpeakerId = state.current_speaker_id;
        // Показываем центральное видео
        const speakerPeerId = getPeerIdByUserId(state.current_speaker_id);
        if (speakerPeerId) {
            showCenterVideo(speakerPeerId, state.speakerName || 'Выступающий');
        }
    } else {
        currentSpeakerId = null;
        centerWrapper.style.display = 'none';
    }
}

function getPeerIdByUserId(userId) {
    // Ищем в activePeers (получаем от сервера)
    // Пока заглушка
    return null;
}

function showCenterVideo(peerId, name) {
    // Находим видео этого пира
    const videoItem = document.querySelector(`.video-item[data-peer="${peerId}"]`);
    if (videoItem) {
        const video = videoItem.querySelector('video');
        if (video && video.srcObject) {
            centerVideo.srcObject = video.srcObject;
            centerWrapper.style.display = 'block';
            centerLabel.textContent = name;
        }
    } else if (peerId === myPeerId && myStream) {
        centerVideo.srcObject = myStream;
        centerWrapper.style.display = 'block';
        centerLabel.textContent = name;
    }
}

// ============================================================
//  ЗАГРУЗКА СПИСКА ДЕПУТАТОВ
// ============================================================

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
            try {
                new QRCode(document.getElementById(`qr-${dep.id}`), {
                    text: phoneUrl,
                    width: 60,
                    height: 60
                });
            } catch(e) {}
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

// ============================================================
//  ГОЛОСОВАНИЕ (ДЛЯ ДЕПУТАТОВ)
// ============================================================

function showVoteButtons() {
    const container = document.getElementById('vote-buttons');
    if (!container) {
        const div = document.createElement('div');
        div.id = 'vote-buttons';
        div.style.cssText = 'margin-top:10px;display:flex;gap:10px;flex-wrap:wrap;justify-content:center;';
        deputyInfo.appendChild(div);
    }
    const container2 = document.getElementById('vote-buttons');
    container2.innerHTML = '';
    const choices = [
        { label: 'ЗА', value: 'for', color: '#2e7d32' },
        { label: 'ПРОТИВ', value: 'against', color: '#c62828' },
        { label: 'ВОЗДЕРЖАЛСЯ', value: 'abstain', color: '#f9a825' }
    ];
    choices.forEach(choice => {
        const btn = document.createElement('button');
        btn.textContent = choice.label;
        btn.style.cssText = `
            flex:1;min-width:80px;padding:12px 0;border:none;border-radius:8px;
            font-weight:bold;font-size:1.1rem;cursor:pointer;
            background:${choice.color};color:${choice.value === 'abstain' ? '#000' : '#fff'};
        `;
        btn.addEventListener('click', () => {
            sendVote(choice.value);
        });
        container2.appendChild(btn);
    });
}

function hideVoteButtons() {
    const container = document.getElementById('vote-buttons');
    if (container) container.innerHTML = '';
}

function sendVote(vote) {
    const container = document.getElementById('vote-buttons');
    if (container) container.innerHTML = '<p style="color:#ffd700;">⏳ Отправка...</p>';
    
    fetch(`${BACKEND_URL}/api/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: currentToken, vote })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            hasVoted = true;
            hideVoteButtons();
            voteStatus.textContent = '🗳️ Вы проголосовали!';
        } else {
            alert('❌ ' + data.message);
            showVoteButtons();
        }
    })
    .catch(err => {
        console.error('Ошибка голосования:', err);
        alert('❌ Ошибка отправки голоса');
        showVoteButtons();
    });
}

// ============================================================
//  СОКЕТ (МГНОВЕННЫЕ ОБНОВЛЕНИЯ)
// ============================================================

function initSocket(token) {
    if (socket) { socket.disconnect(); socket = null; }
    
    socket = io(BACKEND_URL);
    
    socket.on('connect', () => {
        console.log('✅ Сокет подключен');
        socket.emit('join', { token, peerId: myPeerId || null });
    });
    
    // ---------- МГНОВЕННЫЕ СОБЫТИЯ ----------
    
    // 1. Таймер
    socket.on('timer-update', (data) => {
        currentTime = data.time;
        timerDisplay.textContent = `⏱️ ${data.time}`;
    });
    
    // 2. Смена выступающего
    socket.on('floor-changed', (data) => {
        currentSpeakerId = data.speakerId;
        if (data.speakerId) {
            timerDisplay.textContent = `⏱️ ${data.time || 0}`;
            // Показываем видео выступающего
            const speakerPeerId = data.peerId || getPeerIdByUserId(data.speakerId);
            if (speakerPeerId) {
                showCenterVideo(speakerPeerId, data.speakerName || 'Выступающий');
            }
            // Если говорим мы - включаем микрофон
            if (data.speakerId === currentUser?.id && myStream) {
                myStream.getAudioTracks().forEach(track => track.enabled = true);
                isMuted = false;
            }
        } else {
            centerWrapper.style.display = 'none';
            if (myStream) {
                myStream.getAudioTracks().forEach(track => track.enabled = false);
                isMuted = true;
            }
        }
    });
    
    // 3. Голосование началось
    socket.on('voting-started', () => {
        voteStatus.textContent = '🗳️ Идёт голосование!';
        if (!isAdmin && !hasVoted) {
            showVoteButtons();
        } else if (hasVoted) {
            voteStatus.textContent = '🗳️ Вы уже проголосовали';
        }
    });
    
    // 4. Голосование закрыто
    socket.on('voting-closed', () => {
        voteStatus.textContent = '🔒 Голосование закрыто';
        hideVoteButtons();
    });
    
    // 5. Результаты
    socket.on('results', (data) => {
        resultsDisplay.innerHTML = `
            <strong>ЗА</strong> — ${data.for} &nbsp;|&nbsp;
            <strong>ПРОТИВ</strong> — ${data.against} &nbsp;|&nbsp;
            <strong>ВОЗДЕРЖАЛСЯ</strong> — ${data.abstain}
        `;
        // Показываем результаты всем
        voteStatus.textContent = '📊 Результаты оглашены!';
    });
    
    // 6. Перерыв
    socket.on('break-started', () => {
        breakStatus.textContent = '⏸️ ПЕРЕРЫВ';
        document.body.style.background = '#1a237e';
        centerWrapper.style.display = 'none';
        if (myStream) {
            myStream.getAudioTracks().forEach(track => track.enabled = false);
            isMuted = true;
        }
    });
    
    // 7. Перерыв закончен
    socket.on('break-ended', () => {
        breakStatus.textContent = '';
        document.body.style.background = '#1a1a2e';
    });
    
    // 8. Список обновился
    socket.on('deputies-updated', (deputies) => {
        if (isAdmin) {
            renderDeputies(deputies);
            populateSpeakerSelect(deputies);
        }
    });
    
    // 9. Полная очистка
    socket.on('clear-all', () => {
        deputiesList.innerHTML = '';
        speakerSelect.innerHTML = '';
        resultsDisplay.innerHTML = '';
        timerDisplay.textContent = '⏱️ 0';
        voteStatus.textContent = '';
        breakStatus.textContent = '';
        centerWrapper.style.display = 'none';
        hideVoteButtons();
        hasVoted = false;
        if (isAdmin) fetchDeputies();
    });
    
    // 10. Активные пиры (для видео)
    socket.on('active-peers', (peers) => {
        activePeers = peers;
        peers.forEach(peerId => {
            if (peerId !== myPeerId && !peerConnections[peerId] && myStream) {
                connectToPeer(peerId);
            }
        });
        // Удаляем старые соединения
        for (let id in peerConnections) {
            if (!peers.includes(id) && id !== myPeerId) {
                if (peerConnections[id]) {
                    peerConnections[id].close();
                }
                delete peerConnections[id];
                const videoEl = document.querySelector(`.video-item[data-peer="${id}"]`);
                if (videoEl) videoEl.remove();
            }
        }
    });
    
    socket.on('error', (msg) => {
        console.error('Ошибка сокета:', msg);
    });
}

// ============================================================
//  АДМИНИСТРАТИВНЫЕ ДЕЙСТВИЯ (ЧЕРЕЗ СОКЕТ)
// ============================================================

function adminAction(action, payload = {}) {
    if (!isAdmin) {
        alert('Только председатель может выполнять это действие');
        return;
    }
    socket.emit('admin-action', {
        action,
        payload,
        adminPassword: ADMIN_PASSWORD
    });
}

// ============================================================
//  ИНИЦИАЛИЗАЦИЯ
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    const savedToken = getToken();
    if (savedToken) {
        attemptLogin(savedToken);
    } else {
        showLoginForm();
    }
    
    // ---------- НАСТРОЙКА КНОПОК ----------
    
    // Создать депутата
    const createBtn = document.getElementById('create-deputy-btn');
    if (createBtn) {
        createBtn.addEventListener('click', () => {
            const name = deputyNameInput.value.trim();
            if (!name) return alert('Введите имя');
            fetch(`${BACKEND_URL}/api/create-deputy`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, adminPassword: ADMIN_PASSWORD })
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
    
    // Дать слово
    const giveBtn = document.getElementById('give-floor-btn');
    if (giveBtn) {
        giveBtn.addEventListener('click', () => {
            const userId = speakerSelect.value;
            if (!userId) return alert('Выберите депутата');
            let seconds = parseInt(customTime.value) || 60;
            adminAction('give-floor', { userId, seconds });
        });
    }
    
    // Лишить слова
    const revokeBtn = document.getElementById('revoke-floor-btn');
    if (revokeBtn) {
        revokeBtn.addEventListener('click', () => {
            adminAction('revoke-floor');
        });
    }
    
    // Пресеты времени
    document.querySelectorAll('.preset-buttons button').forEach(btn => {
        btn.addEventListener('click', () => {
            customTime.value = btn.dataset.seconds;
        });
    });
    
    // Голосование
    const startVoteBtn = document.getElementById('start-voting-btn');
    if (startVoteBtn) {
        startVoteBtn.addEventListener('click', () => {
            adminAction('start-voting');
        });
    }
    
    const closeVoteBtn = document.getElementById('close-voting-btn');
    if (closeVoteBtn) {
        closeVoteBtn.addEventListener('click', () => {
            adminAction('close-voting');
        });
    }
    
    const announceBtn = document.getElementById('announce-results-btn');
    if (announceBtn) {
        announceBtn.addEventListener('click', () => {
            adminAction('announce-results');
        });
    }
    
    // Перерыв
    const breakBtn = document.getElementById('break-btn');
    if (breakBtn) {
        breakBtn.addEventListener('click', () => {
            adminAction('set-break');
        });
    }
    
    const endBreakBtn = document.getElementById('end-break-btn');
    if (endBreakBtn) {
        endBreakBtn.addEventListener('click', () => {
            adminAction('end-break');
        });
    }
    
    // Очистка
    const clearBtn = document.getElementById('clear-all-btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (confirm('Вы уверены, что хотите очистить всё?')) {
                adminAction('clear-all');
            }
        });
    }
    
    console.log('🏛️ Симулятор Госдумы загружен');
});

// ============================================================
//  ДЕБАГ
// ============================================================

window.showState = function() {
    console.log('Текущий пользователь:', currentUser);
    console.log('Админ:', isAdmin);
    console.log('Токен:', getToken());
    console.log('Спикер:', currentSpeakerId);
    console.log('Время:', currentTime);
};
