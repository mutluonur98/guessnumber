// chat.js - Arkadaşlar arası sohbet sistemi (BASİTLEŞTİRİLMİŞ VERSİYON)

let currentChatChannel = null;
let currentChatFriend = null;

// Sohbet modalını oluştur
function createChatModal() {
    if (document.getElementById('chatModal')) return;

    const modalHTML = `
        <div id="chatModal" class="modal chat-modal" style="display: none;">
            <div class="modal-content chat-modal-content">
                <div class="modal-header">
                    <h3>💬 Sohbet</h3>
                    <span class="close" onclick="closeChatModal()">&times;</span>
                </div>
                <div class="chat-friends-list" id="chatFriendsList">
                    <div class="loading-spinner">Arkadaşlar yükleniyor...</div>
                </div>
                <div class="chat-main" id="chatMain" style="display: none;">
                    <div class="chat-header" id="chatHeader">
                        <button onclick="backToFriendsList()" class="chat-back-btn">←</button>
                        <span id="chatFriendName">Arkadaş</span>
                    </div>
                    <div class="chat-messages" id="chatMessages">
                        <div class="chat-empty">Mesajlaşmaya başlamak için bir arkadaş seçin</div>
                    </div>
                    <div class="chat-input-area">
                        <input type="text" id="chatMessageInput" placeholder="Mesajınızı yazın..." maxlength="500">
                        <button onclick="sendChatMessage()" class="chat-send-btn">📤 Gönder</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Enter ile mesaj gönderme
    const messageInput = document.getElementById('chatMessageInput');
    if (messageInput) {
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                sendChatMessage();
            }
        });
    }

    // Modal dışına tıklama ile kapatma
    document.getElementById('chatModal').addEventListener('click', function(e) {
        if (e.target === this) {
            closeChatModal();
        }
    });
}

// Sohbet butonunu lobiye ekle
// Sohbet butonunu lobiye ekle
function addChatButtonToLobby() {
    if (document.getElementById('chatButton')) return;

    let rightButtons = document.querySelector('.game-header .right-buttons');

    if (!rightButtons) {
        const header = document.querySelector('.game-header');
        if (header) {
            rightButtons = document.createElement('div');
            rightButtons.className = 'right-buttons';
            header.appendChild(rightButtons);
        }
    }

    if (rightButtons && !document.getElementById('chatButton')) {
        const chatBtn = document.createElement('button');
        chatBtn.id = 'chatButton';
        chatBtn.className = 'btn-chat';
        chatBtn.innerHTML = '💬 Sohbet';
        chatBtn.onclick = () => openChatModal();
        rightButtons.appendChild(chatBtn);
    }
}

// Sohbet modalını aç
async function openChatModal() {
    const modal = document.getElementById('chatModal');
    if (!modal) {
        createChatModal();
    }

    modal.style.display = 'flex';
    await loadChatFriendsList();
}

// Sohbet modalını kapat
function closeChatModal() {
    const modal = document.getElementById('chatModal');
    if (modal) {
        modal.style.display = 'none';
    }
    if (currentChatChannel) {
        const supabase = initSupabase();
        if (supabase && currentChatChannel) {
            supabase.removeChannel(currentChatChannel);
        }
        currentChatChannel = null;
    }
    currentChatFriend = null;
}

// Arkadaş listesini yükle (sohbet için)
async function loadChatFriendsList() {
    const supabase = initSupabase();
    const container = document.getElementById('chatFriendsList');

    if (!container) return;

    try {
        const userId = window.currentPlayerForFriends?.id;
        if (!userId) {
            console.error('Kullanıcı ID bulunamadı');
            container.innerHTML = '<div class="error-message">Oturum hatası</div>';
            return;
        }

        const { data: friendships, error } = await supabase
            .from('friendships')
            .select(`
                *,
                user:users!friendships_user_id_fkey (id, username, avatar),
                friend:users!friendships_friend_id_fkey (id, username, avatar)
            `)
            .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
            .eq('status', 'accepted');

        if (error) throw error;

        const friends = [];
        if (friendships) {
            friendships.forEach(friendship => {
                const friend = friendship.user_id === userId
                    ? friendship.friend
                    : friendship.user;
                if (friend) {
                    friends.push({
                        id: friend.id,
                        username: friend.username,
                        avatar: friend.avatar || '👤'
                    });
                }
            });
        }

        if (friends.length === 0) {
            container.innerHTML = `
                <div class="chat-empty-friends">
                    <div class="empty-emoji">👥</div>
                    <p>Henüz arkadaşınız yok</p>
                    <small>Arkadaş ekleyerek sohbete başlayabilirsiniz</small>
                </div>
            `;
            return;
        }

        let friendsHtml = '<div class="friends-chat-list">';
        for (const friend of friends) {
            const lastMessage = await getLastMessage(friend.id);
            const unreadCount = await getUnreadCount(friend.id);

            friendsHtml += `
                <div class="chat-friend-item" onclick="startChatWithFriend('${friend.id}', '${escapeHtml(friend.username)}')">
                    <div class="chat-friend-avatar">${friend.avatar}</div>
                    <div class="chat-friend-info">
                        <div class="chat-friend-name">${escapeHtml(friend.username)}</div>
                        <div class="chat-friend-lastmsg">${escapeHtml(lastMessage || 'Henüz mesaj yok')}</div>
                    </div>
                    ${unreadCount > 0 ? `<div class="chat-unread-badge">${unreadCount}</div>` : ''}
                </div>
            `;
        }
        friendsHtml += '</div>';
        container.innerHTML = friendsHtml;

    } catch (error) {
        console.error('Arkadaş listesi yüklenemedi:', error);
        container.innerHTML = '<div class="error-message">Arkadaş listesi yüklenemedi</div>';
    }
}

// Son mesajı al
async function getLastMessage(friendId) {
    const supabase = initSupabase();
    const userId = window.currentPlayerForFriends?.id;

    if (!userId) return null;

    try {
        const { data, error } = await supabase
            .from('friend_messages')
            .select('message')
            .or(`and(sender_id.eq.${userId},receiver_id.eq.${friendId}),and(sender_id.eq.${friendId},receiver_id.eq.${userId})`)
            .order('created_at', { ascending: false })
            .limit(1);

        if (error || !data || data.length === 0) return null;

        const msg = data[0].message;
        return msg.length > 30 ? msg.substring(0, 30) + '...' : msg;
    } catch (error) {
        return null;
    }
}

// Okunmamış mesaj sayısını al
async function getUnreadCount(friendId) {
    const supabase = initSupabase();
    const userId = window.currentPlayerForFriends?.id;

    if (!userId) return 0;

    try {
        const { count, error } = await supabase
            .from('friend_messages')
            .select('*', { count: 'exact', head: true })
            .eq('sender_id', friendId)
            .eq('receiver_id', userId)
            .eq('is_read', false);

        if (error) return 0;
        return count || 0;
    } catch (error) {
        return 0;
    }
}

// Arkadaşla sohbete başla
async function startChatWithFriend(friendId, friendName) {
    currentChatFriend = { id: friendId, name: friendName };

    // UI'ı güncelle
    document.getElementById('chatFriendsList').style.display = 'none';
    document.getElementById('chatMain').style.display = 'flex';
    document.getElementById('chatFriendName').textContent = friendName;

    // Mesajları yükle
    await loadChatMessages();

    // Realtime dinleme başlat
    setupChatRealtimeForFriend(friendId);

    // Mesajları okundu olarak işaretle
    await markMessagesAsRead(friendId);

    // Input'a odaklan
    const input = document.getElementById('chatMessageInput');
    if (input) input.focus();
}

// Mesajları yükle
async function loadChatMessages() {
    if (!currentChatFriend) return;

    const supabase = initSupabase();
    const userId = window.currentPlayerForFriends?.id;
    const friendId = currentChatFriend.id;

    if (!userId) return;

    try {
        const { data: messages, error } = await supabase
            .from('friend_messages')
            .select('*')
            .or(`and(sender_id.eq.${userId},receiver_id.eq.${friendId}),and(sender_id.eq.${friendId},receiver_id.eq.${userId})`)
            .order('created_at', { ascending: true });

        if (error) {
            console.error('Mesaj yükleme hatası:', error);
            return;
        }

        displayChatMessages(messages || []);

    } catch (error) {
        console.error('Mesajlar yüklenemedi:', error);
    }
}

// Mesajları ekranda göster
function displayChatMessages(messages) {
    const container = document.getElementById('chatMessages');
    if (!container) return;

    if (messages.length === 0) {
        container.innerHTML = '<div class="chat-empty">Henüz mesaj yok. İlk mesajı sen gönder!</div>';
        return;
    }

    const userId = window.currentPlayerForFriends?.id;
    let html = '';

    messages.forEach(msg => {
        const isMyMessage = msg.sender_id === userId;
        const time = new Date(msg.created_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

        html += `
            <div class="chat-message ${isMyMessage ? 'my-message' : 'other-message'}">
                <div class="chat-message-bubble">
                    <div class="chat-message-text">${escapeHtml(msg.message)}</div>
                    <div class="chat-message-time">${time}</div>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;
}

