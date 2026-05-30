const SUPABASE_URL = 'https://nuemzruavccnnpygotoc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51ZW16cnVhdmNjbm5weWdvdG9jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5ODEwODcsImV4cCI6MjA5NTU1NzA4N30.Q56VY1ROvuqLn2ONBU8waRoP533M49RSYmXVDUg8_kE';

window.supabaseClient = null;
window.currentPlayer = null;
window.currentGame = null;
window.gameChannel = null;
window.guessesChannel = null;
window.messageChannel = null;
window.secretVisible = false;
window.celebrated = false;

function initSupabase() {
    if (!window.supabaseClient) {
        window.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return window.supabaseClient;
}

function setupNumericInput(inputElement) {
    if (!inputElement) return;
    inputElement.addEventListener('input', function(e) {
        this.value = this.value.replace(/[^0-9]/g, '');
    });
    inputElement.addEventListener('keypress', function(e) {
        if (e.key < '0' || e.key > '9') {
            e.preventDefault();
        }
    });
}

function updateInputMaxLength(digits) {
    const guessInput = document.getElementById('guessInput');
    if (guessInput) {
        guessInput.maxLength = digits;
        guessInput.placeholder = `${digits} haneli sayı girin`;
        guessInput.autocomplete = 'off';  // Öneri engelleme
        guessInput.autofill = 'off';      // Otomatik doldurma engelleme
    }
}

window.toggleSecret = function() {
    window.secretVisible = !window.secretVisible;
    updateSecretDisplay();
}

function updateSecretDisplay() {
    if (!window.currentGame || !window.currentPlayer) return;

    const mySecret = window.currentGame.player1_id === window.currentPlayer.id
        ? window.currentGame.player1_secret
        : window.currentGame.player2_secret;

    const secretValueEl = document.getElementById('secretValue');
    if (secretValueEl) {
        if (window.secretVisible) {
            secretValueEl.textContent = mySecret || '•••••';
            secretValueEl.classList.remove('secret-hidden');
        } else {
            secretValueEl.textContent = '•'.repeat(window.currentGame.digit_count || 6);
            secretValueEl.classList.add('secret-hidden');
        }
    }
}

function showBigEmojiOnCard(playerId, emoji) {
    const overlayId = playerId === window.currentGame?.player1_id ? 'player1Message' : 'player2Message';
    const overlay = document.getElementById(overlayId);
    const playerBox = document.getElementById(playerId === window.currentGame?.player1_id ? 'player1Box' : 'player2Box');

    if (!overlay || !playerBox) return;

    overlay.innerHTML = `
        <div class="big-emoji-overlay">
            <div class="big-emoji">${emoji}</div>
        </div>
    `;

    overlay.classList.add('active');
    playerBox.classList.add('has-overlay');

    setTimeout(() => {
        overlay.classList.remove('active');
        playerBox.classList.remove('has-overlay');
        setTimeout(() => {
            overlay.innerHTML = '';
        }, 300);
    }, 2500);
}

window.sendEmojiMessage = async function(emoji, emojiName, action) {
    if (!window.currentGame || !window.currentPlayer) return;
    if (window.currentGame.status !== 'active' && window.currentGame.status !== 'extra_turn') return;

    const targetPlayerId = window.currentGame.player1_id === window.currentPlayer.id
        ? window.currentGame.player2_id
        : window.currentGame.player1_id;

    if (!targetPlayerId) return;

    showBigEmojiOnCard(window.currentPlayer.id, emoji);

    const supabase = initSupabase();

    const messageData = {
        game_id: window.currentGame.id,
        from_player_id: window.currentPlayer.id,
        to_player_id: targetPlayerId,
        message: emoji,
        emoji_name: emojiName,
        emoji_action: action
    };

    try {
        await supabase.from('messages').insert([messageData]);
    } catch (err) {
        console.error('Mesaj hatası:', err);
    }
}

function setupMessageRealtime(gameId) {
    const supabase = initSupabase();

    if (window.messageChannel) {
        supabase.removeChannel(window.messageChannel);
    }

    window.messageChannel = supabase
        .channel(`messages-${gameId}`)
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: `game_id=eq.${gameId}`
        }, (payload) => {
            const message = payload.new;
            if (message.to_player_id === window.currentPlayer?.id) {
                showBigEmojiOnCard(message.from_player_id, message.message);
            }
        })
        .subscribe();
}

async function checkExtraTurn(gameId, winnerId) {
    const supabase = initSupabase();

    const { data: game } = await supabase
        .from('games')
        .select('*')
        .eq('id', gameId)
        .maybeSingle();

    if (!game || game.extra_turn_given || game.player1_id !== winnerId) {
        return false;
    }

    await supabase
        .from('games')
        .update({
            extra_turn_given: true,
            is_extra_turn: true,
            current_turn: game.player2_id,
            status: 'extra_turn'
        })
        .eq('id', gameId);

    return true;
}

