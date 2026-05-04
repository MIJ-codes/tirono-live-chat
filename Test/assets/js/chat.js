let currentChatUserId = null;
let currentChatUserName = "";

$(document).ready(function () {
    showHome();
    loadChatHistory();

    $("#homeBtn").on("click", showHome);
    $("#chatBtn").on("click", showChat);

    $("#sendBtn").on("click", sendMessage);

    $("#messageInput").on("keypress", function (event) {
        if (event.key === "Enter") {
            sendMessage();
        }
    });

    $(document).on("click", ".chat-item", function () {
        const userId = Number($(this).attr("data-user-id"));
        const userName = $(this).attr("data-user-name");

        openChat(userId, userName);
    });

    /*
        AJAX polling.

        Every 1 second:
        1. Refresh left chat history.
        2. Mark incoming messages as delivered.
        3. Refresh current conversation.
        4. Mark current open chat as seen.
    */
    setInterval(function () {
        loadChatHistory();
        markDelivered();

        if (currentChatUserId !== null) {
            loadMessages();
            markSeen(currentChatUserId);
        }
    }, 1000);
});

function showHome() {
    $("#homeSection").removeClass("is-hidden");
    $("#chatSection").removeClass("is-visible");

    $("#homeBtn").addClass("active");
    $("#chatBtn").removeClass("active");
}

function showChat() {
    $("#homeSection").addClass("is-hidden");
    $("#chatSection").addClass("is-visible");

    $("#chatBtn").addClass("active");
    $("#homeBtn").removeClass("active");

    loadChatHistory();
}

function loadChatHistory() {
    $.ajax({
        url: "api.php?action=get_chats",
        method: "GET",
        data: {
            user_id: CURRENT_USER_ID
        },
        dataType: "json",
        success: function (response) {
            if (!response.success) {
                return;
            }

            let html = "";

            response.chats.forEach(function (chat) {
                const activeClass = Number(chat.user_id) === Number(currentChatUserId)
                    ? "active"
                    : "";

                const unreadBadge = Number(chat.unread) > 0
                    ? `<span class="unread">${chat.unread}</span>`
                    : "";

                html += `
                    <div class="chat-item ${activeClass}"
                         data-user-id="${chat.user_id}"
                         data-user-name="${escapeAttr(chat.name)}">

                        <div class="avatar">${escapeHtml(chat.avatar)}</div>

                        <div class="chat-info">
                            <div class="chat-top">
                                <span class="chat-name">
                                    ${escapeHtml(chat.name)}
                                    ${unreadBadge}
                                </span>

                                <span class="chat-time">
                                    ${escapeHtml(chat.latest_time)}
                                </span>
                            </div>

                            <div class="chat-preview">
                                ${escapeHtml(chat.latest_message)}
                            </div>
                        </div>
                    </div>
                `;
            });

            $("#chatList").html(html);
        }
    });
}

function openChat(userId, userName) {
    currentChatUserId = userId;
    currentChatUserName = userName;

    $("#chatUserName").text(userName);
    $("#chatInfo").text("Conversation opened. Messages update without page reload.");

    loadMessages();
    markSeen(userId);
    loadChatHistory();
}

function loadMessages() {
    if (currentChatUserId === null) {
        return;
    }

    $.ajax({
        url: "api.php?action=get_messages",
        method: "GET",
        data: {
            user_id: CURRENT_USER_ID,
            chat_user_id: currentChatUserId
        },
        dataType: "json",
        success: function (response) {
            if (!response.success) {
                return;
            }

            let html = "";

            if (response.messages.length === 0) {
                html = `<div class="empty-chat">No messages yet. Start the conversation.</div>`;
            }

            response.messages.forEach(function (message) {
                const sentByMe = Number(message.sender_id) === Number(CURRENT_USER_ID);
                const rowClass = sentByMe ? "sent" : "received";

                let meta = escapeHtml(message.time_label);

                if (sentByMe) {
                    meta += " · " + escapeHtml(capitalize(message.status));
                }

                html += `
                    <div class="message-row ${rowClass}">
                        <div class="bubble">
                            ${escapeHtml(message.message_text)}
                            <div class="meta">${meta}</div>
                        </div>
                    </div>
                `;
            });

            $("#messageArea").html(html);
            scrollToBottom();
        }
    });
}

function sendMessage() {
    if (currentChatUserId === null) {
        alert("Select a chat first.");
        return;
    }

    const messageText = $("#messageInput").val().trim();

    if (messageText === "") {
        return;
    }

    $.ajax({
        url: "api.php?action=send_message",
        method: "POST",
        data: {
            user_id: CURRENT_USER_ID,
            receiver_id: currentChatUserId,
            message_text: messageText
        },
        dataType: "json",
        success: function (response) {
            if (!response.success) {
                alert(response.message || "Message failed.");
                return;
            }

            $("#messageInput").val("");

            loadMessages();
            loadChatHistory();
        }
    });
}

function markDelivered() {
    $.ajax({
        url: "api.php?action=mark_delivered",
        method: "POST",
        data: {
            user_id: CURRENT_USER_ID
        },
        dataType: "json"
    });
}

function markSeen(userId) {
    $.ajax({
        url: "api.php?action=mark_seen",
        method: "POST",
        data: {
            user_id: CURRENT_USER_ID,
            chat_user_id: userId
        },
        dataType: "json",
        success: function () {
            loadChatHistory();
        }
    });
}

function scrollToBottom() {
    const messageArea = $("#messageArea");

    if (messageArea.length > 0) {
        messageArea.scrollTop(messageArea[0].scrollHeight);
    }
}

function capitalize(text) {
    if (!text) {
        return "";
    }

    return text.charAt(0).toUpperCase() + text.slice(1);
}

function escapeHtml(text) {
    if (text === null || text === undefined) {
        return "";
    }

    return String(text)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function escapeAttr(text) {
    if (text === null || text === undefined) {
        return "";
    }

    return String(text)
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}