// Mesaj gönder
async function sendChatMessage() {
    const input = document.getElementById('chatMessageInput');
    const message = input.value.trim();

    if (!message || !currentChatFriend) {
        return;
    }

    const supabase = initSupabase();
    const userId = window.currentPlayerForFriends?.id;

    if (!userId) {
        showCustomNotification('❌ Oturum hatası!', 'error');
        return;
    }

    try {
        const { error } = await supabase
            .from('friend_messages')
            .insert([{
                sender_id: userId,
                receiver_id: currentChatFriend.id,
                message: message,
                is_read: false,
                created_at: new Date()
            }]);

        if (error) {
            console.error('Mesaj gönderme hatası:', error);
            showCustomNotification('❌ Mesaj gönderilemedi: ' + error.message, 'error');
            return;
        }

        // Input'u temizle
        input.value = '';

        // Mesajları yeniden yükle
        await loadChatMessages();

        // Odaklanmaya devam et
        input.focus();

    } catch (error) {
        console.error('Mesaj gönderme hatası:', error);
        showCustomNotification('❌ Mesaj gönderilemedi!', 'error');
    }
}

// Mesajları okundu olarak işaretle
async function markMessagesAsRead(friendId) {
    const supabase = initSupabase();
    const userId = window.currentPlayerForFriends?.id;

    if (!userId) return;

    try {
        await supabase
            .from('friend_messages')
            .update({ is_read: true })
            .eq('sender_id', friendId)
            .eq('receiver_id', userId)
            .eq('is_read', false);
    } catch (error) {
        console.error('Okundu işaretleme hatası:', error);
    }
}