async function checkExtraTurnResult(gameId, playerId, isCorrect) {
    const supabase = initSupabase();

    const { data: game } = await supabase
        .from('games')
        .select('*')
        .eq('id', gameId)
        .maybeSingle();

    if (isCorrect) {
        await supabase
            .from('games')
            .update({
                status: 'finished',
                winner_id: null,
                is_extra_turn: false
            })
            .eq('id', gameId);

        window.showError('🤝 BERABERE! Rakip ekstra hakkını kullandı ve sayıyı buldu!');
    } else {
        await supabase
            .from('games')
            .update({
                status: 'finished',
                winner_id: game.player1_id,
                is_extra_turn: false
            })
            .eq('id', gameId);

        window.showError('🏆 EV SAHİBİ KAZANDI! Rakip ekstra hakkını kullanamadı.');
    }

    updateGameStatus();
    updatePlayerStatus();
}

async function loadOpponentStats() {
    if (!window.currentGame) return;

    const supabase = initSupabase();

    const { data: player1Stats } = await supabase
        .from('users')
        .select('wins, losses, draws, elo_rating')
        .eq('id', window.currentGame.player1_id)
        .maybeSingle();

    if (player1Stats) {
        document.getElementById('player1Wins').textContent = player1Stats.wins || 0;
        document.getElementById('player1Losses').textContent = player1Stats.losses || 0;
        document.getElementById('player1Draws').textContent = player1Stats.draws || 0;
    }

    if (window.currentGame.player2_id) {
        const { data: player2Stats } = await supabase
            .from('users')
            .select('wins, losses, draws, elo_rating')
            .eq('id', window.currentGame.player2_id)
            .maybeSingle();

        if (player2Stats) {
            document.getElementById('player2Wins').textContent = player2Stats.wins || 0;
            document.getElementById('player2Losses').textContent = player2Stats.losses || 0;
            document.getElementById('player2Draws').textContent = player2Stats.draws || 0;
        }
    }
}

