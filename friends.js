// friends.js
let friendsChannel = null;
let friendsList = [];
let pendingRequests = [];

window.initFriendsSystem = async function(currentPlayerId) {
    window.currentPlayerForFriends = { id: currentPlayerId };

    const supabase = initSupabase();

    await loadFriendsList();
    await loadPendingRequests();
    setupFriendsRealtime();

    if (window.location.pathname.includes('lobby.html')) {
        createFriendsModal();
        createFriendsButton();
        checkPrivateInvitations();
        createPrivateChallengeModal();
        createSecretInputModal();

        // SOHBET SİSTEMİ - GECİKME KALDIRILDI, HEMEN OLUŞTUR
        if (typeof createChatModal === 'function') {
            createChatModal();
            addChatButtonToLobby();
        } else {
            console.log('chat.js yüklenmedi, sohbet sistemi aktif değil');
        }

        setInterval(() => {
            if (window.currentPlayerForFriends) {
                checkPrivateInvitations();
            }
        }, 10000);
    }

    return true;
}

function createFriendsButton() {
    if (document.getElementById('friendsButton')) return;

    let rightButtons = document.querySelector('.game-header .right-buttons');

    if (!rightButtons) {
        const header = document.querySelector('.game-header');
        if (header) {
            rightButtons = document.createElement('div');
            rightButtons.className = 'right-buttons';
            header.appendChild(rightButtons);
        }
    }

    if (rightButtons && !document.getElementById('friendsButton')) {
        const friendsBtn = document.createElement('button');
        friendsBtn.id = 'friendsButton';
        friendsBtn.className = 'btn-friends';
        friendsBtn.innerHTML = '👥 Arkadaşlarım';
        friendsBtn.onclick = () => openFriendsModal();
        rightButtons.appendChild(friendsBtn);
    }
}

async function loadFriendsList() {
    const supabase = initSupabase();

    try {
        const { data: friendships, error } = await supabase
            .from('friendships')
            .select(`
                *,
                user:users!friendships_user_id_fkey (id, username, avatar, wins, total_games),
                friend:users!friendships_friend_id_fkey (id, username, avatar, wins, total_games)
            `)
            .or(`user_id.eq.${window.currentPlayerForFriends.id},friend_id.eq.${window.currentPlayerForFriends.id}`)
            .eq('status', 'accepted');

        if (error) throw error;

        friendsList = [];
        if (friendships) {
            friendships.forEach(friendship => {
                const friend = friendship.user_id === window.currentPlayerForFriends.id
                    ? friendship.friend
                    : friendship.user;
                if (friend) {
                    friendsList.push({
                        id: friend.id,
                        username: friend.username,
                        avatar: friend.avatar || '👤',
                        wins: friend.wins || 0,
                        total_games: friend.total_games || 0,
                        winRate: friend.total_games > 0
                            ? Math.round((friend.wins / friend.total_games) * 100)
                            : 0
                    });
                }
            });
        }

        updateFriendsListUI();

    } catch (error) {
        console.error('Arkadaş listesi yüklenemedi:', error);
    }
}

async function loadPendingRequests() {
    const supabase = initSupabase();

    try {
        const { data: requests, error } = await supabase
            .from('friendships')
            .select(`
                *,
                user:users!friendships_user_id_fkey (id, username, avatar)
            `)
            .eq('friend_id', window.currentPlayerForFriends.id)
            .eq('status', 'pending');

        if (error) throw error;

        pendingRequests = requests || [];
        updatePendingRequestsUI();

        if (pendingRequests.length > 0) {
            showFriendRequestNotification(pendingRequests.length);
        }

    } catch (error) {
        console.error('Bekleyen istekler yüklenemedi:', error);
    }
}