// Realtime mesaj dinleme (BASİT VERSİYON)
function setupChatRealtimeForFriend(friendId) {
    // Önce eski kanalı temizle
    if (currentChatChannel) {
        const supabase = initSupabase();
        supabase.removeChannel(currentChatChannel);
        currentChatChannel = null;
    }

    const supabase = initSupabase();
    const userId = window.currentPlayerForFriends?.id;

    if (!userId || !friendId) return;

    // Basit polling ile mesaj kontrolü (realtime yerine)
    // Bu daha güvenilir çalışır
    if (window.messagePollingInterval) {
        clearInterval(window.messagePollingInterval);
    }

    window.messagePollingInterval = setInterval(() => {
        if (currentChatFriend && currentChatFriend.id === friendId) {
            loadChatMessages();
            markMessagesAsRead(friendId);
        }
    }, 3000);
}

// Arkadaş listesine geri dön
function backToFriendsList() {
    document.getElementById('chatFriendsList').style.display = 'block';
    document.getElementById('chatMain').style.display = 'none';

    if (window.messagePollingInterval) {
        clearInterval(window.messagePollingInterval);
        window.messagePollingInterval = null;
    }

    if (currentChatChannel) {
        const supabase = initSupabase();
        supabase.removeChannel(currentChatChannel);
        currentChatChannel = null;
    }

    currentChatFriend = null;

    // Listeyi yenile
    loadChatFriendsList();
}