function updatePlayerStatus() {
    if (!window.currentGame) return;

    const player1StatusEl = document.getElementById('player1Status');
    const player2StatusEl = document.getElementById('player2Status');
    const player1Box = document.getElementById('player1Box');
    const player2Box = document.getElementById('player2Box');
    const player1Emojis = document.getElementById('player1Emojis');
    const player2Emojis = document.getElementById('player2Emojis');

    if (player1Emojis) {
        player1Emojis.style.display = window.currentGame.player1_id === window.currentPlayer?.id ? 'flex' : 'none';
    }
    if (player2Emojis) {
        player2Emojis.style.display = window.currentGame.player2_id === window.currentPlayer?.id ? 'flex' : 'none';
    }

    if (window.currentGame.player1_id === window.currentPlayer?.id) {
        if (player1StatusEl) player1StatusEl.textContent = '👋 SİZ';
    } else {
        if (player1StatusEl) player1StatusEl.textContent = window.currentGame.player2_id ? '👥 Hazır' : '⏳ Bekleniyor';
    }

    if (window.currentGame.player2_id) {
        if (window.currentGame.player2_id === window.currentPlayer?.id) {
            if (player2StatusEl) player2StatusEl.textContent = '👋 SİZ';
        } else {
            if (player2StatusEl) player2StatusEl.textContent = '👥 Hazır';
        }
    } else {
        if (player2StatusEl) player2StatusEl.textContent = '⏳ Bekleniyor...';
    }

    if ((window.currentGame.status === 'active' || window.currentGame.status === 'extra_turn') && player1Box && player2Box) {
        const isMyTurn = window.currentGame.current_turn === window.currentPlayer?.id;
        if (isMyTurn) {
            if (window.currentGame.player1_id === window.currentPlayer?.id) {
                player1Box.classList.add('active-turn');
                player2Box.classList.remove('active-turn');
            } else {
                player2Box.classList.add('active-turn');
                player1Box.classList.remove('active-turn');
            }
        } else {
            player1Box.classList.remove('active-turn');
            player2Box.classList.remove('active-turn');
        }
    }

    if (window.currentGame.status === 'finished') {
        const winnerId = window.currentGame.winner_id;

        if (winnerId === null) {
            player1Box.classList.add('winner-animation');
            player2Box.classList.add('winner-animation');
            player1Box.style.borderColor = '#ffd700';
            player2Box.style.borderColor = '#ffd700';
        } else if (winnerId === window.currentGame.player1_id) {
            player1Box.classList.add('winner-animation');
            player2Box.classList.remove('winner-animation');
            player2Box.style.borderColor = '';
            if (winnerId === window.currentPlayer?.id && !window.celebrated) {
                window.celebrated = true;
                if (typeof confetti === 'function') {
                    confetti({ particleCount: 200, spread: 70, origin: { y: 0.6 } });
                    setTimeout(() => confetti({ particleCount: 100, spread: 100, origin: { y: 0.6, x: 0.2 } }), 200);
                    setTimeout(() => confetti({ particleCount: 100, spread: 100, origin: { y: 0.6, x: 0.8 } }), 400);
                }
            }
        } else if (winnerId === window.currentGame.player2_id) {
            player2Box.classList.add('winner-animation');
            player1Box.classList.remove('winner-animation');
            player1Box.style.borderColor = '';
            if (winnerId === window.currentPlayer?.id && !window.celebrated) {
                window.celebrated = true;
                if (typeof confetti === 'function') {
                    confetti({ particleCount: 200, spread: 70, origin: { y: 0.6 } });
                    setTimeout(() => confetti({ particleCount: 100, spread: 100, origin: { y: 0.6, x: 0.2 } }), 200);
                    setTimeout(() => confetti({ particleCount: 100, spread: 100, origin: { y: 0.6, x: 0.8 } }), 400);
                }
            }
        }
    } else {
        if (player1Box) {
            player1Box.classList.remove('winner-animation');
            player1Box.style.borderColor = '';
        }
        if (player2Box) {
            player2Box.classList.remove('winner-animation');
            player2Box.style.borderColor = '';
        }
        window.celebrated = false;
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

function showEloNotification(eloResult, isDraw, isWinner) {
    const notification = document.createElement('div');
    notification.className = 'custom-notification';

    if (isDraw) {
        notification.innerHTML = `
            <div class="notification-content" style="background: linear-gradient(135deg, #ffc107, #ff9800);">
                <span>🤝 BERABERLİK! ELO Değişimi: ${eloResult.winnerChange > 0 ? '+' : ''}${eloResult.winnerChange} / ${eloResult.loserChange > 0 ? '+' : ''}${eloResult.loserChange}</span>
            </div>
        `;
    } else if (isWinner) {
        notification.innerHTML = `
            <div class="notification-content" style="background: linear-gradient(135deg, #4caf50, #2e7d32);">
                <span>⭐ KAZANDINIZ! ELO: ${eloResult.winnerChange > 0 ? '+' : ''}${eloResult.winnerChange} puan (${eloResult.newWinnerElo})</span>
            </div>
        `;
    } else {
        notification.innerHTML = `
            <div class="notification-content" style="background: linear-gradient(135deg, #f44336, #d32f2f);">
                <span>😢 KAYBETTİNİZ! ELO: ${eloResult.loserChange} puan (${eloResult.newLoserElo})</span>
            </div>
        `;
    }

    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 4000);
}

function addFriendButtonToGame() {
    if (document.getElementById('addFriendInGameBtn')) return;

    const gameHeader = document.querySelector('.game-header');
    if (!gameHeader || !window.currentGame || !window.currentPlayer) return;

    const opponentId = window.currentGame.player1_id === window.currentPlayer.id
        ? window.currentGame.player2_id
        : window.currentGame.player1_id;

    if (!opponentId) return;

    const friendBtn = document.createElement('button');
    friendBtn.id = 'addFriendInGameBtn';
    friendBtn.className = 'btn-add-friend-game';
    friendBtn.innerHTML = '➕ Arkadaş Ekle';
    friendBtn.title = 'Rakibini arkadaş olarak ekle';
    friendBtn.onclick = () => {
        if (typeof window.sendFriendRequestToOpponent === 'function') {
            window.sendFriendRequestToOpponent();
        } else {
            console.error('sendFriendRequestToOpponent fonksiyonu bulunamadı!');
            window.showError('Arkadaşlık sistemi yüklenemedi! Sayfayı yenileyin.');
        }
    };

    friendBtn.style.marginLeft = 'auto';
    gameHeader.appendChild(friendBtn);
}

window.initGame = async function() {
    console.log('initGame başlatılıyor...');

    const urlParams = new URLSearchParams(window.location.search);
    const gameId = urlParams.get('gameId');
    const urlPlayerId = urlParams.get('playerId');

    console.log('gameId:', gameId, 'playerId:', urlPlayerId);

    if (!gameId || !urlPlayerId) {
        console.log('gameId veya playerId eksik, lobbyye yönlendiriliyor...');
        window.location.href = 'lobby.html';
        return;
    }

    const supabase = initSupabase();

    try {
        const { data: player, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', urlPlayerId)
            .maybeSingle();

        if (error || !player) {
            console.error('Get player error:', error);
            window.location.href = 'lobby.html';
            return;
        }

        window.currentPlayer = { id: player.id, username: player.username };
        console.log('currentPlayer:', window.currentPlayer);

        sessionStorage.setItem('currentUser', JSON.stringify({
            id: player.id,
            username: player.username
        }));

        await loadGame(gameId);
        setupGameRealtime(gameId);
        setupMessageRealtime(gameId);
        await loadOpponentStats();

        const guessButton = document.getElementById('guessButton');
        const guessInput = document.getElementById('guessInput');

        if (guessButton) {
            guessButton.removeEventListener('click', window.makeGuess);
            guessButton.addEventListener('click', () => window.makeGuess());
            console.log('Tahmin butonu bağlandı');
        } else {
            console.error('guessButton bulunamadı!');
        }

        if (guessInput) {
            setupNumericInput(guessInput);
            guessInput.removeEventListener('keypress', guessInput._keypressHandler);
            guessInput._keypressHandler = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    window.makeGuess();
                }
            };
            guessInput.addEventListener('keypress', guessInput._keypressHandler);
            console.log('Input Enter olayı bağlandı');
        } else {
            console.error('guessInput bulunamadı!');
        }

        if (window.gameCheckInterval) clearInterval(window.gameCheckInterval);
        window.gameCheckInterval = setInterval(() => {
            if (window.currentGame && window.currentGame.status !== 'finished') {
                checkGameUpdates(gameId);
            }
        }, 2000);

        setTimeout(() => addFriendButtonToGame(), 1000);

    } catch (error) {
        console.error('Init game error:', error);
    }
}

