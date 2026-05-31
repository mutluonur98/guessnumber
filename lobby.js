const SUPABASE_URL = 'https://nuemzruavccnnpygotoc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51ZW16cnVhdmNjbm5weWdvdG9jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5ODEwODcsImV4cCI6MjA5NTU1NzA4N30.Q56VY1ROvuqLn2ONBU8waRoP533M49RSYmXVDUg8_kE';

let supabaseClient = null;
let currentPlayer = null;
let pendingJoinGame = null;
let selectedDigits = 6;
let lobbyChannel = null;

const AVATAR_LIST = [
    { id: 1, emoji: "👨", name: "Erkek", category: "insan" },
    { id: 2, emoji: "👩", name: "Kadın", category: "insan" },
    { id: 3, emoji: "🐺", name: "Kurt", category: "hayvan" },
    { id: 4, emoji: "🔥", name: "Ateş", category: "element" },
    { id: 5, emoji: "💧", name: "Su", category: "element" },
    { id: 6, emoji: "🚀", name: "Roket", category: "uzay" },
    { id: 7, emoji: "🧠", name: "Beyin", category: "bilim" },
    { id: 8, emoji: "🌙", name: "Ay", category: "uzay" },
    { id: 9, emoji: "⭐", name: "Yıldız", category: "uzay" },
    { id: 10, emoji: "🛡️", name: "Kalkan", category: "savaş" }
];

