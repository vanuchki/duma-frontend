// ============================================================
//  Фронтенд для симулятора "Государственная Дума"
//  ВЕРСИЯ 6.0 - ИСПРАВЛЕННАЯ АВТОРИЗАЦИЯ
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
const logoutBtn = document.getElementById('logout-btn');
const adminPanel = document.getElementById('admin-panel');
const deputyInfo = document.getElementById('deputy-info');
const deputyNameDisplay = document.getElementById('deputy-name-display');
const timerDisplay = document.getElementById('timer-display');
const timerDisplayDeputy = document.getElementById('timer-display-deputy');
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

function showLogoutButton() {
    if (logoutBtn) {
        logoutBtn.style.display = 'inline-block';
        logoutBtn.onclick = logout;
    }
}

// ============================================================
//  АВТОРИЗАЦИЯ (ИСПРАВЛЕННАЯ!)
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
        showLogoutButton();
        fetchDeputies();
        initSocket('admin');
        initPeer('admin');
        return;
    }
    
    saveToken(input);
    attemptLogin(input);
}

// ГЛАВНОЕ ИСПРАВЛЕНИЕ ЗДЕСЬ — ПРАВИЛЬНАЯ ПЕРЕДАЧА ТОКЕНА
function attemptLogin(token) {
    userInfo.textContent = 'Загрузка...';
    
    fetch(`${BACKEND_URL}/api/session-state`, {
        method: 'GET',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': token  // ТОКЕН ПЕРЕДАЁТСЯ В ЗАГОЛОВКЕ
        }
    })
    .then(res => {
        if (!res.ok) {
            if (res.status === 401) {
                clearToken();
                throw new Error('Неверный токен');
            }
            throw new Error('Ошибка сервера: ' + res.status);
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
        showLogoutButton();
        
        if (isAdmin) {
            adminPanel.style.display = 'block';
            deputyInfo.style.display = 'none';
            fetchDeputies();
        } else {
            adminPanel.style.display = 'none';
            deputyInfo.style.display = 'block';
            setTimeout(startLocalStream, 1000);
        }
        initSocket(token);
        initPeer(token);
        
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
    
    if (peer) { peer.destroy(); peer = null; }
    
    peer = new Peer(peerId, {
        debug: 2,
        config: { 'iceServers': [{ 'urls': 'stun:stun.l.google.com:19302' }] }
    });
    
    peer.on('open', (id) => {
        console.log('✅ Peer открыт, id:', id);
        if (socket && socket.connected) {
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
    if (myStream) return;
    
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then(stream => {
            myStream = stream;
            stream.getAudioTracks().forEach(track => track.enabled = false);
            isMuted = true;
            addLocalVideo(stream);
            
            setTimeout(() => {
                activePeers.forEach(peerId => {
                    if (peerId !== myPeerId && !peerConnections[peerId]) {
                        connectToPeer(peerId);
                    }
                });
            }, 1500);
            
            console.log('✅ Камера и микрофон включены');
        })
        .catch(err => {
            console.warn('⚠️ Нет доступа к камере/микрофону:', err);
            alert('⚠️ Для работы видео нужен доступ к камере и микрофону. Разрешите в настройках браузера.');
        });
}

function connectToPeer(peerId) {
    if (peerId === myPeerId) return;
    if (peerConnections[peerId]) return;
    if (!myStream) return;
    if (!peer) return;
    
    try {
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
    } catch(e) {
        console.warn('Не удалось соединиться с peer:', peerId);
    }
}

function addLocalVideo(stream) {
    const oldLocal = document.querySelector('.video-item.local');
    if (oldLocal) oldLocal.remove();
    
    const wrapper = document.createElement('div');
    wrapper.className = 'video-item local';
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
    currentTime = state.time_remaining || 0;
    updateTimerDisplay(currentTime);
    
    if (state.is_break) {
        breakStatus.textContent = '⏸️ ПЕРЕРЫВ';
        document.body.style.background = '#0a0a2a';
        if (centerWrapper) centerWrapper.style.display = 'none';
        if (myStream) {
            myStream.getAudioTracks().forEach(track => track.enabled = false);
            isMuted = true;
        }
    } else {
        breakStatus.textContent = '';
        document.body.style.background = '';
    }
    
    if (state.is_voting) {
        voteStatus.textContent = '🗳️ Идёт голосование';
        if (!isAdmin && !hasVoted) {
            showVoteButtons();
        } else if (hasVoted) {
            voteStatus.textContent = '🗳️ Вы уже проголосовали';
        }
    } else {
        voteStatus.textContent = '';
        hideVoteButtons();
    }
    
    if (state.current_speaker_id) {
        currentSpeakerId = state.current_speaker_id;
        if (state.speakerName) {
            centerLabel.textContent = state.speakerName;
        }
        showCenterVideoForSpeaker(state.current_speaker_id);
    } else {
        currentSpeakerId = null;
        centerWrapper.style.display = 'none';
    }
}

function updateTimerDisplay(time) {
    currentTime = time;
    if (timerDisplay) timerDisplay.textContent = `⏱️ ${time}`;
    if (timerDisplayDeputy) timerDisplayDeputy.textContent = `⏱️ ${time}`;
}

function showCenterVideoForSpeaker(speakerId) {
    let found = false;
    const videoItems = document.querySelectorAll('.video-item');
    videoItems.forEach(item => {
        const peerId = item.dataset.peer;
        if (peerId && peerId.includes(speakerId.toString())) {
            const video = item.querySelector('video');
            if (video && video.srcObject) {
                centerVideo.srcObject = video.srcObject;
                centerWrapper.style.display = 'block';
                found = true;
            }
        }
    });
    
    if (!found && speakerId === currentUser?.id && myStream) {
        centerVideo.srcObject = myStream;
        centerWrapper.style.display = 'block';
        centerLabel.textContent = 'Вы (выступаете)';
    }
    
    if (!found) {
        centerWrapper.style.display = 'none';
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
    if (!deputiesList) return;
    deputiesList.innerHTML = '';
    deputies.forEach(dep => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span>${dep.name}</span>
            <span style="font-size:0.7rem;color:#8899bb;">${dep.token.substring(0, 12)}...</span>
            <div class="qr-code" id="qr-${dep.id}"></div>
        `;
        deputiesList.appendChild(li);
        const phoneUrl = `${window.location.origin}/phone.html?token=${dep.token}`;
        if (typeof QRCode !== 'undefined') {
            try {
                new QRCode(document.getElementById(`qr-${dep.id}`), {
                    text: phoneUrl,
                    width: 50,
                    height: 50
                });
            } catch(e) {}
        }
    });
}

function populateSpeakerSelect(deputies) {
    if (!speakerSelect) return;
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
    let container = document.getElementById('vote-buttons');
    if (!container) {
        container = document.createElement('div');
        container.id = 'vote-buttons';
        container.className = 'vote-buttons';
        if (deputyInfo) deputyInfo.appendChild(container);
    }
    container.innerHTML = '';
    const choices = [
        { label: 'ЗА', value: 'for', color: '#2e7d32' },
        { label: 'ПРОТИВ', value: 'against', color: '#c62828' },
        { label: 'ВОЗДЕРЖАЛСЯ', value: 'abstain', color: '#f9a825' }
    ];
    choices.forEach(choice => {
        const btn = document.createElement('button');
        btn.textContent = choice.label;
        btn.style.cssText = `
            background: ${choice.color};
            color: ${choice.value === 'abstain' ? '#000' : '#fff'};
            padding: 12px 20px;
            border: none;
            border-radius: 8px;
            font-size: 16px;
            font-weight: bold;
            cursor: pointer;
            flex: 1;
            min-width: 80px;
        `;
        btn.onclick = () => sendVote(choice.value);
        container.appendChild(btn);
    });
}

function hideVoteButtons() {
    const container = document.getElementById('vote-buttons');
    if (container) container.innerHTML = '';
}

function sendVote(vote) {
    const container = document.getElementById('vote-buttons');
    if (container) container.innerHTML = '<p style="color:#ffd93d;">⏳ Отправка...</p>';
    
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
            voteStatus.textContent = '✅ Вы проголосовали!';
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
//  СОКЕТ
// ============================================================

function initSocket(token) {
    if (socket) { socket.disconnect(); socket = null; }
    
    socket = io(BACKEND_URL);
    
    socket.on('connect', () => {
        console.log('✅ Сокет подключен');
        if (myPeerId) {
            socket.emit('join', { token, peerId: myPeerId });
        } else {
            socket.emit('join', { token, peerId: null });
        }
    });
    
    socket.on('timer-update', (data) => {
        updateTimerDisplay(data.time);
    });
    
    socket.on('floor-changed', (data) => {
        currentSpeakerId = data.speakerId;
        if (data.speakerId) {
            updateTimerDisplay(data.time || 0);
            centerLabel.textContent = data.speakerName || 'Выступающий';
            if (data.peerId) {
                const videoItems = document.querySelectorAll('.video-item');
                let found = false;
                videoItems.forEach(item => {
                    if (item.dataset.peer === data.peerId) {
                        const video = item.querySelector('video');
                        if (video && video.srcObject) {
                            centerVideo.srcObject = video.srcObject;
                            centerWrapper.style.display = 'block';
                            found = true;
                        }
                    }
                });
                if (!found && data.peerId === myPeerId && myStream) {
                    centerVideo.srcObject = myStream;
                    centerWrapper.style.display = 'block';
                    centerLabel.textContent = 'Вы (выступаете)';
                    myStream.getAudioTracks().forEach(track => track.enabled = true);
                    isMuted = false;
                }
            }
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
    
    socket.on('voting-started', () => {
        voteStatus.textContent = '🗳️ Идёт голосование!';
        if (!isAdmin && !hasVoted) {
            showVoteButtons();
        } else if (hasVoted) {
            voteStatus.textContent = '🗳️ Вы уже проголосовали';
        }
    });
    
    socket.on('voting-closed', () => {
        voteStatus.textContent = '🔒 Голосование закрыто';
        hideVoteButtons();
    });
    
    socket.on('vote-count', (data) => {
        if (voteStatus) {
            voteStatus.textContent = `🗳️ Проголосовало: ${data.total}`;
        }
    });
    
    socket.on('results', (data) => {
        if (resultsDisplay) {
            resultsDisplay.innerHTML = `
                <strong>ЗА</strong> — ${data.for || 0} &nbsp;|&nbsp;
                <strong>ПРОТИВ</strong> — ${data.against || 0} &nbsp;|&nbsp;
                <strong>ВОЗДЕРЖАЛСЯ</strong> — ${data.abstain || 0}
            `;
        }
        voteStatus.textContent = '📊 Результаты оглашены!';
    });
    
    socket.on('break-started', () => {
        breakStatus.textContent = '⏸️ ПЕРЕРЫВ';
        document.body.style.background = '#0a0a2a';
        centerWrapper.style.display = 'none';
        if (myStream) {
            myStream.getAudioTracks().forEach(track => track.enabled = false);
            isMuted = true;
        }
    });
    
    socket.on('break-ended', () => {
        breakStatus.textContent = '';
        document.body.style.background = '';
    });
    
    socket.on('deputies-updated', (deputies) => {
        if (isAdmin && deputiesList) {
            renderDeputies(deputies);
            populateSpeakerSelect(deputies);
        }
    });
    
    socket.on('clear-all', () => {
        if (deputiesList) deputiesList.innerHTML = '';
        if (speakerSelect) speakerSelect.innerHTML = '';
        if (resultsDisplay) resultsDisplay.innerHTML = '';
        updateTimerDisplay(0);
        if (voteStatus) voteStatus.textContent = '';
        if (breakStatus) breakStatus.textContent = '';
        centerWrapper.style.display = 'none';
        hideVoteButtons();
        hasVoted = false;
        if (isAdmin) fetchDeputies();
    });
    
    socket.on('active-peers', (peers) => {
        activePeers = peers || [];
        if (myStream) {
            peers.forEach(peerId => {
                if (peerId !== myPeerId && !peerConnections[peerId]) {
                    connectToPeer(peerId);
                }
            });
        }
        for (let id in peerConnections) {
            if (!peers.includes(id) && id !== myPeerId) {
                if (peerConnections[id]) {
                    try { peerConnections[id].close(); } catch(e) {}
                }
                delete peerConnections[id];
                const videoEl = document.querySelector(`.video-item[data-peer="${id}"]`);
                if (videoEl) videoEl.remove();
            }
        }
    });
    
    socket.on('error', (msg) => {
        console.error('Ошибка сокета:', msg);
        alert('Ошибка: ' + msg);
    });
}

// ============================================================
//  АДМИНИСТРАТИВНЫЕ ДЕЙСТВИЯ
// ============================================================

function adminAction(action, payload = {}) {
    if (!isAdmin) {
        alert('Только председатель может выполнять это действие');
        return;
    }
    if (!socket || !socket.connected) {
        alert('Нет соединения с сервером');
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
    
    const createBtn = document.getElementById('create-deputy-btn');
    if (createBtn) {
        createBtn.onclick = () => {
            const name = deputyNameInput ? deputyNameInput.value.trim() : '';
            if (!name) return alert('Введите имя депутата');
            fetch(`${BACKEND_URL}/api/create-deputy`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, adminPassword: ADMIN_PASSWORD })
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    if (deputyNameInput) deputyNameInput.value = '';
                    fetchDeputies();
                } else {
                    alert(data.message || 'Ошибка создания');
                }
            })
            .catch(err => {
                console.error(err);
                alert('Ошибка: ' + err.message);
            });
        };
    }
    
    const giveBtn = document.getElementById('give-floor-btn');
    if (giveBtn) {
        giveBtn.onclick = () => {
            const userId = speakerSelect ? speakerSelect.value : '';
            if (!userId) return alert('Выберите депутата');
            let seconds = parseInt(customTime ? customTime.value : 60);
            if (isNaN(seconds) || seconds <= 0) seconds = 60;
            adminAction('give-floor', { userId, seconds });
        };
    }
    
    const revokeBtn = document.getElementById('revoke-floor-btn');
    if (revokeBtn) {
        revokeBtn.onclick = () => {
            adminAction('revoke-floor');
        };
    }
    
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.onclick = () => {
            if (customTime) customTime.value = btn.dataset.seconds;
        };
    });
    
    const startVoteBtn = document.getElementById('start-voting-btn');
    if (startVoteBtn) {
        startVoteBtn.onclick = () => {
            adminAction('start-voting');
        };
    }
    
    const closeVoteBtn = document.getElementById('close-voting-btn');
    if (closeVoteBtn) {
        closeVoteBtn.onclick = () => {
            adminAction('close-voting');
        };
    }
    
    const announceBtn = document.getElementById('announce-results-btn');
    if (announceBtn) {
        announceBtn.onclick = () => {
            adminAction('announce-results');
        };
    }
    
    const breakBtn = document.getElementById('break-btn');
    if (breakBtn) {
        breakBtn.onclick = () => {
            adminAction('set-break');
        };
    }
    
    const endBreakBtn = document.getElementById('end-break-btn');
    if (endBreakBtn) {
        endBreakBtn.onclick = () => {
            adminAction('end-break');
        };
    }
    
    const clearBtn = document.getElementById('clear-all-btn');
    if (clearBtn) {
        clearBtn.onclick = () => {
            if (confirm('Вы уверены, что хотите очистить всё?')) {
                adminAction('clear-all');
            }
        };
    }
    
    console.log('🏛️ Симулятор Госдумы загружен');
    console.log('📌 Для дебага: window.showState()');
});

// ============================================================
//  ДЕБАГ
// ============================================================

window.showState = function() {
    console.log('=== СОСТОЯНИЕ СИСТЕМЫ ===');
    console.log('Пользователь:', currentUser);
    console.log('Админ:', isAdmin);
    console.log('Токен:', getToken());
    console.log('Спикер ID:', currentSpeakerId);
    console.log('Время:', currentTime);
    console.log('Сокет:', socket ? 'подключен' : 'отключен');
    console.log('Peer:', peer ? 'активен' : 'неактивен');
    console.log('Поток:', myStream ? 'есть' : 'нет');
    console.log('Активные пиры:', activePeers);
};

window.forceReconnect = function() {
    if (socket) {
        socket.disconnect();
        socket.connect();
        console.log('🔄 Переподключение...');
    }
};
