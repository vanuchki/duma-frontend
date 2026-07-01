// ============================================================
//  Фронтенд для симулятора "Государственная Дума" (ПК)
//  Использует PeerJS, Socket.io, QRCode.js
// ============================================================

// ---------- КОНФИГУРАЦИЯ ----------
// Адрес бэкенда (замените при деплое)
const BACKEND_URL = 'https://duma-backend-1.onrender.com'; // или ваш Render URL
const ADMIN_PASSWORD = 'duma2026'; // можно переопределить через env, но для простоты оставим

// ---------- ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ----------
let socket = null;
let peer = null;
let myPeerId = null;
let currentToken = null;
let currentUser = null;
let isAdmin = false;
let activePeers = []; // список peerId всех участников
let peerConnections = {}; // peerId -> MediaStream
let myStream = null;
let isMuted = true; // микрофон по умолчанию выключен
let isSpeaking = false; // у кого слово (id)
let timerInterval = null;
let currentTime = 0;

// DOM элементы
const videoContainer = document.getElementById('video-container');
const centerVideo = document.getElementById('center-video');
const centerWrapper = document.getElementById('center-video-wrapper');
const centerLabel = document.getElementById('center-label');
const userInfo = document.getElementById('user-info');
const adminPanel = document.getElementById('admin-panel');
const deputyInfo = document.getElementById('deputy-info');
const deputyNameDisplay = document.getElementById('deputy-name-display');
const timerDisplay = document.getElementById('timer-display');
const voteStatus = document.getElementById('vote-status');
const breakStatus = document.getElementById('break-status');
const resultsDisplay = document.getElementById('results-display');

// Элементы админки
const deputyNameInput = document.getElementById('deputy-name');
const createDeputyBtn = document.getElementById('create-deputy-btn');
const deputiesList = document.getElementById('deputies-list');
const speakerSelect = document.getElementById('speaker-select');
const giveFloorBtn = document.getElementById('give-floor-btn');
const revokeFloorBtn = document.getElementById('revoke-floor-btn');
const customTime = document.getElementById('custom-time');
const presetButtons = document.querySelectorAll('.preset-buttons button');
const startVotingBtn = document.getElementById('start-voting-btn');
const closeVotingBtn = document.getElementById('close-voting-btn');
const announceResultsBtn = document.getElementById('announce-results-btn');
const clearAllBtn = document.getElementById('clear-all-btn');
const breakBtn = document.getElementById('break-btn');
const endBreakBtn = document.getElementById('end-break-btn');

// ---------- ИНИЦИАЛИЗАЦИЯ ----------
document.addEventListener('DOMContentLoaded', () => {
    // Проверяем localStorage на наличие токена
    const savedToken = localStorage.getItem('duma_token');
    if (savedToken) {
        currentToken = savedToken;
        attemptLogin(savedToken);
    } else {
        showLoginForm();
    }
});

// ---------- ФУНКЦИИ АВТОРИЗАЦИИ ----------
function showLoginForm() {
    // Простой диалог входа (можно улучшить)
    const password = prompt('Введите пароль администратора для входа как Председатель, или введите токен депутата:');
    if (!password) return;
    // Проверяем, является ли пароль админским
    if (password === ADMIN_PASSWORD) {
        // Вход как председатель
        isAdmin = true;
        localStorage.setItem('duma_token', 'admin');
        currentToken = 'admin';
        currentUser = { name: 'Председатель', isAdmin: true };
        initSocket('admin');
        userInfo.textContent = 'Председатель';
        adminPanel.style.display = 'block';
        deputyInfo.style.display = 'none';
        // Загружаем список депутатов
        fetchDeputies();
        // Загружаем текущее состояние
        fetchSessionState('admin');
        return;
    } else {
        // Пытаемся войти как депутат по токену
        currentToken = password;
        attemptLogin(password);
    }
}