function initSupabase() {
    if (!supabaseClient) {
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return supabaseClient;
}

function checkAuth() {
    const userStr = sessionStorage.getItem('currentUser');
    if (!userStr) {
        window.location.href = 'index.html';
        return null;
    }
    return JSON.parse(userStr);
}

// ============ YENİ: KULLANICININ BEKLEYEN ODALARINI TEMİZLE ============
async function cleanupUserWaitingGames(userId) {
    const supabase = initSupabase();

    try {
        // Kullanıcının kurduğu ve beklemede olan odaları bul
        const { data: waitingGames, error } = await supabase
            .from('games')
            .select('id')
            .eq('player1_id', userId)
            .eq('status', 'waiting');

        if (!error && waitingGames && waitingGames.length > 0) {
            for (const game of waitingGames) {
                await supabase.from('games').delete().eq('id', game.id);
                console.log('🗑️ Bekleyen oda silindi:', game.id);
            }
            if (waitingGames.length > 0) {
                console.log(`✅ ${waitingGames.length} adet beklemedeki oda temizlendi`);
            }
        }
    } catch (error) {
        console.error('Bekleyen odalar temizlenirken hata:', error);
    }
}

// ============ YENİ: AKTİF OYUNLARI TERK ET (RAKİBE GALİBİYET) ============
async function abandonActiveGames(userId) {
    const supabase = initSupabase();

    try {
        // Kullanıcının dahil olduğu aktif oyunları bul
        const { data: activeGames, error } = await supabase
            .from('games')
            .select('*')
            .or(`player1_id.eq.${userId},player2_id.eq.${userId}`)
            .eq('status', 'active');

        if (!error && activeGames && activeGames.length > 0) {
            for (const game of activeGames) {
                const opponentId = game.player1_id === userId ? game.player2_id : game.player1_id;

                if (opponentId) {
                    console.log(`🏆 Oyuncu ${userId} oyunu terk etti, rakip ${opponentId} kazandı`);

                    // Rakibin galibiyetini ve kaybedenin mağlubiyetini güncelle
                    await supabase
                        .from('users')
                        .update({
                            wins: supabase.raw('wins + 1'),
                            total_games: supabase.raw('total_games + 1')
                        })
                        .eq('id', opponentId);

                    await supabase
                        .from('users')
                        .update({
                            losses: supabase.raw('losses + 1'),
                            total_games: supabase.raw('total_games + 1')
                        })
                        .eq('id', userId);

                    // ELO güncellemesi yap (rakip kazandı)
                    await updateEloRatings(opponentId, userId, false);

                    // Oyunu bitir
                    await supabase
                        .from('games')
                        .update({
                            status: 'finished',
                            winner_id: opponentId,
                            ended_at: new Date(),
                            abandoned_by: userId
                        })
                        .eq('id', game.id);
                }
            }
        }
    } catch (error) {
        console.error('Aktif oyunlar terk edilirken hata:', error);
    }
}

// GÜNCELLENMİŞ logout fonksiyonu
window.logout = async function() {
    if (!currentPlayer) {
        sessionStorage.removeItem('currentUser');
        window.location.href = 'index.html';
        return;
    }

    // 1. Kullanıcının beklemedeki odalarını temizle
    await cleanupUserWaitingGames(currentPlayer.id);

    // 2. Kullanıcının aktif oyunlarını terk et (rakibe galibiyet)
    await abandonActiveGames(currentPlayer.id);

    // 3. Oturumu temizle
    sessionStorage.removeItem('currentUser');

    // 4. Realtime kanalını kapat
    if (lobbyChannel) {
        const supabase = initSupabase();
        supabase.removeChannel(lobbyChannel);
    }

    // 5. Ana sayfaya yönlendir
    window.location.href = 'index.html';
}

function generateRoomCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function setupNumericInput(inputElement) {
    if (!inputElement) return;
    inputElement.addEventListener('input', function(e) {
        this.value = this.value.replace(/[^0-9]/g, '');
    });
}

function updateInputMaxLength(digits) {
    const createSecretInput = document.getElementById('createSecretNumber');
    const joinSecretInput = document.getElementById('joinSecretNumber');
    if (createSecretInput) {
        createSecretInput.maxLength = digits;
        createSecretInput.placeholder = `${digits} haneli sayı`;
    }
    if (joinSecretInput) {
        joinSecretInput.maxLength = digits;
        joinSecretInput.placeholder = `${digits} haneli sayı`;
    }
}

window.openAvatarModal = function() {
    const avatarGrid = document.getElementById('avatarGrid');
    if (avatarGrid) {
        avatarGrid.innerHTML = '';
        AVATAR_LIST.forEach(avatar => {
            const avatarItem = document.createElement('div');
            avatarItem.className = 'avatar-item';
            if (currentPlayer && currentPlayer.avatar === avatar.emoji) {
                avatarItem.classList.add('selected');
            }
            avatarItem.innerHTML = `
                <div class="avatar-emoji">${avatar.emoji}</div>
                <div class="avatar-name">${avatar.name}</div>
            `;
            avatarItem.onclick = () => selectAvatar(avatar.emoji);
            avatarGrid.appendChild(avatarItem);
        });
    }
    document.getElementById('avatarModal').style.display = 'flex';
}

window.closeAvatarModal = function() {
    document.getElementById('avatarModal').style.display = 'none';
}

async function selectAvatar(avatarEmoji) {
    const supabase = initSupabase();

    try {
        const { error } = await supabase
            .from('users')
            .update({ avatar: avatarEmoji })
            .eq('id', currentPlayer.id);

        if (error) {
            console.error('Avatar güncelleme hatası:', error);
            alert('Avatar değiştirilemedi: ' + error.message);
            return;
        }

        currentPlayer.avatar = avatarEmoji;

        const userStr = sessionStorage.getItem('currentUser');
        if (userStr) {
            const user = JSON.parse(userStr);
            user.avatar = avatarEmoji;
            sessionStorage.setItem('currentUser', JSON.stringify(user));
        }

        document.getElementById('playerAvatar').textContent = avatarEmoji;

        closeAvatarModal();

        const notification = document.createElement('div');
        notification.className = 'custom-notification success';
        notification.innerHTML = `<div class="notification-content"><span>✅ Avatar değiştirildi!</span></div>`;
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 2000);

    } catch (error) {
        console.error('Avatar seçim hatası:', error);
        alert('Bir hata oluştu: ' + error.message);
    }
}

async function loadUserAvatar() {
    if (!currentPlayer) return;

    const supabase = initSupabase();

    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('avatar')
            .eq('id', currentPlayer.id)
            .maybeSingle();

        if (error) {
            console.error('Avatar yükleme hatası:', error);
            return;
        }

        if (user && user.avatar) {
            currentPlayer.avatar = user.avatar;
            document.getElementById('playerAvatar').textContent = user.avatar;
        } else {
            document.getElementById('playerAvatar').textContent = '👨';
        }
    } catch (error) {
        console.error('Avatar yükleme hatası:', error);
    }
}