// CSS stilleri
const chatStyles = `
.btn-chat {
    background: linear-gradient(135deg, #3b82f6, #8b5cf6);
    color: white;
    border: none;
    padding: 10px 20px;
    border-radius: 30px;
    cursor: pointer;
    font-weight: bold;
    transition: all 0.3s ease;
}

.btn-chat:hover {
    transform: translateY(-2px);
    filter: brightness(1.05);
}

.chat-modal-content {
    max-width: 500px;
    width: 90%;
    height: 600px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    padding: 0;
    overflow: hidden;
}

.chat-modal-content .modal-header {
    padding: 20px 20px 15px;
    margin: 0;
    flex-shrink: 0;
}

.chat-friends-list {
    flex: 1;
    overflow-y: auto;
    padding: 0 20px 20px;
}

.chat-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.chat-header {
    display: flex;
    align-items: center;
    gap: 15px;
    padding: 15px 20px;
    background: rgba(255,255,255,0.1);
    border-bottom: 1px solid rgba(255,255,255,0.1);
    flex-shrink: 0;
}

.chat-back-btn {
    background: rgba(255,255,255,0.2);
    border: none;
    color: white;
    font-size: 20px;
    cursor: pointer;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
}

.chat-back-btn:hover {
    background: rgba(255,255,255,0.3);
}

.chat-header span:first-of-type {
    flex: 1;
    font-weight: bold;
    font-size: 18px;
}

.chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.chat-empty {
    text-align: center;
    padding: 40px;
    color: rgba(255,255,255,0.5);
    font-style: italic;
}

.chat-message {
    display: flex;
    margin-bottom: 8px;
}

.chat-message.my-message {
    justify-content: flex-end;
}

.chat-message.other-message {
    justify-content: flex-start;
}

.chat-message-bubble {
    max-width: 70%;
    padding: 10px 14px;
    border-radius: 18px;
    position: relative;
}

.my-message .chat-message-bubble {
    background: linear-gradient(135deg, #667eea, #764ba2);
    color: white;
    border-bottom-right-radius: 4px;
}

.other-message .chat-message-bubble {
    background: rgba(255,255,255,0.15);
    color: white;
    border-bottom-left-radius: 4px;
}

.chat-message-text {
    word-wrap: break-word;
    font-size: 14px;
}

.chat-message-time {
    font-size: 10px;
    opacity: 0.7;
    margin-top: 4px;
    text-align: right;
}

.chat-input-area {
    display: flex;
    gap: 10px;
    padding: 15px 20px;
    background: rgba(255,255,255,0.05);
    border-top: 1px solid rgba(255,255,255,0.1);
    flex-shrink: 0;
}

.chat-input-area input {
    flex: 1;
    background: rgba(255,255,255,0.9);
    border: none;
    border-radius: 25px;
    padding: 12px 18px;
    font-size: 14px;
    margin: 0;
}

.chat-send-btn {
    background: linear-gradient(135deg, #667eea, #764ba2);
    color: white;
    border: none;
    border-radius: 25px;
    padding: 0 20px;
    cursor: pointer;
    font-weight: bold;
    transition: all 0.2s;
}

.chat-send-btn:hover {
    transform: scale(1.02);
}

.friends-chat-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.chat-friend-item {
    display: flex;
    align-items: center;
    gap: 15px;
    padding: 12px 15px;
    background: rgba(255,255,255,0.08);
    border-radius: 16px;
    cursor: pointer;
    transition: all 0.2s ease;
    position: relative;
}

.chat-friend-item:hover {
    background: rgba(255,255,255,0.15);
    transform: translateX(5px);
}

.chat-friend-avatar {
    font-size: 40px;
}

.chat-friend-info {
    flex: 1;
}

.chat-friend-name {
    font-weight: bold;
    font-size: 15px;
    margin-bottom: 4px;
    color: white;
}

.chat-friend-lastmsg {
    font-size: 12px;
    color: rgba(255,255,255,0.6);
}

.chat-unread-badge {
    background: #f44336;
    color: white;
    border-radius: 20px;
    padding: 2px 8px;
    font-size: 11px;
    font-weight: bold;
    min-width: 20px;
    text-align: center;
}

.chat-empty-friends {
    text-align: center;
    padding: 50px 20px;
    color: rgba(255,255,255,0.5);
}

.chat-empty-friends .empty-emoji {
    font-size: 60px;
    margin-bottom: 15px;
}

.chat-empty-friends p {
    margin-bottom: 5px;
}

.chat-empty-friends small {
    font-size: 12px;
    opacity: 0.7;
}

@media (max-width: 550px) {
    .chat-modal-content {
        width: 95%;
        height: 90vh;
    }
    
    .chat-message-bubble {
        max-width: 85%;
    }
}
`;

// CSS'i ekle
function addChatStyles() {
    if (document.getElementById('chat-styles')) return;
    const styleElement = document.createElement('style');
    styleElement.id = 'chat-styles';
    styleElement.textContent = chatStyles;
    document.head.appendChild(styleElement);
}

// Sayfa yüklendiğinde stilleri ekle
addChatStyles();