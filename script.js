// ============================================================
//  Фронтенд для симулятора "Государственная Дума"
// ============================================================

// ---------- КОНФИГУРАЦИЯ ----------
const BACKEND_URL = 'https://duma-backend-1.onrender.com';  // ← ВАШ АДРЕС

// ---------- ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ----------
let socket = null;
let peer = null;
let myPeerId = null;
let currentToken = null;
let currentUser = null;
let isAdmin = false;

// ============================================================
//  ОСНОВНЫЕ ФУНКЦИИ АВТОРИЗАЦИИ
// ============================================================

function showLoginForm() {
    const password = prompt('Введите пароль председателя или токен депутата:');
    if (!password) return;

    if (password === 'duma2026') {
        // Вход как председатель
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
        // Пытаемся войти как депутат
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
            if (res.status === 401) {
                throw new Error('Неверный токен');
            }
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