// ELO HESAPLAMA FONKSİYONLARI
function calculateEloChange(winnerElo, loserElo, isDraw = false) {
    const K = 32;
    const MIN_POINTS = 4;

    if (isDraw) {
        const expectedWinner = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
        const expectedLoser = 1 / (1 + Math.pow(10, (winnerElo - loserElo) / 400));

        let winnerChange = Math.round(K * (0.5 - expectedWinner));
        let loserChange = Math.round(K * (0.5 - expectedLoser));

        if (Math.abs(winnerChange) < MIN_POINTS && winnerChange !== 0) {
            winnerChange = winnerChange > 0 ? MIN_POINTS : -MIN_POINTS;
        }
        if (Math.abs(loserChange) < MIN_POINTS && loserChange !== 0) {
            loserChange = loserChange > 0 ? MIN_POINTS : -MIN_POINTS;
        }

        return { winnerChange, loserChange };
    } else {
        const expectedWinner = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
        const expectedLoser = 1 / (1 + Math.pow(10, (winnerElo - loserElo) / 400));

        let winnerChange = Math.round(K * (1 - expectedWinner));
        let loserChange = Math.round(K * (0 - expectedLoser));

        if (winnerChange < MIN_POINTS && winnerChange > 0) {
            const difference = MIN_POINTS - winnerChange;
            winnerChange = MIN_POINTS;
            loserChange = loserChange - difference;
        }

        if (loserChange < -32) {
            const difference = loserChange + 32;
            loserChange = -32;
            winnerChange = winnerChange - difference;
        }

        return { winnerChange, loserChange };
    }
}

async function updateEloRatings(winnerId, loserId, isDraw = false) {
    const supabase = initSupabase();

    try {
        const { data: winner, error: winnerError } = await supabase
            .from('users')
            .select('elo_rating')
            .eq('id', winnerId)
            .single();

        const { data: loser, error: loserError } = await supabase
            .from('users')
            .select('elo_rating')
            .eq('id', loserId)
            .single();

        if (winnerError || loserError) throw new Error('Elo puanları alınamadı');

        const winnerElo = winner.elo_rating || 1000;
        const loserElo = loser.elo_rating || 1000;

        const { winnerChange, loserChange } = calculateEloChange(winnerElo, loserElo, isDraw);

        const newWinnerElo = Math.max(100, winnerElo + winnerChange);
        const newLoserElo = Math.max(100, loserElo + loserChange);

        if (isDraw) {
            await supabase
                .from('users')
                .update({ elo_rating: newWinnerElo })
                .eq('id', winnerId);

            await supabase
                .from('users')
                .update({ elo_rating: newLoserElo })
                .eq('id', loserId);
        } else {
            await supabase
                .from('users')
                .update({ elo_rating: newWinnerElo })
                .eq('id', winnerId);

            await supabase
                .from('users')
                .update({ elo_rating: newLoserElo })
                .eq('id', loserId);
        }

        return { newWinnerElo, newLoserElo, winnerChange, loserChange };

    } catch (error) {
        console.error('Elo güncelleme hatası:', error);
        return null;
    }
}

function getEloLevel(elo) {
    if (elo < 1000) return { name: "Çaylak", color: "beginner" };
    if (elo < 1200) return { name: "Bronz", color: "bronze" };
    if (elo < 1400) return { name: "Gümüş", color: "silver" };
    if (elo < 1600) return { name: "Altın", color: "gold" };
    if (elo < 1800) return { name: "Platin", color: "platinum" };
    if (elo < 2000) return { name: "Elmas", color: "diamond" };
    return { name: "Usta", color: "master" };
}