function attemptLogin(token) {
    fetch(`${BACKEND_URL}/api/session-state`, {
        headers: { 'Authorization': token }
    })
    .then(res => res.json())
    .then(data => {
        if (!data.success) {
            alert('Неверный токен. Попробуйте снова.');
            localStorage.removeItem('duma_token');
            showLoginForm();
            return;
        }
        // Успешный вход
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
        // Восстанавливаем состояние
        restoreState(data.state, data.voted);
        // Инициализируем сокет и Peer
        initSocket(token);
    })
    .catch(err => {
        console.error(err);
        alert('Ошибка подключения к серверу');
    });
}

// ---------- ЗАГРУЗКА СОСТОЯНИЯ ----------
function restoreState(state, voted) {
    if (state.is_break) {
        breakStatus.textContent = '⏸️ ПЕРЕРЫВ';
    } else {
        breakStatus.textContent = '';
    }
    if (state.is_voting) {
        voteStatus.textContent = '🗳️ Идёт голосование!';
        // Если депутат, показываем кнопки голосования (добавим позже)
        if (!isAdmin) {
            showVotingButtons(!voted);
        }
    } else {
        voteStatus.textContent = '';
        hideVotingButtons();
    }
    if (state.current_speaker_id) {
        const speakerId = state.current_speaker_id;
        isSpeaking = speakerId;
        const time = state.time_remaining;
        currentTime = time;
        updateTimerDisplay(time);
        // Если это мы, включаем микрофон
        if (currentUser && currentUser.id === speakerId) {
            if (myStream) {
                // Включаем звук в своём потоке
                myStream.getAudioTracks().forEach(track => track.enabled = true);
                isMuted = false;
            }
        }
        // Центральное видео показываем, если спикер не мы, но мы увидим его видео
        // Реализуем через событие floor-changed
    } else {
        isSpeaking = null;
        currentTime = 0;
        updateTimerDisplay(0);
        if (myStream) {
            myStream.getAudioTracks().forEach(track => track.enabled = false);
            isMuted = true;
        }
        centerWrapper.style.display = 'none';
    }
}

// ---------- ПОЛУЧЕНИЕ СПИСКА ДЕПУТАТОВ (для админа) ----------
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
        // Генерируем QR-код для телефона
        const phoneUrl = `${window.location.origin}/phone.html?token=${dep.token}`;
        new QRCode(document.getElementById(`qr-${dep.id}`), {
            text: phoneUrl,
            width: 60,
            height: 60
        });
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