async function checkGameUpdates(gameId) {
    const supabase = initSupabase();

    try {
        const { data: game, error } = await supabase
            .from('games')
            .select('*')
            .eq('id', gameId)
            .maybeSingle();

        if (error) {
            console.error('Check update error:', error);
            return;
        }

        if (game && window.currentGame) {
            if (game.status !== window.currentGame.status ||
                game.player2_id !== window.currentGame.player2_id ||
                game.current_turn !== window.currentGame.current_turn ||
                game.winner_id !== window.currentGame.winner_id ||
                game.is_extra_turn !== window.currentGame.is_extra_turn) {
                window.currentGame = game;
                updateGameStatus();
                updatePlayerNames();
                updateSecretDisplay();
                updatePlayerStatus();
                updateInputMaxLength(game.digit_count || 6);
                loadGuesses(gameId);
                loadOpponentStats();
            }
        }
    } catch (error) {
        console.error('Check update error:', error);
    }
}

function setupGameRealtime(gameId) {
    const supabase = initSupabase();

    if (window.gameChannel) {
        supabase.removeChannel(window.gameChannel);
    }
    if (window.guessesChannel) {
        supabase.removeChannel(window.guessesChannel);
    }

    window.gameChannel = supabase
        .channel(`game-updates-${gameId}`)
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'games',
            filter: `id=eq.${gameId}`
        }, (payload) => {
            if (payload.new) {
                const oldStatus = window.currentGame?.status;
                window.currentGame = payload.new;
                updateGameStatus();
                updatePlayerNames();
                updateSecretDisplay();
                updatePlayerStatus();
                updateInputMaxLength(payload.new.digit_count || 6);
                loadGuesses(gameId);
                loadOpponentStats();

                if (oldStatus === 'waiting' && payload.new.status === 'active') {
                    const turnIndicator = document.getElementById('turnIndicator');
                    if (turnIndicator) {
                        turnIndicator.innerHTML = '🎮 <strong>RAKİP KATILDI! OYUN BAŞLIYOR!</strong>';
                        setTimeout(() => updateGameStatus(), 2000);
                    }
                }
            }
        })
        .subscribe();

    window.guessesChannel = supabase
        .channel(`guess-updates-${gameId}`)
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'guesses',
            filter: `game_id=eq.${gameId}`
        }, () => {
            loadGuesses(gameId);
            checkGameUpdates(gameId);
        })
        .subscribe();
}

async function updatePlayerNames() {
    if (!window.currentGame) return;

    const supabase = initSupabase();

    try {
        const { data: player1 } = await supabase
            .from('users')
            .select('username, avatar')
            .eq('id', window.currentGame.player1_id)
            .maybeSingle();

        const player1NameEl = document.getElementById('player1Name');
        const player1AvatarEl = document.querySelector('#player1Box .player-avatar');

        if (player1NameEl) player1NameEl.textContent = player1?.username || 'Oyuncu 1';
        if (player1AvatarEl) player1AvatarEl.textContent = player1?.avatar || '👤';

        if (window.currentGame.player2_id) {
            const { data: player2 } = await supabase
                .from('users')
                .select('username, avatar')
                .eq('id', window.currentGame.player2_id)
                .maybeSingle();
            const player2NameEl = document.getElementById('player2Name');
            const player2AvatarEl = document.querySelector('#player2Box .player-avatar');

            if (player2NameEl) player2NameEl.textContent = player2?.username || 'Oyuncu 2';
            if (player2AvatarEl) player2AvatarEl.textContent = player2?.avatar || '🤖';
        } else {
            const player2NameEl = document.getElementById('player2Name');
            const player2AvatarEl = document.querySelector('#player2Box .player-avatar');

            if (player2NameEl) player2NameEl.textContent = 'Bekleniyor...';
            if (player2AvatarEl) player2AvatarEl.textContent = '🤖';
        }
    } catch (error) {
        console.error('Update player names error:', error);
    }
}

window.loadGame = async function(gameId) {
    const supabase = initSupabase();

    try {
        const { data: game, error } = await supabase
            .from('games')
            .select('*')
            .eq('id', gameId)
            .maybeSingle();

        if (error) {
            console.error('Load game error:', error);
            return;
        }

        if (!game) {
            alert('Oyun bulunamadı!');
            window.location.href = 'lobby.html';
            return;
        }

        window.currentGame = game;
        console.log('currentGame yüklendi:', window.currentGame);

        const roomCodeSpan = document.getElementById('roomCode');
        if (roomCodeSpan && game.room_code) {
            roomCodeSpan.textContent = game.room_code;
        }

        updateInputMaxLength(game.digit_count || 6);

        await updatePlayerNames();
        updateSecretDisplay();
        updateGameStatus();
        updatePlayerStatus();
        await loadGuesses(gameId);
        await loadOpponentStats();

    } catch (error) {
        console.error('Load game error:', error);
    }
}