window.loadLeaderboard = async function(period = 'all') {
    if (!currentPlayer) return;

    const supabase = initSupabase();
    const tableBody = document.getElementById('leaderboardTable');

    if (!tableBody) return;

    tableBody.innerHTML = '<div class="loading-spinner">🏆 Sıralama yükleniyor...</div>';

    try {
        const { data: leaders, error } = await supabase
            .from('users')
            .select('id, username, avatar, wins, losses, draws, total_games, elo_rating')
            .order('elo_rating', { ascending: false })
            .limit(10);

        if (error) {
            console.error('Leaderboard error:', error);
            tableBody.innerHTML = '<div class="error-message">Sıralama yüklenemedi</div>';
            return;
        }

        if (!leaders || leaders.length === 0) {
            tableBody.innerHTML = '<div class="empty-message">Henüz oyuncu yok</div>';
            return;
        }

        let html = `
            <table class="rank-table">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Oyuncu</th>
                        <th>🏆 Galibiyet</th>
                        <th>🤝 Beraberlik</th>
                        <th>📉 Mağlubiyet</th>
                        <th>⭐ ELO Puanı</th>
                    </tr>
                </thead>
                <tbody>
        `;

        leaders.forEach((player, index) => {
            const rank = index + 1;
            const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
            const avatar = player.avatar || '👤';
            const isCurrentUser = currentPlayer && player.id === currentPlayer.id;
            const eloRating = player.elo_rating || 1000;
            const level = getEloLevel(eloRating);

            html += `
                <tr class="${isCurrentUser ? 'current-user-row' : ''}">
                    <td class="rank-number">${medal}</td>
                    <td class="player-cell">
                        <span class="rank-avatar">${avatar}</span>
                        <span class="rank-name">${player.username || 'Anonim'}${isCurrentUser ? ' (SİZ)' : ''}</span>
                    </td>
                    <td class="wins-cell">${player.wins || 0}</td>
                    <td class="draws-cell">${player.draws || 0}</td>
                    <td class="losses-cell">${player.losses || 0}</td>
                    <td class="rate-cell">
                        <span class="elo-badge ${level.color}">${eloRating}</span>
                    </td>
                </tr>
            `;
        });

        html += `</tbody></table>`;
        tableBody.innerHTML = html;

        await loadMyRank();

    } catch (error) {
        console.error('Leaderboard error:', error);
        tableBody.innerHTML = '<div class="error-message">Bir hata oluştu</div>';
    }
}

async function loadMyRank() {
    if (!currentPlayer) return;

    const supabase = initSupabase();
    const myRankDiv = document.getElementById('myRank');

    if (!myRankDiv) return;

    try {
        const { data: allPlayers, error } = await supabase
            .from('users')
            .select('id, wins, total_games, elo_rating')
            .order('elo_rating', { ascending: false });

        if (error || !allPlayers) return;

        const myIndex = allPlayers.findIndex(p => p.id === currentPlayer.id);

        if (myIndex === -1) {
            myRankDiv.innerHTML = `
                <div class="my-rank-card">
                    <div class="my-rank-title">📍 SIRALAMADAKİ YERİN</div>
                    <div class="my-rank-number">Henüz oyun oynamadın</div>
                    <div class="my-rank-hint">🎮 Bir düello yaparak sıralamaya gir!</div>
                </div>
            `;
            return;
        }

        const myRank = myIndex + 1;
        const myData = allPlayers[myIndex];
        const myElo = myData.elo_rating || 1000;
        const level = getEloLevel(myElo);

        const medalIcon = myRank === 1 ? '🥇' : myRank === 2 ? '🥈' : myRank === 3 ? '🥉' : '🏆';

        myRankDiv.innerHTML = `
            <div class="my-rank-card">
                <div class="my-rank-title">📍 ${medalIcon} SIRALAMADAKİ YERİN</div>
                <div class="my-rank-number">#${myRank}</div>
                <div class="my-rank-stats">
                    <span>🏆 ${myData.wins || 0} Galibiyet</span>
                    <span>⭐ ${myElo} ELO Puanı</span>
                    <span>🎯 ${level.name} Seviye</span>
                </div>
                <div class="my-rank-progress">
                    <div class="progress-bar">
                        <div class="progress-fill elo-progress" style="width: ${Math.min(100, (myElo - 800) / 12)}%"></div>
                    </div>
                </div>
            </div>
        `;

    } catch (error) {
        console.error('My rank error:', error);
    }
}