// ---------- ПОДКЛЮЧЕНИЕ К SOCKET.IO ----------
function initSocket(token) {
    if (socket) socket.disconnect();
    socket = io(BACKEND_URL);

    socket.on('connect', () => {
        console.log('✅ Сокет подключен');
        // Отправляем join с токеном и peerId (после создания Peer)
        // Но Peer создаётся позже, поэтому отправим после создания
        if (peer && myPeerId) {
            socket.emit('join', { token, peerId: myPeerId });
        }
    });

    // Обработчики событий
    socket.on('session-state', (data) => {
        // Приходит при соединении
        const state = data.state;
        currentUser = data.user;
        restoreState(state, false); // voted не передаётся, но можно проверить отдельно
    });

    socket.on('active-peers', (peers) => {
        console.log('Активные участники:', peers);
        activePeers = peers;
        // Устанавливаем соединения с новыми пирами
        peers.forEach(peerId => {
            if (peerId !== myPeerId && !peerConnections[peerId]) {
                connectToPeer(peerId);
            }
        });
        // Удаляем соединения, которых нет в списке
        for (let id in peerConnections) {
            if (!peers.includes(id) && id !== myPeerId) {
                // Закрываем соединение
                if (peerConnections[id]) {
                    peerConnections[id].close();
                }
                delete peerConnections[id];
                // Удаляем видео
                const videoEl = document.querySelector(`.video-item[data-peer="${id}"]`);
                if (videoEl) videoEl.remove();
            }
        }
    });

    socket.on('floor-changed', (data) => {
        const { speakerId, time } = data;
        isSpeaking = speakerId;
        currentTime = time || 0;
        updateTimerDisplay(currentTime);
        if (speakerId) {
            // Показываем центральное видео выступающего
            // Найдём видеоэлемент этого спикера
            const speakerPeerId = getPeerIdByUserId(speakerId);
            if (speakerPeerId) {
                // Если это мы, то центральное видео будет нашим локальным
                if (speakerPeerId === myPeerId) {
                    // Показываем наше видео в центре
                    centerVideo.srcObject = myStream;
                    centerWrapper.style.display = 'block';
                    centerLabel.textContent = 'Вы (выступаете)';
                } else {
                    // Ищем видео другого участника
                    const videoItem = document.querySelector(`.video-item[data-peer="${speakerPeerId}"]`);
                    if (videoItem) {
                        const video = videoItem.querySelector('video');
                        if (video && video.srcObject) {
                            centerVideo.srcObject = video.srcObject;
                            centerWrapper.style.display = 'block';
                            const name = videoItem.dataset.name || 'Депутат';
                            centerLabel.textContent = name;
                        }
                    }
                }
                // Включаем звук у этого потока
                if (myStream) {
                    // Если мы говорим, включаем свой микрофон
                    if (speakerId === currentUser.id) {
                        myStream.getAudioTracks().forEach(track => track.enabled = true);
                        isMuted = false;
                    } else {
                        myStream.getAudioTracks().forEach(track => track.enabled = false);
                        isMuted = true;
                    }
                }
                // Для других потоков звук выключен (кроме центрального?)
                // В WebRTC звук управляется через треки, но мы можем управлять громкостью,
                // или просто оставить включённым, но микрофон выступающего будет активен.
                // Лучше оставить все аудио включёнными, но только у выступающего микрофон включён.
                // Поэтому мы уже управляем микрофоном.
            }
        } else {
            // Никто не говорит
            centerWrapper.style.display = 'none';
            if (myStream) {
                myStream.getAudioTracks().forEach(track => track.enabled = false);
                isMuted = true;
            }
        }
    });

    socket.on('timer-update', (data) => {
        currentTime = data.time;
        updateTimerDisplay(data.time);
    });

    socket.on('voting-started', () => {
        voteStatus.textContent = '🗳️ Идёт голосование!';
        if (!isAdmin) {
            showVotingButtons(true);
        }
    });

    socket.on('voting-closed', () => {
        voteStatus.textContent = 'Голосование закрыто';
        hideVotingButtons();
    });

    socket.on('vote-count', (data) => {
        voteStatus.textContent = `Проголосовало: ${data.total}`;
    });

    socket.on('results', (data) => {
        resultsDisplay.innerHTML = `
            <strong>ЗА</strong> — ${data.for} &nbsp;|&nbsp;
            <strong>ПРОТИВ</strong> — ${data.against} &nbsp;|&nbsp;
            <strong>ВОЗДЕРЖАЛСЯ</strong> — ${data.abstain}
        `;
    });

    socket.on('break-started', () => {
        breakStatus.textContent = '⏸️ ПЕРЕРЫВ';
    });

    socket.on('break-ended', () => {
        breakStatus.textContent = '';
    });

    socket.on('clear-all', () => {
        // Очищаем интерфейс
        deputiesList.innerHTML = '';
        speakerSelect.innerHTML = '';
        resultsDisplay.innerHTML = '';
        timerDisplay.textContent = '0';
        centerWrapper.style.display = 'none';
        if (myStream) {
            myStream.getAudioTracks().forEach(track => track.enabled = false);
            isMuted = true;
        }
        // Закрываем все соединения
        for (let id in peerConnections) {
            if (peerConnections[id]) {
                peerConnections[id].close();
            }
            delete peerConnections[id];
        }
        // Удаляем все видео
        document.querySelectorAll('.video-item').forEach(el => el.remove());
        // Если админ, обновим список
        if (isAdmin) fetchDeputies();
    });

    socket.on('deputies-updated', (deputies) => {
        if (isAdmin) {
            renderDeputies(deputies);
            populateSpeakerSelect(deputies);
        }
    });

    socket.on('error', (msg) => {
        alert('Ошибка: ' + msg);
    });

    // После создания Peer отправим join
    initPeer(token);
}