window.sendFriendRequest = async function(friendUsername) {
    const supabase = initSupabase();

    if (!friendUsername || friendUsername.trim() === '') {
        showCustomNotification('❌ Lütfen bir kullanıcı adı girin!', 'error');
        return false;
    }

    const { data: user, error: userError } = await supabase
        .from('users')
        .select('id, username')
        .ilike('username', friendUsername.trim())
        .maybeSingle();

    if (userError || !user) {
        showCustomNotification('❌ Kullanıcı bulunamadı!', 'error');
        return false;
    }

    if (user.id === window.currentPlayerForFriends.id) {
        showCustomNotification('❌ Kendinize arkadaşlık isteği gönderemezsiniz!', 'error');
        return false;
    }

    const { data: existing } = await supabase
        .from('friendships')
        .select('status')
        .or(`and(user_id.eq.${window.currentPlayerForFriends.id},friend_id.eq.${user.id}),and(user_id.eq.${user.id},friend_id.eq.${window.currentPlayerForFriends.id})`)
        .maybeSingle();

    if (existing) {
        if (existing.status === 'accepted') {
            showCustomNotification('❌ Bu kullanıcı zaten arkadaşınız!', 'error');
        } else if (existing.status === 'pending') {
            showCustomNotification('⏳ Zaten bekleyen bir isteğiniz var!', 'error');
        }
        return false;
    }

    const { error } = await supabase
        .from('friendships')
        .insert([{
            user_id: window.currentPlayerForFriends.id,
            friend_id: user.id,
            status: 'pending',
            created_at: new Date()
        }]);

    if (error) {
        showCustomNotification('❌ İstek gönderilemedi: ' + error.message, 'error');
        return false;
    }

    showCustomNotification(`✅ ${user.username} kullanıcısına arkadaşlık isteği gönderildi!`, 'success');
    return true;
}

window.sendFriendRequestToOpponent = async function() {
    if (!window.currentGame || !window.currentPlayer) {
        showCustomNotification('❌ Oyun bilgisi bulunamadı!', 'error');
        return;
    }

    const opponentId = window.currentGame.player1_id === window.currentPlayer.id
        ? window.currentGame.player2_id
        : window.currentGame.player1_id;

    if (!opponentId) {
        showCustomNotification('❌ Rakip bulunamadı!', 'error');
        return;
    }

    const supabase = initSupabase();

    const { data: opponent, error: opponentError } = await supabase
        .from('users')
        .select('username, avatar')
        .eq('id', opponentId)
        .maybeSingle();

    if (opponentError || !opponent) {
        showCustomNotification('❌ Rakip bilgisi alınamadı!', 'error');
        return;
    }

    const { data: existing } = await supabase
        .from('friendships')
        .select('status')
        .or(`and(user_id.eq.${window.currentPlayer.id},friend_id.eq.${opponentId}),and(user_id.eq.${opponentId},friend_id.eq.${window.currentPlayer.id})`)
        .maybeSingle();

    if (existing) {
        if (existing.status === 'accepted') {
            showCustomNotification('👥 Bu kullanıcı zaten arkadaşınız!', 'success');
        } else if (existing.status === 'pending') {
            showCustomNotification('⏳ Zaten bekleyen bir isteğiniz var!', 'info');
        }
        return;
    }

    const { error } = await supabase
        .from('friendships')
        .insert([{
            user_id: window.currentPlayer.id,
            friend_id: opponentId,
            status: 'pending',
            created_at: new Date()
        }]);

    if (error) {
        showCustomNotification('❌ İstek gönderilemedi: ' + error.message, 'error');
        return;
    }

    showCustomNotification(`✅ ${opponent.username} kullanıcısına arkadaşlık isteği gönderildi!`, 'success');
}

window.acceptFriendRequest = async function(requestId, friendId, friendName) {
    const supabase = initSupabase();

    const { error } = await supabase
        .from('friendships')
        .update({ status: 'accepted', updated_at: new Date() })
        .eq('id', requestId);

    if (error) {
        showCustomNotification('❌ İstek kabul edilemedi!', 'error');
        return;
    }

    showCustomNotification(`✅ ${friendName} ile arkadaş oldunuz!`, 'success');
    await loadFriendsList();
    await loadPendingRequests();
}