// ============ GÜNCELLENMİŞ loadRooms - Ölü odaları gösterme ============
async function loadRooms() {
    const supabase = initSupabase();
    if (!currentPlayer) return;

    try {
        // Tüm waiting odalarını al
        const { data: rooms, error } = await supabase
            .from('games')
            .select('*')
            .eq('status', 'waiting')
            .eq('is_private', false)
            .neq('player1_id', currentPlayer.id);

        if (error) {
            console.error('Load rooms error:', error);
            return;
        }

        const roomsList = document.getElementById('roomsList');

        // Geçerli odaları filtrele
        const validRooms = [];

        for (const room of rooms || []) {
            try {
                // Player1'in hala var olup olmadığını kontrol et
                const { data: player, error: playerError } = await supabase
                    .from('users')
                    .select('id, username, avatar, elo_rating')
                    .eq('id', room.player1_id)
                    .maybeSingle();

                // Eğer player1 silinmiş veya yoksa, bu odayı temizle
                if (playerError || !player) {
                    console.log('🗑️ Geçersiz oyuncu (silinmiş), oda siliniyor:', room.id);
                    await supabase.from('games').delete().eq('id', room.id);
                    continue;
                }

                // Geçerli odaya ekle
                validRooms.push({
                    ...room,
                    player_username: player.username,
                    player_avatar: player.avatar || '👤',
                    player_elo: player.elo_rating || 1000
                });

            } catch (err) {
                console.error('Room validation error:', err);
            }
        }

        if (validRooms.length === 0) {
            roomsList.innerHTML = '<p>📭 Bekleyen düello yok. Hemen düello kurun!</p>';
            return;
        }

        roomsList.innerHTML = '';
        for (const room of validRooms) {
            const roomDiv = document.createElement('div');
            roomDiv.className = 'room-item';
            roomDiv.innerHTML = `
                <div class="room-info">
                    <div class="room-avatar" style="background: linear-gradient(135deg, #667eea, #764ba2); border-radius: 50%; width: 45px; height: 45px; display: flex; align-items: center; justify-content: center; font-size: 24px;">
                        ${room.player_avatar}
                    </div>
                    <div>
                        <div><strong style="color:#fff">${room.player_username}</strong> <span style="font-size:12px; color:#ffd700">⭐${room.player_elo}</span></div>
                        <div style="font-size:11px; color:#aaa">🔢 ${room.digit_count} Basamak | 🏠 ${room.room_code}</div>
                    </div>
                </div>
                <button onclick="joinGame('${room.id}')" class="join-btn" style="background: linear-gradient(135deg, #11998e, #38ef7d); border-radius: 30px; padding: 8px 20px; border: none; color: white; cursor: pointer;">
                    🎯 Katıl
                </button>
            `;
            roomsList.appendChild(roomDiv);
        }
    } catch (error) {
        console.error('Load rooms error:', error);
    }
}

async function loadStats() {
    if (!currentPlayer) return;

    const supabase = initSupabase();

    try {
        const { data: stats, error } = await supabase
            .from('users')
            .select('wins, losses, draws, total_games, elo_rating')
            .eq('id', currentPlayer.id)
            .maybeSingle();

        if (error) {
            console.error('Stats error:', error);
            return;
        }

        if (stats) {
            document.getElementById('wins').textContent = stats.wins || 0;
            document.getElementById('losses').textContent = stats.losses || 0;
            document.getElementById('draws').textContent = stats.draws || 0;
            document.getElementById('totalGames').textContent = stats.total_games || 0;

            const totalGames = stats.total_games || 0;
            const wins = stats.wins || 0;
            const winrate = totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0;

            document.getElementById('winrateValue').textContent = `${winrate}%`;
            document.getElementById('winrateFill').style.width = `${winrate}%`;

            const eloRating = stats.elo_rating || 1000;
            const level = getEloLevel(eloRating);

            const eloValueElement = document.getElementById('eloRating');
            const eloLabelElement = document.getElementById('eloLevelLabel');

            if (eloValueElement) {
                eloValueElement.textContent = eloRating;
                eloValueElement.className = 'stat-value ' + level.color;
            }
            if (eloLabelElement) {
                eloLabelElement.textContent = level.name;
                eloLabelElement.className = 'stat-label ' + level.color;
            }
        }
    } catch (error) {
        console.error('Load stats error:', error);
    }
}

function setupLobbyRealtime() {
    const supabase = initSupabase();

    if (lobbyChannel) {
        supabase.removeChannel(lobbyChannel);
    }

    lobbyChannel = supabase
        .channel('lobby-changes')
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'games'
        }, () => {
            loadRooms();
        })
        .subscribe();
}

window.openCreateGameModal = function() {
    document.getElementById('createGameModal').style.display = 'flex';
}

window.closeCreateGameModal = function() {
    document.getElementById('createGameModal').style.display = 'none';
}

window.selectDigitForCreate = function(digits) {
    selectedDigits = digits;
    closeCreateGameModal();

    const secretInput = document.getElementById('createSecretNumber');
    if (secretInput) {
        secretInput.maxLength = digits;
        secretInput.placeholder = `${digits} haneli gizli sayı`;
        secretInput.value = '';
        setupNumericInput(secretInput);
    }
    document.getElementById('createSecretModal').style.display = 'flex';
}

window.closeCreateSecretModal = function() {
    document.getElementById('createSecretModal').style.display = 'none';
    selectedDigits = 6;
}