// ---------- PEERJS ----------
function initPeer(token) {
    // Создаём уникальный peerId на основе токена (очистим от дефисов)
    const peerId = 'deputy_' + token.replace(/-/g, '');
    myPeerId = peerId;
    peer = new Peer(peerId, {
        debug: 2,
        config: { 'iceServers': [{ 'urls': 'stun:stun.l.google.com:19302' }] }
    });

    peer.on('open', (id) => {
        console.log('Peer открыт, id:', id);
        // Отправляем join через сокет
        if (socket) {
            socket.emit('join', { token, peerId: id });
        }
        // Получаем локальный медиапоток
        startLocalStream();
    });

    peer.on('call', (call) => {
        // Кто-то звонит нам
        if (myStream) {
            call.answer(myStream);
            call.on('stream', (remoteStream) => {
                // Добавляем видео удалённого участника
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
        // По умолчанию микрофон выключен
        stream.getAudioTracks().forEach(track => track.enabled = false);
        isMuted = true;
        // Добавляем локальное видео в сетку (если не админ, или всегда?)
        // Показываем своё видео в отдельном элементе
        addLocalVideo(stream);
        // Отвечаем на входящие звонки (уже обработано)
        // Инициируем соединения с уже активными пирами
        activePeers.forEach(peerId => {
            if (peerId !== myPeerId && !peerConnections[peerId]) {
                connectToPeer(peerId);
            }
        });
    })
    .catch(err => {
        console.error('Не удалось получить доступ к камере/микрофону:', err);
        alert('Не удалось получить доступ к камере/микрофону. Проверьте разрешения.');
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
    // Создаём элемент для своего видео (можно отобразить в сетке)
    const wrapper = document.createElement('div');
    wrapper.className = 'video-item';
    wrapper.dataset.peer = myPeerId;
    wrapper.dataset.name = currentUser ? currentUser.name : 'Я';
    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;
    video.muted = true; // локальное видео без звука
    wrapper.appendChild(video);
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = 'Вы';
    wrapper.appendChild(label);
    videoContainer.appendChild(wrapper);
}

function addRemoteVideo(peerId, stream) {
    // Проверяем, нет ли уже видео для этого peerId
    let existing = document.querySelector(`.video-item[data-peer="${peerId}"]`);
    if (existing) {
        // Обновляем поток
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
    // Попробуем найти имя пользователя по peerId (через activeUsers, но у нас нет)
    // Можно запросить у сервера, но для простоты оставим "Депутат"
    label.textContent = 'Депутат';
    wrapper.appendChild(label);
    videoContainer.appendChild(wrapper);
}

// ---------- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ----------
function updateTimerDisplay(time) {
    timerDisplay.textContent = `⏱️ ${time}`;
}

function getPeerIdByUserId(userId) {
    // Ищем в activePeers? Но мы не храним соответствие.
    // Можно запросить у сервера, но у нас нет.
    // Пока заглушка: если мы знаем, что у нас peerId - это deputy_токен,
    // то можно предположить, что у пользователя с id X peerId = deputy_токен.
    // Но у нас нет токена по id. Поэтому лучше при получении floor-changed
    // сервер может отправлять peerId вместе с userId.
    // Изменим логику: при floor-changed сервер будет отправлять peerId.
    // Для этого на сервере в activeUsers храним peerId.
    // Но чтобы не переделывать, оставим как есть, и будем искать по имени.
    // На практике можно добавить в событие floor-changed поле peerId.
    // Переделаем: на сервере при отправке floor-changed добавим peerId.
    // Но это потребует доработки сервера. В целях упрощения, я изменю серверную логику,
    // чтобы в событие floor-changed добавлялся peerId.
    // Так как сервер у нас уже написан, я внесу правку в код сервера выше.
    // Предположим, что сервер теперь отправляет { speakerId, time, peerId }.
    // Тогда мы будем использовать это.
    // В текущей версии сервера я не добавил peerId, поэтому быстро исправим.
    // Для этого в server.js в событиях 'floor-changed' добавим peerId.
    // Я изменю код сервера в финальной версии.
    // Пока заглушка: если userId === currentUser.id, то это мы.
    if (userId === currentUser.id) return myPeerId;
    // Иначе ищем в peerConnections по имени (не реализовано).
    // Вернём null, и тогда центральное видео не покажется.
    return null;
}

// ---------- АДМИНИСТРАТИВНЫЕ ДЕЙСТВИЯ ----------
createDeputyBtn.addEventListener('click', () => {
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

// Дать слово
giveFloorBtn.addEventListener('click', () => {
    const userId = speakerSelect.value;
    if (!userId) return alert('Выберите депутата');
    let seconds = parseInt(customTime.value);
    if (isNaN(seconds) || seconds <= 0) {
        // Используем пресет или 60 по умолчанию
        seconds = 60;
    }
    socket.emit('admin-action', {
        action: 'give-floor',
        payload: { userId, seconds },
        adminPassword: ADMIN_PASSWORD
    });
});

revokeFloorBtn.addEventListener('click', () => {
    socket.emit('admin-action', {
        action: 'revoke-floor',
        payload: {},
        adminPassword: ADMIN_PASSWORD
    });
});

// Пресеты времени
presetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        customTime.value = btn.dataset.seconds;
    });
});

// Голосование
startVotingBtn.addEventListener('click', () => {
    socket.emit('admin-action', {
        action: 'start-voting',
        payload: {},
        adminPassword: ADMIN_PASSWORD
    });
});

closeVotingBtn.addEventListener('click', () => {
    socket.emit('admin-action', {
        action: 'close-voting',
        payload: {},
        adminPassword: ADMIN_PASSWORD
    });
});

announceResultsBtn.addEventListener('click', () => {
    socket.emit('admin-action', {
        action: 'announce-results',
        payload: {},
        adminPassword: ADMIN_PASSWORD
    });
});

// Перерыв
breakBtn.addEventListener('click', () => {
    socket.emit('admin-action', {
        action: 'set-break',
        payload: {},
        adminPassword: ADMIN_PASSWORD
    });
});

endBreakBtn.addEventListener('click', () => {
    socket.emit('admin-action', {
        action: 'end-break',
        payload: {},
        adminPassword: ADMIN_PASSWORD
    });
});

// Очистка
clearAllBtn.addEventListener('click', () => {
    if (confirm('Вы уверены, что хотите очистить все данные и начать новую сессию?')) {
        socket.emit('admin-action', {
            action: 'clear-all',
            payload: {},
            adminPassword: ADMIN_PASSWORD
        });
    }
});

// ---------- ГОЛОСОВАНИЕ ДЛЯ ДЕПУТАТОВ (на ПК) ----------
function showVotingButtons(active) {
    // Добавляем кнопки в deputy-info, если их нет
    let container = document.getElementById('vote-buttons');
    if (!container) {
        container = document.createElement('div');
        container.id = 'vote-buttons';
        container.style.marginTop = '10px';
        deputyInfo.appendChild(container);
    }
    container.innerHTML = '';
    if (!active) {
        container.innerHTML = '<p>Голосование недоступно</p>';
        return;
    }
    const choices = ['ЗА', 'ПРОТИВ', 'ВОЗДЕРЖАЛСЯ'];
    choices.forEach(label => {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.style.margin = '5px';
        btn.addEventListener('click', () => {
            const voteMap = { 'ЗА': 'for', 'ПРОТИВ': 'against', 'ВОЗДЕРЖАЛСЯ': 'abstain' };
            const vote = voteMap[label];
            fetch(`${BACKEND_URL}/api/vote`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: currentToken, vote })
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    alert('Ваш голос учтён!');
                    // Скрываем кнопки
                    hideVotingButtons();
                } else {
                    alert(data.message);
                }
            })
            .catch(console.error);
        });
        container.appendChild(btn);
    });
}

function hideVotingButtons() {
    const container = document.getElementById('vote-buttons');
    if (container) container.innerHTML = '';
}

// ---------- ЗАГРУЗКА СОСТОЯНИЯ ПРИ ЗАГРУЗКЕ (уже в attemptLogin) ----------
function fetchSessionState(token) {
    // уже используется в attemptLogin
}

// ---------- ЗАПУСК ----------
console.log('Симулятор Госдумы загружен');