window.updateGameStatus = function() {
    const statusDiv = document.getElementById('gameStatus');
    const turnIndicator = document.getElementById('turnIndicator');
    const guessInput = document.getElementById('guessInput');
    const guessButton = document.getElementById('guessButton');

    if (!window.currentGame) return;

    if (turnIndicator) {
        if (window.currentGame.status === 'waiting') {
            turnIndicator.innerHTML = '⏳ <strong>Rakip bekleniyor...</strong><br><span style="font-size:12px">Bir oyuncu katılana kadar bekleyin</span>';
            turnIndicator.className = 'turn-indicator waiting';
            if (guessInput) guessInput.disabled = true;
            if (guessButton) guessButton.disabled = true;
        } else if (window.currentGame.status === 'extra_turn') {
            const isMyExtraTurn = window.currentGame.current_turn === window.currentPlayer?.id;
            if (isMyExtraTurn) {
                turnIndicator.innerHTML = '🔄 <strong style="color: white;">EKSTRA TAHMİN HAKKI!</strong><br><span style="font-size:12px">Rakip kazandı! Sayıyı bulursanız BERABERE!</span>';
                turnIndicator.className = 'turn-indicator my-turn';
                if (guessInput) {
                    guessInput.disabled = false;
                    guessInput.focus();
                }
                if (guessButton) guessButton.disabled = false;
            } else {
                turnIndicator.innerHTML = '⏳ <strong style="color: white;">EKSTRA HAK BEKLENİYOR...</strong><br><span style="font-size:12px">Rakip ekstra tahmin hakkını kullanıyor</span>';
                turnIndicator.className = 'turn-indicator opponent-turn';
                if (guessInput) guessInput.disabled = true;
                if (guessButton) guessButton.disabled = true;
            }
        } else if (window.currentGame.status === 'finished') {
            let winnerText = '';
            if (window.currentGame.winner_id === null) {
                winnerText = '🤝 BERABERE!';
                turnIndicator.style.background = 'linear-gradient(135deg, #ffd700, #ff8c00)';
            } else if (window.currentGame.winner_id === window.currentPlayer?.id) {
                winnerText = 'SİZ KAZANDINIZ! 🎉';
                turnIndicator.style.background = 'linear-gradient(135deg, #4caf50, #2e7d32)';
            } else {
                winnerText = 'RAKİP KAZANDI 😢';
                turnIndicator.style.background = 'linear-gradient(135deg, #ff6b35, #e65100)';
            }
            turnIndicator.innerHTML = `🏆 <strong>${winnerText}</strong>`;
            turnIndicator.className = 'turn-indicator finished';
            if (guessInput) guessInput.disabled = true;
            if (guessButton) guessButton.disabled = true;
        } else if (window.currentGame.status === 'active') {
            const isMyTurn = window.currentGame.current_turn === window.currentPlayer?.id;
            if (isMyTurn) {
                turnIndicator.innerHTML = '🎯 <strong style="color: white;">SIRADA SİZSİNİZ!</strong> Tahmin yapın';
                turnIndicator.className = 'turn-indicator my-turn';
                if (guessInput) {
                    guessInput.disabled = false;
                    guessInput.focus();
                }
                if (guessButton) guessButton.disabled = false;
            } else {
                turnIndicator.innerHTML = '⏳ <strong style="color: white;">RAKİBİN SIRASI</strong> Tahmin yapması bekleniyor...';
                turnIndicator.className = 'turn-indicator opponent-turn';
                if (guessInput) guessInput.disabled = true;
                if (guessButton) guessButton.disabled = true;
            }
        }
    }

    if (statusDiv) {
        if (window.currentGame.status === 'waiting') {
            statusDiv.textContent = '⏳ Rakip bekleniyor...';
        } else if (window.currentGame.status === 'extra_turn') {
            statusDiv.textContent = '🔄 EXTRA TAHMİN HAKKI - Beraberlik şansı!';
        } else if (window.currentGame.status === 'finished') {
            if (window.currentGame.winner_id === null) {
                statusDiv.textContent = `🤝 BERABERE!`;
            } else if (window.currentGame.winner_id === window.currentPlayer?.id) {
                statusDiv.textContent = `🏆 SİZ KAZANDINIZ! 🎉`;
            } else {
                statusDiv.textContent = `😢 RAKİP KAZANDI`;
            }
        } else if (window.currentGame.status === 'active') {
            statusDiv.textContent = '🎮 Oyun Devam Ediyor';
        }
    }
}

window.loadGuesses = async function(gameId) {
    const supabase = initSupabase();

    try {
        const { data: guesses, error } = await supabase
            .from('guesses')
            .select('*')
            .eq('game_id', gameId)
            .order('created_at', { ascending: true });

        if (error) {
            console.error('Load guesses error:', error);
            return;
        }

        await window.displayGuessesSideBySide(guesses || []);
    } catch (error) {
        console.error('Load guesses error:', error);
    }
}