window.rejectFriendRequest = async function(requestId) {
    const supabase = initSupabase();

    const { error } = await supabase
        .from('friendships')
        .update({ status: 'rejected', updated_at: new Date() })
        .eq('id', requestId);

    if (error) {
        showCustomNotification('❌ İstek reddedilemedi!', 'error');
        return;
    }

    showCustomNotification('❌ Arkadaşlık isteği reddedildi', 'info');
    await loadPendingRequests();
}

window.removeFriend = async function(friendId, friendName) {
    if (!confirm(`${friendName} arkadaşınızı silmek istediğinize emin misiniz?`)) return;

    const supabase = initSupabase();

    const { error } = await supabase
        .from('friendships')
        .delete()
        .or(`and(user_id.eq.${window.currentPlayerForFriends.id},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${window.currentPlayerForFriends.id})`);

    if (error) {
        showCustomNotification('❌ Arkadaş silinemedi!', 'error');
        return;
    }

    showCustomNotification(`✅ ${friendName} arkadaşınızdan çıkarıldı`, 'success');
    await loadFriendsList();
}

// GİZLİ SAYI GİRİŞİ İÇİN MODAL OLUŞTUR
function createSecretInputModal() {
    if (document.getElementById('secretInputModal')) return;

    const modalHTML = `
        <div id="secretInputModal" class="modal" style="display: none;">
            <div class="modal-content">
                <div class="modal-header">
                    <h3>🔢 Gizli Sayınızı Girin</h3>
                    <span class="close" onclick="closeSecretInputModal()">&times;</span>
                </div>
                <div class="modal-body">
                    <p style="margin-bottom: 15px; color: #ccc;" id="secretInputDigitsText">6 haneli gizli sayınızı girin</p>
                    <input type="text" id="secretInputValue" placeholder="Gizli sayı" maxlength="10" inputmode="numeric" pattern="\d*" style="text-align: center; font-size: 24px; letter-spacing: 4px;">
                    <button id="secretConfirmButton" onclick="confirmSecretInput()" class="btn-success" style="margin-top: 20px;">✅ Düelloyu Kur</button>
                    <button onclick="closeSecretInputModal()" class="btn-secondary">İptal</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    window.closeSecretInputModal = function() {
        document.getElementById('secretInputModal').style.display = 'none';
        document.getElementById('secretInputValue').value = '';
        window.pendingSecretCallback = null;
    }

    document.getElementById('secretInputModal').addEventListener('click', function(e) {
        if (e.target === this) {
            closeSecretInputModal();
        }
    });
}

// Gizli sayı girişi için bekleme
window.pendingSecretCallback = null;

function showSecretInputModal(digitCount, callback, isInviter = true) {
    const modal = document.getElementById('secretInputModal');
    const text = document.getElementById('secretInputDigitsText');
    const input = document.getElementById('secretInputValue');
    let confirmBtn = document.getElementById('secretConfirmButton');

    if (!modal) {
        createSecretInputModal();
        confirmBtn = document.getElementById('secretConfirmButton');
    }

    if (text) {
        text.textContent = `${digitCount} haneli gizli sayınızı girin`;
    }
    if (input) {
        input.maxLength = digitCount;
        input.placeholder = `${digitCount} haneli sayı`;
        input.value = '';
        input.oninput = function(e) {
            this.value = this.value.replace(/[^0-9]/g, '');
        };
    }

    if (confirmBtn) {
        if (isInviter) {
            confirmBtn.innerHTML = '✅ Düelloyu Kur';
            confirmBtn.className = 'btn-success';
        } else {
            confirmBtn.innerHTML = '🎯 Düelloya Katıl';
            confirmBtn.className = 'btn-primary';
        }
    }

    window.pendingSecretCallback = callback;
    modal.style.display = 'flex';
    if (input) input.focus();
}

window.confirmSecretInput = function() {
    const input = document.getElementById('secretInputValue');
    const secret = input?.value.trim();

    if (!window.pendingSecretCallback) {
        closeSecretInputModal();
        return;
    }

    const digitCount = window.pendingSecretCallback.digitCount;

    if (!secret || secret.length !== digitCount || isNaN(secret)) {
        showCustomNotification(`❌ Geçerli ${digitCount} haneli bir sayı girin!`, 'error');
        return;
    }

    window.pendingSecretCallback.callback(secret);
    closeSecretInputModal();
}

// ÖZEL DÜELLO DAVETİ İÇİN MODAL OLUŞTUR
function createPrivateChallengeModal() {
    if (document.getElementById('privateChallengeModal')) return;

    const modalHTML = `
        <div id="privateChallengeModal" class="modal" style="display: none;">
            <div class="modal-content">
                <div class="modal-header">
                    <h3>⚔️ Özel Düello Daveti</h3>
                    <span class="close" onclick="closePrivateChallengeModal()">&times;</span>
                </div>
                <div class="modal-body">
                    <p style="margin-bottom: 20px;">Arkadaşınızı düelloya davet ediyorsunuz</p>
                    <div class="digit-buttons">
                        <button onclick="selectDigitForPrivateChallenge(6)" class="digit-btn">6 Basamak</button>
                        <button onclick="selectDigitForPrivateChallenge(7)" class="digit-btn">7 Basamak</button>
                        <button onclick="selectDigitForPrivateChallenge(8)" class="digit-btn">8 Basamak</button>
                        <button onclick="selectDigitForPrivateChallenge(9)" class="digit-btn">9 Basamak</button>
                        <button onclick="selectDigitForPrivateChallenge(10)" class="digit-btn">10 Basamak</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    window.closePrivateChallengeModal = function() {
        document.getElementById('privateChallengeModal').style.display = 'none';
        window.pendingChallengeFriend = null;
    }

    document.getElementById('privateChallengeModal').addEventListener('click', function(e) {
        if (e.target === this) {
            closePrivateChallengeModal();
        }
    });
}

