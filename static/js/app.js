// static/js/app.js

// ВАЖЛИВО: Вкажи тут URL твого Render API
const API_BASE_URL = "https://taverna-bot-r028.onrender.com"; // ЗАМІНИ ЦЕ

const tg = window.Telegram.WebApp;

// Створюємо простий логгер
const logger = {
    info: (msg) => console.log(msg),
    error: (msg) => console.error(msg)
};

// 1. УНІВЕРСАЛЬНА ФУНКЦІЯ API (ОНОВЛЕНО ДЛЯ JWT)
async function apiCall(endpoint, method = 'GET', body = null) {
    try {
        const options = { 
            method: method, 
            headers: { 'Content-Type': 'application/json' } 
        };
        if (body) {
            options.body = JSON.stringify(body);
        }
        
        // --- [НОВЕ - ФАЗА 3.8] ---
        // Додаємо JWT-токен до ВСІХ запитів (окрім логіну)
        const token = localStorage.getItem('jwt_token');
        if (token && endpoint.indexOf('login') === -1) {
            options.headers['Authorization'] = `Bearer ${token}`;
        }
        // ---
        
        const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
        
        if (response.status === 401) {
            // Токен застарів або невалідний
            logger.error("401 Unauthorized. Токен невалідний. Перенаправлення на /login.html");
            localStorage.removeItem('jwt_token');
            localStorage.removeItem('current_user');
            window.location.href = 'login.html';
            return { error: "Unauthorized" };
        }
        
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || `HTTP помилка: ${response.status}`);
        }
        // Для DELETE-запитів, які можуть повернути 204 No Content
        if (response.status === 204) {
            return { success: true };
        }
        return await response.json();
        
    } catch (error) {
        logger.error(`Помилка API (${endpoint}): ${error.message}`);
        tg.showAlert(`Помилка: ${error.message}. Спробуйте перезапустити додаток.`);
        return { error: error.message };
    }
}

// 2. УНІВЕРСАЛЬНА ФУНКЦІЯ АВТОРИЗАЦІЇ (ОНОВЛЕНО)
async function authenticateUser() {
    const initData = tg.initData;
    if (!initData) {
        logger.error("authenticateUser: initData відсутній.");
        tg.showAlert("Помилка: не вдалося отримати дані Telegram. Будь ласка, перезапустіть додаток.");
        return null;
    }
    
    // Перевіряємо кеш
    const cachedUser = sessionStorage.getItem('tgUser');
    if (cachedUser) {
        logger.info("authenticateUser: Взято користувача з кешу sessionStorage.");
        // Важливо: також перевіряємо, чи є JWT-токен
        if(localStorage.getItem('jwt_token')) {
            return JSON.parse(cachedUser);
        }
        // Якщо токена немає, але є кеш - чистимо кеш
        sessionStorage.removeItem('tgUser');
    }

    // Викликаємо /login-telegram, який ПОВЕРНЕ JWT-ТОКЕН
    const data = await apiCall('/api/v1/auth/login-telegram', 'POST', {
        initData: initData
    });
    
    if (data && data.access_token && data.user) {
        logger.info(`authenticateUser: Успішна авторизація user ${data.user.telegram_id}.`);
        // Зберігаємо в кеш сесії
        sessionStorage.setItem('tgUser', JSON.stringify(data.user));
        // Зберігаємо токен в постійне сховище
        localStorage.setItem('jwt_token', data.access_token);
        localStorage.setItem('current_user', JSON.stringify(data.user));
        return data.user; // Повертає { telegram_id: ..., first_name: ... }
    } else {
        logger.error(`authenticateUser: Не вдалося авторизуватись. Відповідь API: ${JSON.stringify(data)}`);
        tg.showAlert(data.detail || data.error || "Не вдалося авторизуватись. Спробуйте перезапустити.");
        return null;
    }
}