function formatGuessFeedback(guess, digits) {
    let html = '';
    const guessDigits = guess.guess.split('');

    let greenPositions = guess.green_positions;
    let yellowPositions = guess.yellow_positions;

    if (greenPositions && typeof greenPositions === 'object' && !Array.isArray(greenPositions)) {
        greenPositions = Object.values(greenPositions).filter(v => v !== null && v !== false);
    }
    if (yellowPositions && typeof yellowPositions === 'object' && !Array.isArray(yellowPositions)) {
        yellowPositions = Object.values(yellowPositions).filter(v => v !== null && v !== false);
    }

    greenPositions = greenPositions || [];
    yellowPositions = yellowPositions || [];

    for (let i = 0; i < digits; i++) {
        let status = 'not-exist';
        if (greenPositions.includes(i)) {
            status = 'correct-position';
        } else if (yellowPositions.includes(i)) {
            status = 'wrong-position';
        }
        html += `<div class="feedback-digit ${status}">${guessDigits[i] || '?'}</div>`;
    }
    return html;
}

function createNewGuessCards() {
    const historySection = document.querySelector('.history-section');
    if (!historySection) return;

    const oldTable = document.getElementById('guessesHistory');
    if (oldTable) {
        oldTable.style.display = 'none';
    }

    if (document.getElementById('myGuessesList')) return;

    const newHTML = `
        <div class="my-guesses-card">
            <div class="guesses-header">
                <div class="player-guess-avatar">👤</div>
                <h3>SENİN TAHMİNLERİN</h3>
            </div>
            <div class="guesses-list" id="myGuessesList">
                <div class="guess-history-empty">📭 Henüz tahmin yapmadın</div>
            </div>
        </div>
        <div class="opponent-guesses-card">
            <div class="guesses-header">
                <div class="player-guess-avatar">🤖</div>
                <h3>RAKİBİN TAHMİNLERİ</h3>
            </div>
            <div class="guesses-list" id="opponentGuessesList">
                <div class="guess-history-empty">🤖 Rakip henüz tahmin yapmadı</div>
            </div>
        </div>
    `;

    const legend = historySection.querySelector('.legend');
    if (legend) {
        legend.insertAdjacentHTML('afterend', newHTML);
    } else {
        historySection.insertAdjacentHTML('beforeend', newHTML);
    }
}