let pendingChallengeFriend = null;

window.challengeFriend = async function(friendId, friendName) {
    if (!document.getElementById('privateChallengeModal')) {
        createPrivateChallengeModal();
    }

    window.pendingChallengeFriend = { id: friendId, name: friendName };
    document.getElementById('privateChallengeModal').style.display = 'flex';
}

window.selectDigitForPrivateChallenge = async function(digits) {
    if (!window.pendingChallengeFriend) {
        showCustomNotification('❌ Hata: Arkadaş bilgisi bulunamadı!', 'error');
        closePrivateChallengeModal();
        return;
    }

    const friendId = window.pendingChallengeFriend.id;
    const friendName = window.pendingChallengeFriend.name;
    const digitCount = digits;

    closePrivateChallengeModal();

    showSecretInputModal(digitCount, {
        digitCount: digitCount,
        callback: async (secret) => {
            const supabase = initSupabase();
            const roomCode = 'P' + Math.floor(10000 + Math.random() * 90000).toString();

            try {
                const { data: game, error } = await supabase
                    .from('games')
                    .insert([{
                        player1_id: window.currentPlayerForFriends.id,
                        player1_secret: secret,
                        room_code: roomCode,
                        digit_count: digitCount,
                        status: 'waiting',
                        current_turn: window.currentPlayerForFriends.id,
                        extra_turn_given: false,
                        is_extra_turn: false,
                        is_private: true,
                        invited_friend_id: friendId
                    }])
                    .select();

                if (error) {
                    console.error('Create game error:', error);
                    showCustomNotification('❌ Düello oluşturulamadı!', 'error');
                    return;
                }

                if (game && game.length > 0) {
                    await createPrivateInvitation(game[0].id, friendId, roomCode, digitCount, friendName);
                    showCustomNotification(`✅ ${friendName} kullanıcısına özel davet gönderildi!`, 'success');
                    window.location.href = `game.html?gameId=${game[0].id}&playerId=${window.currentPlayerForFriends.id}`;
                }
            } catch (error) {
                console.error('Challenge friend error:', error);
                showCustomNotification('❌ Bir hata oluştu!', 'error');
            }
        }
    }, true);
}

