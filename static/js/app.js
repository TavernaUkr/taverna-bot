// static/js/app.js
// API_BASE_URL визначаємо автоматично.
// 1) Якщо MiniApp відкрито з вашого API (FastAPI віддає static) — буде той самий origin.
// 2) Якщо треба форсувати (ngrok/Render) — задайте window.__API_BASE_URL__ в html.
const API_BASE_URL = (window.__API_BASE_URL__ && typeof window.__API_BASE_URL__ === 'string')
    ? window.__API_BASE_URL__.replace(/\/+$/, '')
    : window.location.origin;


// Безпечна ініціалізація Telegram
let tg = null;
if (window.Telegram && window.Telegram.WebApp) {
    tg = window.Telegram.WebApp;
    tg.expand(); // Розгортаємо на весь екран
} else {
    console.warn("Telegram WebApp SDK не знайдено. Запуск у браузері?");
}

const logger = {
    info: (msg) => console.log(`[INFO] ${msg}`),
    error: (msg) => console.error(`[ERROR] ${msg}`)
};

// 1. УНІВЕРСАЛЬНА ФУНКЦІЯ API
async function apiCall(endpoint, method = 'GET', body = null) {
    try {
        const options = { 
            method: method, 
            headers: { 'Content-Type': 'application/json' } 
        };
        
        if (body) {
            options.body = JSON.stringify(body);
        }
        
        const token = localStorage.getItem('jwt_token');
        if (token && endpoint.indexOf('login') === -1) {
            options.headers['Authorization'] = `Bearer ${token}`;
        }
        
        const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
        
        if (response.status === 401) {
            // Токен застарів
            localStorage.removeItem('jwt_token');
            localStorage.removeItem('current_user');
            // Якщо ми не на логіні, то не перекидаємо автоматично, 
            // щоб не ламати інтерфейс, але повертаємо помилку
            return { error: "Unauthorized" };
        }
        
        if (!response.ok) {
            const err = await response.json().catch(() => ({ detail: response.statusText }));
            throw new Error(err.detail || `HTTP помилка: ${response.status}`);
        }
        if (response.status === 204) return { success: true };
        return await response.json();
        
    } catch (error) {
        console.error(`API Error (${endpoint}):`, error);
        return { error: error.message };
    }
}

// 2. АВТОРИЗАЦІЯ
async function authenticateUser() {
    if (!tg || !tg.initData) {
        // Якщо ми в браузері без телеграма - повертаємо null
        return null;
    }
    
    // Перевіряємо кеш
    const cachedUser = sessionStorage.getItem('tgUser');
    const token = localStorage.getItem('jwt_token');
    
    if (cachedUser && token) {
        return JSON.parse(cachedUser);
    }

    // Логін
    const data = await apiCall('/api/v1/auth/login-telegram', 'POST', {
        initData: tg.initData
    });
    
    if (data && data.access_token) {
        sessionStorage.setItem('tgUser', JSON.stringify(data.user));
        localStorage.setItem('jwt_token', data.access_token);
        localStorage.setItem('current_user', JSON.stringify(data.user));
        return data.user;
    }
    return null;
}