window.displayGuessesSideBySide = async function(guesses) {
    let myGuessesList = document.getElementById('myGuessesList');
    let opponentGuessesList = document.getElementById('opponentGuessesList');

    const oldHistoryDiv = document.getElementById('guessesHistory');
    if (oldHistoryDiv) {
        oldHistoryDiv.style.display = 'none';
    }

    if (!myGuessesList || !opponentGuessesList) {
        createNewGuessCards();
        setTimeout(() => window.displayGuessesSideBySide(guesses), 100);
        return;
    }

    if (!guesses || guesses.length === 0) {
        myGuessesList.innerHTML = '<div class="guess-history-empty">📭 Henüz tahmin yapmadın</div>';
        opponentGuessesList.innerHTML = '<div class="guess-history-empty">🤖 Rakip henüz tahmin yapmadı</div>';
        return;
    }

    const supabase = initSupabase();

    let opponentName = 'RAKİP';
    let opponentAvatar = '🤖';
    if (window.currentGame && window.currentPlayer) {
        const opponentId = window.currentGame.player1_id === window.currentPlayer.id
            ? window.currentGame.player2_id
            : window.currentGame.player1_id;

        if (opponentId) {
            try {
                const { data: opponent } = await supabase
                    .from('users')
                    .select('username, avatar')
                    .eq('id', opponentId)
                    .maybeSingle();
                if (opponent) {
                    opponentName = opponent.username || 'RAKİP';
                    opponentAvatar = opponent.avatar || '🤖';
                }
            } catch (err) {
                console.error('Rakip ismi alınamadı:', err);
            }
        }
    }

    let myAvatar = '👤';
    if (window.currentPlayer) {
        try {
            const { data: myData } = await supabase
                .from('users')
                .select('avatar')
                .eq('id', window.currentPlayer.id)
                .maybeSingle();
            if (myData && myData.avatar) {
                myAvatar = myData.avatar;
            }
        } catch (err) {
            console.error('Avatar alınamadı:', err);
        }
    }

    const myGuessHeader = document.querySelector('#myGuessesList')?.closest('.my-guesses-card')?.querySelector('.guesses-header h3');
    const opponentGuessHeader = document.querySelector('#opponentGuessesList')?.closest('.opponent-guesses-card')?.querySelector('.guesses-header h3');

    if (myGuessHeader) myGuessHeader.innerHTML = `👤 ${window.currentPlayer?.username || 'SENİN'} TAHMİNLERİN`;
    if (opponentGuessHeader) opponentGuessHeader.innerHTML = `👥 ${opponentName.toUpperCase()} TAHMİNLERİ`;

    const myAvatarEl = document.querySelector('#myGuessesList')?.closest('.my-guesses-card')?.querySelector('.player-guess-avatar');
    const opponentAvatarEl = document.querySelector('#opponentGuessesList')?.closest('.opponent-guesses-card')?.querySelector('.player-guess-avatar');
    if (myAvatarEl) myAvatarEl.textContent = myAvatar;
    if (opponentAvatarEl) opponentAvatarEl.textContent = opponentAvatar;

    const digits = window.currentGame?.digit_count || 6;

    const myGuesses = guesses.filter(g => g.player_id === window.currentPlayer?.id);
    const opponentGuesses = guesses.filter(g => g.player_id !== window.currentPlayer?.id);

    // SADECE SAYI VE RENKLİ KUTULAR - Gereksiz bilgiler yok!
    // game.js - displayGuessesSideBySide fonksiyonu (yaklaşık 700-730. satırlar)

// Bu kısmı:

    if (myGuesses.length === 0) {
        myGuessesList.innerHTML = '<div class="guess-history-empty">📭 Henüz tahmin yapmadın</div>';
    } else {
        myGuessesList.innerHTML = myGuesses.map((guess) => {
            return `
            <div class="guess-item">
                <div class="guess-feedback-row">
                    ${formatGuessFeedback(guess, digits)}
                </div>
            </div>
        `;
        })
    }

    if (opponentGuesses.length === 0) {
        opponentGuessesList.innerHTML = '<div class="guess-history-empty">🤖 Rakip henüz tahmin yapmadı</div>';
    } else {
        opponentGuessesList.innerHTML = opponentGuesses.map((guess) => {
            return `
            <div class="guess-item">
                <div class="guess-feedback-row">
                    ${formatGuessFeedback(guess, digits)}
                </div>
            </div>
        `;
        })
    }

// ŞU ŞEKİLE GETİRİN (.join('') EKLEYİN):

    if (myGuesses.length === 0) {
        myGuessesList.innerHTML = '<div class="guess-history-empty">📭 Henüz tahmin yapmadın</div>';
    } else {
        myGuessesList.innerHTML = myGuesses.map((guess) => {
            return `
            <div class="guess-item">
                <div class="guess-feedback-row">
                    ${formatGuessFeedback(guess, digits)}
                </div>
            </div>
        `;
        }).join('');  // <--- .join('') EKLENDİ
    }

    if (opponentGuesses.length === 0) {
        opponentGuessesList.innerHTML = '<div class="guess-history-empty">🤖 Rakip henüz tahmin yapmadı</div>';
    } else {
        opponentGuessesList.innerHTML = opponentGuesses.map((guess) => {
            return `
            <div class="guess-item">
                <div class="guess-feedback-row">
                    ${formatGuessFeedback(guess, digits)}
                </div>
            </div>
        `;
        }).join('');  // <--- .join('') EKLENDİ
    }
}

async function finishGameWithElo(winnerId, loserId, isDraw = false) {
    console.log(`Oyun sonu: Kazanan: ${winnerId}, Kaybeden: ${loserId}, Beraberlik: ${isDraw}`);

    const eloResult = await updateEloRatings(winnerId, loserId, isDraw);

    if (eloResult) {
        const isWinner = window.currentPlayer?.id === winnerId;
        showEloNotification(eloResult, isDraw, isWinner);
        console.log(`Elo güncellendi: Kazanan +${eloResult.winnerChange} (${eloResult.newWinnerElo}), Kaybeden ${eloResult.loserChange} (${eloResult.newLoserElo})`);
    } else {
        console.error('Elo güncellemesi başarısız!');
    }

    return eloResult;
}