async function createPrivateInvitation(gameId, friendId, roomCode, digitCount, friendName) {
    const supabase = initSupabase();

    const { error } = await supabase
        .from('private_invitations')
        .insert([{
            game_id: gameId,
            inviter_id: window.currentPlayerForFriends.id,
            invited_id: friendId,
            room_code: roomCode,
            digit_count: digitCount,
            status: 'pending',
            created_at: new Date()
        }]);

    if (error) {
        console.error('Özel davet oluşturulamadı:', error);
    }
}

async function checkPrivateInvitations() {
    const supabase = initSupabase();

    try {
        const { data: invitations, error } = await supabase
            .from('private_invitations')
            .select('*')
            .eq('invited_id', window.currentPlayerForFriends.id)
            .eq('status', 'pending');

        if (error) throw error;

        if (invitations && invitations.length > 0) {
            for (const inv of invitations) {
                const { data: inviter } = await supabase
                    .from('users')
                    .select('username')
                    .eq('id', inv.inviter_id)
                    .maybeSingle();

                if (inviter) {
                    showPrivateInvitationNotification(inv, inviter.username);
                }
            }
        }
    } catch (error) {
        console.error('Özel davet kontrol hatası:', error);
    }
}

function showPrivateInvitationNotification(invitation, inviterName) {
    const existingNotif = document.querySelector(`.private-invitation-notification[data-game-id="${invitation.game_id}"]`);
    if (existingNotif) return;

    const notification = document.createElement('div');
    notification.className = 'private-invitation-notification';
    notification.setAttribute('data-game-id', invitation.game_id);
    notification.innerHTML = `
        <div class="notification-content private-invite">
            <div class="invite-details">
                <strong>🎮 Özel Düello Daveti!</strong>
                <span>${inviterName} sizi düelloya davet etti!</span>
                <span>📊 ${invitation.digit_count} Basamaklı Sayı</span>
                <span>🏠 Oda Kodu: ${invitation.room_code}</span>
            </div>
            <div class="button-group">
                <button onclick="acceptPrivateInvitation('${invitation.game_id}', '${invitation.room_code}', ${invitation.digit_count})">🎯 Düelloya Katıl</button>
                <button onclick="declinePrivateInvitation('${invitation.id}')">❌ Reddet</button>
            </div>
        </div>
    `;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.remove();
    }, 30000);
}

window.acceptPrivateInvitation = async function(gameId, roomCode, digitCount) {
    showSecretInputModal(digitCount, {
        digitCount: digitCount,
        callback: async (secret) => {
            const supabase = initSupabase();

            try {
                const { data: game, error } = await supabase
                    .from('games')
                    .select('*')
                    .eq('id', gameId)
                    .maybeSingle();

                if (error || !game) {
                    showCustomNotification('❌ Düello bulunamadı!', 'error');
                    return;
                }

                if (game.status !== 'waiting') {
                    showCustomNotification('❌ Bu düello artık aktif değil!', 'error');
                    return;
                }

                const { error: updateError } = await supabase
                    .from('games')
                    .update({
                        player2_id: window.currentPlayerForFriends.id,
                        player2_secret: secret,
                        status: 'active'
                    })
                    .eq('id', gameId);

                if (updateError) {
                    showCustomNotification('❌ Düelloya katılma hatası!', 'error');
                    return;
                }

                await supabase
                    .from('private_invitations')
                    .update({ status: 'accepted' })
                    .eq('game_id', gameId);

                window.location.href = `game.html?gameId=${gameId}&playerId=${window.currentPlayerForFriends.id}`;

            } catch (error) {
                console.error('Özel davet kabul hatası:', error);
                showCustomNotification('❌ Bir hata oluştu!', 'error');
            }
        }
    }, false);
}