window.confirmCreateGame = async function() {
    const secretInput = document.getElementById('createSecretNumber');
    const secret = secretInput?.value.trim();
    const digits = selectedDigits || 6;

    if (!secret || secret.length !== digits || isNaN(secret)) {
        alert(`Lütfen geçerli ${digits} haneli bir sayı girin!`);
        return;
    }

    const supabase = initSupabase();
    const roomCode = generateRoomCode();

    try {
        const { data: game, error } = await supabase
            .from('games')
            .insert([{
                player1_id: currentPlayer.id,
                player1_secret: secret,
                room_code: roomCode,
                digit_count: digits,
                status: 'waiting',
                current_turn: currentPlayer.id,
                extra_turn_given: false,
                is_extra_turn: false,
                is_private: false
            }])
            .select();

        if (error) {
            console.error('Create game error:', error);
            alert('Düello oluşturma hatası: ' + error.message);
            return;
        }

        if (game && game.length > 0) {
            closeCreateSecretModal();
            window.location.href = `game.html?gameId=${game[0].id}&playerId=${currentPlayer.id}`;
        } else {
            alert('Düello oluşturulamadı!');
        }
    } catch (error) {
        console.error('Create game error:', error);
        alert('Bir hata oluştu: ' + error.message);
    }
}

window.prepareJoinWithCode = async function() {
    const roomCode = document.getElementById('joinCodeInput').value.trim();
    if (!roomCode || roomCode.length !== 6 || isNaN(roomCode)) {
        alert('Lütfen geçerli 6 haneli bir oda kodu girin!');
        return;
    }

    const supabase = initSupabase();

    try {
        const { data: game, error } = await supabase
            .from('games')
            .select('*')
            .eq('room_code', roomCode)
            .eq('status', 'waiting')
            .maybeSingle();

        if (error) {
            console.error('Find game error:', error);
            alert('Düello bulunamadı: ' + error.message);
            return;
        }

        if (!game) {
            alert('❌ Bu kodla eşleşen bir düello bulunamadı!');
            return;
        }

        // Ek kontrol: Odayı kuran oyuncu hala var mı?
        const { data: player, error: playerError } = await supabase
            .from('users')
            .select('id')
            .eq('id', game.player1_id)
            .maybeSingle();

        if (playerError || !player) {
            alert('❌ Bu düelloyu kuran oyuncu artık mevcut değil! Oda siliniyor.');
            await supabase.from('games').delete().eq('id', game.id);
            await loadRooms();
            return;
        }

        if (game.player1_id === currentPlayer.id) {
            alert('❌ Kendi düellonuza katılamazsınız!');
            return;
        }

        pendingJoinGame = game;

        const digits = game.digit_count || 6;
        updateInputMaxLength(digits);
        const joinSecretInput = document.getElementById('joinSecretNumber');
        if (joinSecretInput) {
            joinSecretInput.value = '';
            joinSecretInput.maxLength = digits;
            joinSecretInput.placeholder = `${digits} haneli gizli sayı`;
            setupNumericInput(joinSecretInput);
        }
        document.getElementById('joinSecretModal').style.display = 'flex';

    } catch (error) {
        console.error('Join game error:', error);
        alert('Bir hata oluştu: ' + error.message);
    }
}

window.closeJoinSecretModal = function() {
    document.getElementById('joinSecretModal').style.display = 'none';
    pendingJoinGame = null;
}

window.joinGame = async function(gameId) {
    const supabase = initSupabase();

    try {
        const { data: game, error } = await supabase
            .from('games')
            .select('*')
            .eq('id', gameId)
            .maybeSingle();

        if (error || !game) {
            alert('Düello bulunamadı!');
            return;
        }

        // Ek kontrol: Odayı kuran oyuncu hala var mı?
        const { data: player, error: playerError } = await supabase
            .from('users')
            .select('id')
            .eq('id', game.player1_id)
            .maybeSingle();

        if (playerError || !player) {
            alert('❌ Bu düelloyu kuran oyuncu artık mevcut değil! Oda siliniyor.');
            await supabase.from('games').delete().eq('id', game.id);
            await loadRooms();
            return;
        }

        if (game.player1_id === currentPlayer.id) {
            alert('❌ Kendi düellonuza katılamazsınız!');
            return;
        }

        pendingJoinGame = game;

        const digits = game.digit_count || 6;
        updateInputMaxLength(digits);
        const joinSecretInput = document.getElementById('joinSecretNumber');
        if (joinSecretInput) {
            joinSecretInput.value = '';
            joinSecretInput.maxLength = digits;
            joinSecretInput.placeholder = `${digits} haneli gizli sayı`;
            setupNumericInput(joinSecretInput);
        }
        document.getElementById('joinSecretModal').style.display = 'flex';

    } catch (error) {
        console.error('Join game error:', error);
        alert('Bir hata oluştu: ' + error.message);
    }
}