window.makeGuess = async function() {
    console.log('makeGuess çağrıldı!');

    const guessInput = document.getElementById('guessInput');
    const guess = guessInput?.value.trim();
    const digits = window.currentGame?.digit_count || 6;

    console.log('Tahmin:', guess, 'Digits:', digits);

    if (!guess || guess.length !== digits || isNaN(guess)) {
        window.showError(`Lütfen ${digits} haneli geçerli bir sayı girin!`);
        return;
    }

    if (!window.currentGame || window.currentGame.current_turn !== window.currentPlayer?.id) {
        window.showError('Sıra sizde değil!');
        return;
    }

    if (window.currentGame.status !== 'active' && window.currentGame.status !== 'extra_turn') {
        window.showError('Oyun aktif değil!');
        return;
    }

    const guessButton = document.getElementById('guessButton');
    if (guessButton) guessButton.disabled = true;
    if (guessInput) guessInput.disabled = true;

    const supabase = initSupabase();

    try {
        const opponentSecret = window.currentGame.player1_id === window.currentPlayer.id
            ? window.currentGame.player2_secret
            : window.currentGame.player1_secret;

        const evaluation = window.evaluateGuess(guess, opponentSecret, digits);
        const guessNumber = await window.getNextGuessNumber(window.currentGame.id, window.currentPlayer.id);

        const { error: guessError } = await supabase
            .from('guesses')
            .insert([{
                game_id: window.currentGame.id,
                player_id: window.currentPlayer.id,
                guess: guess,
                green_positions: evaluation.green,
                yellow_positions: evaluation.yellow,
                guess_number: guessNumber
            }]);

        if (guessError) {
            console.error('Make guess error:', guessError);
            window.showError('Tahmin kaydedilemedi: ' + guessError.message);
            if (guessInput) guessInput.disabled = false;
            if (guessButton) guessButton.disabled = false;
            return;
        }

        if (guessInput) guessInput.value = '';
        await loadGuesses(window.currentGame.id);

        if (evaluation.green.length === digits) {
            if (window.currentGame.status === 'extra_turn') {
                await checkExtraTurnResult(window.currentGame.id, window.currentPlayer.id, true);
                const opponentId = window.currentGame.player1_id === window.currentPlayer.id
                    ? window.currentGame.player2_id
                    : window.currentGame.player1_id;
                await finishGameWithElo(window.currentPlayer.id, opponentId, true);
            }
            else if (window.currentGame.player1_id === window.currentPlayer.id) {
                const extraGiven = await checkExtraTurn(window.currentGame.id, window.currentPlayer.id);
                if (extraGiven) {
                    window.showError('🎉 TEBRİKLER! Sayıyı buldunuz!\n🔄 Rakibe 1 ekstra tahmin hakkı veriliyor!');
                    setTimeout(() => {
                        updateGameStatus();
                    }, 1000);
                } else {
                    await supabase
                        .from('games')
                        .update({
                            status: 'finished',
                            winner_id: window.currentPlayer.id
                        })
                        .eq('id', window.currentGame.id);
                    window.showError('🎉 TEBRİKLER! Sayıyı buldunuz! 🎉');
                    const opponentId = window.currentGame.player2_id;
                    await finishGameWithElo(window.currentPlayer.id, opponentId, false);
                }
            }
            else {
                await supabase
                    .from('games')
                    .update({
                        status: 'finished',
                        winner_id: window.currentPlayer.id
                    })
                    .eq('id', window.currentGame.id);
                window.showError('🎉 TEBRİKLER! Sayıyı buldunuz! 🎉');
                const opponentId = window.currentGame.player1_id;
                await finishGameWithElo(window.currentPlayer.id, opponentId, false);
            }
        }
        else {
            if (window.currentGame.status !== 'extra_turn') {
                const nextTurn = window.currentGame.player1_id === window.currentPlayer.id
                    ? window.currentGame.player2_id
                    : window.currentGame.player1_id;

                await supabase
                    .from('games')
                    .update({ current_turn: nextTurn })
                    .eq('id', window.currentGame.id);
            } else {
                await checkExtraTurnResult(window.currentGame.id, window.currentPlayer.id, false);
                const opponentId = window.currentGame.player1_id;
                await finishGameWithElo(opponentId, window.currentPlayer.id, false);
            }
        }

    } catch (error) {
        console.error('Make guess error:', error);
        window.showError('Bir hata oluştu: ' + error.message);
        if (guessInput) guessInput.disabled = false;
        if (guessButton) guessButton.disabled = false;
    }
}

window.evaluateGuess = function(guess, secret, digits) {
    if (!secret) return { green: [], yellow: [] };

    const guessDigits = guess.split('');
    const secretDigits = secret.split('');

    const green = [];
    const yellow = [];

    for (let i = 0; i < digits; i++) {
        if (guessDigits[i] === secretDigits[i]) {
            green.push(i);
        }
    }

    const usedSecret = secretDigits.map((_, i) => green.includes(i));
    const usedGuess = guessDigits.map((_, i) => green.includes(i));

    for (let i = 0; i < digits; i++) {
        if (usedGuess[i]) continue;
        for (let j = 0; j < digits; j++) {
            if (!usedSecret[j] && guessDigits[i] === secretDigits[j]) {
                yellow.push(i);
                usedSecret[j] = true;
                break;
            }
        }
    }

    return { green, yellow };
}

window.getNextGuessNumber = async function(gameId, playerId) {
    const supabase = initSupabase();
    const { data: guesses } = await supabase
        .from('guesses')
        .select('guess_number')
        .eq('game_id', gameId)
        .eq('player_id', playerId);
    return (guesses?.length || 0) + 1;
}

window.leaveGame = function() {
    const supabase = initSupabase();
    if (window.gameCheckInterval) clearInterval(window.gameCheckInterval);
    if (window.gameChannel) supabase.removeChannel(window.gameChannel);
    if (window.guessesChannel) supabase.removeChannel(window.guessesChannel);
    if (window.messageChannel) supabase.removeChannel(window.messageChannel);
    window.location.href = 'lobby.html';
}

window.showError = function(message) {
    const errorDiv = document.getElementById('errorMessage');
    if (errorDiv) {
        errorDiv.textContent = message;
        setTimeout(() => { errorDiv.textContent = ''; }, 3000);
    } else {
        alert(message);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM yüklendi, path:', window.location.pathname);
    if (window.location.pathname.includes('game.html')) {
        window.initGame();
    }
});