window.declinePrivateInvitation = async function(invitationId) {
    const supabase = initSupabase();

    await supabase
        .from('private_invitations')
        .update({ status: 'declined' })
        .eq('id', invitationId);

    const notif = document.querySelector(`.private-invitation-notification[data-game-id]`);
    if (notif) notif.remove();

    showCustomNotification('❌ Davet reddedildi', 'info');
}

function createFriendsModal() {
    if (document.getElementById('friendsModal')) return;

    const modalHTML = `
        <div id="friendsModal" class="modal" style="display: none;">
            <div class="modal-content friends-modal-content">
                <div class="modal-header">
                    <h3>👥 Arkadaşlarım</h3>
                    <span class="close" onclick="closeFriendsModal()">&times;</span>
                </div>
                <div class="modal-body">
                    <div class="add-friend-section">
                        <input type="text" id="friendUsernameInput" placeholder="Kullanıcı adı ile arkadaş ekle" maxlength="20">
                        <button onclick="addFriendFromModal()" class="btn-add-friend">➕ Arkadaş Ekle</button>
                    </div>
                    
                    <div class="friends-tabs">
                        <button class="friends-tab active" onclick="switchFriendsTab('friends')">👥 Arkadaşlarım <span id="friendsCount">0</span></button>
                        <button class="friends-tab" onclick="switchFriendsTab('requests')">📨 İstekler <span id="requestBadge" class="request-badge">0</span></button>
                    </div>
                    
                    <div id="friendsListContainer" class="friends-list-container">
                        <div class="loading-spinner">👥 Arkadaşlar yükleniyor...</div>
                    </div>
                    
                    <div id="requestsListContainer" class="friends-list-container" style="display: none;">
                        <div class="loading-spinner">📨 İstekler yükleniyor...</div>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    window.closeFriendsModal = function() {
        document.getElementById('friendsModal').style.display = 'none';
    }

    window.addFriendFromModal = function() {
        const username = document.getElementById('friendUsernameInput').value.trim();
        if (username) {
            sendFriendRequest(username);
            document.getElementById('friendUsernameInput').value = '';
        } else {
            showCustomNotification('❌ Lütfen bir kullanıcı adı girin!', 'error');
        }
    }

    window.switchFriendsTab = function(tab) {
        const friendsContainer = document.getElementById('friendsListContainer');
        const requestsContainer = document.getElementById('requestsListContainer');
        const tabs = document.querySelectorAll('.friends-tab');

        tabs.forEach(t => t.classList.remove('active'));

        if (tab === 'friends') {
            friendsContainer.style.display = 'block';
            requestsContainer.style.display = 'none';
            tabs[0].classList.add('active');
            updateFriendsListUI();
        } else {
            friendsContainer.style.display = 'none';
            requestsContainer.style.display = 'block';
            tabs[1].classList.add('active');
            updatePendingRequestsUI();
        }
    }

    document.getElementById('friendsModal').addEventListener('click', function(e) {
        if (e.target === this) {
            closeFriendsModal();
        }
    });
}

function updateFriendsListUI() {
    const container = document.getElementById('friendsListContainer');
    const friendsCountSpan = document.getElementById('friendsCount');

    if (!container) return;

    if (friendsCountSpan) {
        friendsCountSpan.textContent = friendsList.length;
    }

    if (friendsList.length === 0) {
        container.innerHTML = '<div class="empty-friends">📭 Henüz arkadaşınız yok.<br>Bir arkadaş ekleyerek başlayın!</div>';
        return;
    }

    let html = '<div class="friends-grid">';
    friendsList.forEach(friend => {
        const winRateColor = friend.winRate >= 50 ? '#4caf50' : friend.winRate >= 30 ? '#ffc107' : '#f44336';
        html += `
            <div class="friend-card">
                <div class="friend-avatar">${escapeHtml(friend.avatar)}</div>
                <div class="friend-info">
                    <div class="friend-name">${escapeHtml(friend.username)}</div>
                    <div class="friend-stats">
                        <span>🏆 ${friend.wins}</span>
                        <span>📊 <span style="color:${winRateColor}">${friend.winRate}%</span></span>
                    </div>
                </div>
                <div class="friend-actions">
                    <button onclick="challengeFriend('${friend.id}', '${escapeHtml(friend.username)}')" class="friend-challenge-btn" title="Özel Düelloya Davet Et">⚔️</button>
                    <button onclick="removeFriend('${friend.id}', '${escapeHtml(friend.username)}')" class="friend-remove-btn" title="Arkadaştan Çıkar">❌</button>
                </div>
            </div>
        `;
    });
    html += '</div>';
    container.innerHTML = html;
}

function updatePendingRequestsUI() {
    const container = document.getElementById('requestsListContainer');
    const badge = document.getElementById('requestBadge');

    if (badge) {
        badge.textContent = pendingRequests.length;
        badge.style.display = pendingRequests.length > 0 ? 'inline-flex' : 'none';
    }

    if (!container) return;

    if (pendingRequests.length === 0) {
        container.innerHTML = '<div class="empty-friends">📭 Bekleyen arkadaşlık isteği yok</div>';
        return;
    }

    let html = '<div class="requests-list">';
    pendingRequests.forEach(request => {
        html += `
            <div class="request-card">
                <div class="request-avatar">${request.user?.avatar || '👤'}</div>
                <div class="request-info">
                    <div class="request-name">${escapeHtml(request.user?.username || 'Bilinmeyen')}</div>
                    <div class="request-time">${new Date(request.created_at).toLocaleDateString('tr-TR')}</div>
                </div>
                <div class="request-actions">
                    <button onclick="acceptFriendRequest('${request.id}', '${request.user_id}', '${escapeHtml(request.user?.username || '')}')" class="accept-btn">✅ Kabul Et</button>
                    <button onclick="rejectFriendRequest('${request.id}')" class="reject-btn">❌ Reddet</button>
                </div>
            </div>
        `;
    });
    html += '</div>';
    container.innerHTML = html;
}

function createFriendRequestNotification() {
    if (!document.getElementById('friendRequestNotification')) {
        const notificationHTML = `
            <div id="friendRequestNotification" class="friend-request-notification" style="display: none;">
                <div class="notification-content">
                    <span class="notification-icon">👥</span>
                    <span id="notificationText">Yeni arkadaşlık isteği var!</span>
                    <button onclick="openFriendsModal()">Görüntüle</button>
                    <button onclick="hideFriendRequestNotification()">✕</button>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', notificationHTML);
    }
}