window.confirmJoinWithSecret = async function() {
    if (!pendingJoinGame) {
        alert('Düello bilgisi bulunamadı!');
        closeJoinSecretModal();
        return;
    }

    const secretInput = document.getElementById('joinSecretNumber');
    const secret = secretInput.value.trim();
    const digits = pendingJoinGame.digit_count || 6;

    if (!secret || secret.length !== digits || isNaN(secret)) {
        alert(`Lütfen geçerli ${digits} haneli bir sayı girin!`);
        return;
    }

    const supabase = initSupabase();
    const game = pendingJoinGame;

    try {
        const { data: freshGame } = await supabase
            .from('games')
            .select('status')
            .eq('id', game.id)
            .maybeSingle();

        if (!freshGame || freshGame.status !== 'waiting') {
            alert('Düello artık aktif değil veya biri katılmış olabilir!');
            closeJoinSecretModal();
            return;
        }

        const { error: updateError } = await supabase
            .from('games')
            .update({
                player2_id: currentPlayer.id,
                player2_secret: secret,
                status: 'active'
            })
            .eq('id', game.id);

        if (updateError) {
            console.error('Join game error:', updateError);
            alert('Düelloya katılma hatası: ' + updateError.message);
            return;
        }

        closeJoinSecretModal();
        window.location.href = `game.html?gameId=${game.id}&playerId=${currentPlayer.id}`;

    } catch (error) {
        console.error('Join game error:', error);
        alert('Bir hata oluştu: ' + error.message);
    }
}

// ============ PERİYODİK ÖLÜ ODA TEMİZLİĞİ ============
async function cleanupDeadRooms() {
    const supabase = initSupabase();
    if (!currentPlayer) return;

    try {
        // Tüm waiting odaları al
        const { data: waitingRooms, error } = await supabase
            .from('games')
            .select('*')
            .eq('status', 'waiting');

        if (error || !waitingRooms) return;

        for (const room of waitingRooms) {
            // Player1'in var olup olmadığını kontrol et
            const { data: player, error: playerError } = await supabase
                .from('users')
                .select('id')
                .eq('id', room.player1_id)
                .maybeSingle();

            // Eğer player1 yoksa veya 10 dakikadan eskiyse sil
            const createdDate = new Date(room.created_at);
            const now = new Date();
            const minutesOld = (now - createdDate) / 1000 / 60;

            if (playerError || !player || minutesOld > 10) {
                console.log('🗑️ Ölü oda temizlendi:', room.id);
                await supabase.from('games').delete().eq('id', room.id);
            }
        }
    } catch (error) {
        console.error('Cleanup error:', error);
    }
}

// ELO fonksiyonlarını global yap
window.updateEloRatings = updateEloRatings;
window.getEloLevel = getEloLevel;

// Sayfa kapatılırken temizlik yap (sayfa yenileme veya kapatma)
window.addEventListener('beforeunload', async () => {
    if (currentPlayer) {
        await cleanupUserWaitingGames(currentPlayer.id);
        await abandonActiveGames(currentPlayer.id);
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    const user = checkAuth();
    if (!user) return;

    currentPlayer = { id: user.id, username: user.username, avatar: user.avatar || '👨' };

    document.getElementById('playerName').textContent = currentPlayer.username;
    document.getElementById('playerId').textContent = currentPlayer.id;

    await loadUserAvatar();
    await loadRooms();
    await loadStats();
    await loadLeaderboard('all');
    setupLobbyRealtime();

    // Periyodik temizlik (her 30 saniyede bir)
    setInterval(() => {
        if (currentPlayer) {
            cleanupDeadRooms();
        }
    }, 30000);

    if (typeof initFriendsSystem === 'function') {
        await initFriendsSystem(currentPlayer.id);
    } else {
        console.error('initFriendsSystem fonksiyonu bulunamadı! friends.js yüklü mü?');
    }
});

setInterval(() => {
    if (document.getElementById('roomsList') && currentPlayer) {
        loadRooms();
    }
}, 5000);