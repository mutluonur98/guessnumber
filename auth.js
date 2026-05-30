const SUPABASE_URL = 'https://nuemzruavccnnpygotoc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51ZW16cnVhdmNjbm5weWdvdG9jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5ODEwODcsImV4cCI6MjA5NTU1NzA4N30.Q56VY1ROvuqLn2ONBU8waRoP533M49RSYmXVDUg8_kE';

let supabaseClient = null;

function initSupabase() {
    if (!supabaseClient) {
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return supabaseClient;
}

async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

window.switchTab = function(tab) {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const loginBtn = document.querySelector('.tab-btn:first-child');
    const registerBtn = document.querySelector('.tab-btn:last-child');

    if (tab === 'login') {
        loginForm.classList.add('active');
        registerForm.classList.remove('active');
        loginBtn.classList.add('active');
        registerBtn.classList.remove('active');
    } else {
        registerForm.classList.add('active');
        loginForm.classList.remove('active');
        registerBtn.classList.add('active');
        loginBtn.classList.remove('active');
    }
}

window.register = async function() {
    const username = document.getElementById('registerUsername').value.trim();
    const password = document.getElementById('registerPassword').value.trim();
    const confirmPassword = document.getElementById('registerConfirmPassword').value.trim();

    if (!username || !password || !confirmPassword) {
        showNotification('Lütfen tüm alanları doldurun!', 'error');
        return;
    }

    if (username.length < 3) {
        showNotification('Kullanıcı adı en az 3 karakter olmalı!', 'error');
        return;
    }

    if (password.length < 4) {
        showNotification('Şifre en az 4 karakter olmalı!', 'error');
        return;
    }

    if (password !== confirmPassword) {
        showNotification('Şifreler eşleşmiyor!', 'error');
        return;
    }

    const supabase = initSupabase();
    const passwordHash = await hashPassword(password);

    try {
        const { data: existing } = await supabase
            .from('users')
            .select('username')
            .eq('username', username)
            .maybeSingle();

        if (existing) {
            showNotification('Bu kullanıcı adı zaten alınmış!', 'error');
            return;
        }

        // BAŞLANGIÇ ELO PUANI 1000 OLARAK AYARLANDI
        const { error } = await supabase
            .from('users')
            .insert([{
                username,
                password_hash: passwordHash,
                avatar: '👨',
                wins: 0,
                losses: 0,
                draws: 0,
                total_games: 0,
                elo_rating: 1000  // YENİ! Başlangıç Elo puanı
            }]);

        if (error) {
            showNotification('Kayıt hatası: ' + error.message, 'error');
        } else {
            showNotification('✅ Kayıt başarılı! Başlangıç ELO puanın: 1000', 'success');
            document.getElementById('registerUsername').value = '';
            document.getElementById('registerPassword').value = '';
            document.getElementById('registerConfirmPassword').value = '';
            setTimeout(() => {
                switchTab('login');
            }, 1500);
        }
    } catch (error) {
        showNotification('Bir hata oluştu: ' + error.message, 'error');
    }
}

window.login = async function() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value.trim();

    if (!username || !password) {
        showNotification('Kullanıcı adı ve şifre girin!', 'error');
        return;
    }

    const supabase = initSupabase();
    const passwordHash = await hashPassword(password);

    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('id, username, avatar, elo_rating, wins, losses, draws, total_games')
            .eq('username', username)
            .eq('password_hash', passwordHash)
            .maybeSingle();

        if (error || !user) {
            showNotification('Kullanıcı adı veya şifre hatalı!', 'error');
            return;
        }

        sessionStorage.setItem('currentUser', JSON.stringify({
            id: user.id,
            username: user.username,
            avatar: user.avatar || '👨',
            elo_rating: user.elo_rating || 1000,
            wins: user.wins || 0,
            losses: user.losses || 0,
            draws: user.draws || 0,
            total_games: user.total_games || 0
        }));

        window.location.href = 'lobby.html';

    } catch (error) {
        showNotification('Giriş hatası: ' + error.message, 'error');
    }
}

function showNotification(message, type) {
    const oldNotification = document.querySelector('.custom-notification');
    if (oldNotification) {
        oldNotification.remove();
    }

    const notification = document.createElement('div');
    notification.className = `custom-notification ${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <span class="notification-icon">${type === 'success' ? '✅' : '❌'}</span>
            <span>${message}</span>
        </div>
    `;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.classList.add('hide');
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

document.addEventListener('DOMContentLoaded', () => {
    const loginPassword = document.getElementById('loginPassword');
    const registerConfirmPassword = document.getElementById('registerConfirmPassword');

    if (loginPassword) {
        loginPassword.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') login();
        });
    }

    if (registerConfirmPassword) {
        registerConfirmPassword.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') register();
        });
    }
});