function showFriendRequestNotification(count) {
    const notification = document.getElementById('friendRequestNotification');
    const text = document.getElementById('notificationText');
    if (notification && text) {
        text.textContent = `${count} yeni arkadaşlık isteği var!`;
        notification.style.display = 'block';
        setTimeout(() => {
            notification.style.display = 'none';
        }, 5000);
    }
}

function hideFriendRequestNotification() {
    const notification = document.getElementById('friendRequestNotification');
    if (notification) notification.style.display = 'none';
}

window.openFriendsModal = function() {
    const modal = document.getElementById('friendsModal');
    if (modal) {
        modal.style.display = 'flex';
        loadFriendsList();
        loadPendingRequests();
    }
}

function setupFriendsRealtime() {
    const supabase = initSupabase();

    if (friendsChannel) {
        supabase.removeChannel(friendsChannel);
    }

    friendsChannel = supabase
        .channel('friends-updates')
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'friendships',
            filter: `friend_id=eq.${window.currentPlayerForFriends.id}`
        }, () => {
            loadFriendsList();
            loadPendingRequests();
        })
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'private_invitations',
            filter: `invited_id=eq.${window.currentPlayerForFriends.id}`
        }, () => {
            checkPrivateInvitations();
        })
        .subscribe();
}

function showCustomNotification(message, type) {
    const oldNotification = document.querySelector('.custom-notification');
    if (oldNotification) {
        oldNotification.remove();
    }

    const notification = document.createElement('div');
    notification.className = `custom-notification ${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <span class="notification-icon">${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span>
            <span>${message}</span>
        </div>
    `;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.classList.add('hide');
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}