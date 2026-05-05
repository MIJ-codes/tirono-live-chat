/* =====================================================
   GLOBAL STATE
   These variables remember what chat is open,
   what messages are already on screen,
   and what attachment file is selected.
===================================================== */

let currentChatUserId = null;
let currentChatUserName = "";

let selectedAttachmentFile = null;

/*
    messageCache stores the last known version of each message.

    Why?
    Because AJAX polling runs every 1 second.
    We do NOT want to rebuild the whole message area every second.
    We only update a message if its text/status/time changed.
*/
let messageCache = new Map();

/*
    chatCache stores the last known version of each chat row.

    Why?
    So the left chat history does not get destroyed/recreated
    every second while the mouse is hovering over it.
*/
let chatCache = new Map();

/*
    renderedMessageIds helps us know which messages are truly new.

    New messages get the CSS animation class: message-new.
*/
let renderedMessageIds = new Set();

/*
    If this is true, the next message load should scroll to bottom.

    This is used when:
    1. user opens a chat
    2. user sends a message

    But normal polling should NOT force the scroll down
    while the user is reading old messages.
*/
let forceScrollToBottomOnce = false;

/*
    These prevent overlapping AJAX calls.

    Example problem:
    If loadMessages() takes longer than 1 second,
    another loadMessages() could start before the first one finishes.

    This can cause weird UI behavior.
*/
let isLoadingChatHistory = false;
let isLoadingMessages = false;

/*
    Typing indicator control.

    We do NOT send AJAX on every keypress.
    Instead, typing updates are throttled:
    - sender sends set_typing at most once every 1.5 seconds
    - receiver sees typing through loadChatHistory() polling
*/
const TYPING_SEND_INTERVAL_MS = 1500;
let lastTypingSentAt = 0;
let typingClearTimer = null;


/* =====================================================
   PAGE READY
   This runs once after the page loads.
===================================================== */

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

    /*
        Detect typing locally.

        The browser already knows I am typing because the input event
        fires whenever the message box changes.

        handleTypingInput() sends a throttled AJAX typing signal.
    */
    $("#messageInput").on("input", function () {
        handleTypingInput();
    });

    /*
        Attachment UI only.

        This does NOT upload the file yet.
        It only:
        1. opens the file picker
        2. stores the selected file in selectedAttachmentFile
        3. shows the selected filename
        4. allows removing the selected file
    */
    $("#attachmentBtn").on("click", function () {
        $("#attachmentInput").click();
    });

    $("#attachmentInput").on("change", function () {
        selectedAttachmentFile = this.files[0] || null;
        updateAttachmentPreview();
    });

    $("#removeAttachmentBtn").on("click", function () {
        clearAttachment();
    });

    /*
        Chat items are created dynamically by AJAX,
        so we use delegated click handling.

        Meaning:
        Even if .chat-item does not exist during page load,
        this click event will still work later.
    */
    $(document).on("click", ".chat-item", function () {
        const userId = Number($(this).attr("data-user-id"));
        const userName = $(this).attr("data-user-name");

        openChat(userId, userName);
    });

    /*
        AJAX POLLING

        Because we are not using WebSocket,
        the browser checks the server every 1 second.

        Important:
        Polling still happens every second,
        but the DOM is NOT rebuilt every second.

        The update functions compare old data vs new data.
        If nothing changed, nothing visual happens.
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


/* =====================================================
   SECTION SWITCHING
===================================================== */

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


/* =====================================================
   CHAT HISTORY AJAX
   Loads the left chat list.

   Old bad way:
   - rebuild the whole #chatList every second

   New better way:
   - create chat row only if missing
   - update text/time/unread only if changed
   - move row only if order changed
===================================================== */

function loadChatHistory() {
    if (isLoadingChatHistory) {
        return;
    }

    isLoadingChatHistory = true;

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

            updateChatHistoryDom(response.chats);
        },
        complete: function () {
            isLoadingChatHistory = false;
        }
    });
}

function updateChatHistoryDom(chats) {
    const chatList = $("#chatList");
    const desiredOrder = [];

    /*
        Step 1:
        Create/update every chat row.
    */
    chats.forEach(function (chat) {
        const chatId = String(chat.user_id);
        desiredOrder.push(chatId);

        let chatItem = chatList.children(`.chat-item[data-user-id="${chatId}"]`);

        if (chatItem.length === 0) {
            chatItem = createChatItem(chat);
            chatList.append(chatItem);
        }

        updateChatItem(chatItem, chat);
    });

    /*
        Step 2:
        Remove chat rows that no longer exist in the response.
        Usually this will not happen in the demo, but it keeps the code clean.
    */
    chatList.children(".chat-item").each(function () {
        const item = $(this);
        const id = String(item.attr("data-user-id"));

        if (!desiredOrder.includes(id)) {
            item.remove();
            chatCache.delete(id);
        }
    });

    /*
        Step 3:
        Reorder chat rows only if the order actually changed.

        This is important.
        Moving DOM elements every second can create hover jitter.
    */
    const currentOrder = getCurrentChatDomOrder();

    if (!arraysAreEqual(currentOrder, desiredOrder)) {
        desiredOrder.forEach(function (chatId) {
            const item = chatList.children(`.chat-item[data-user-id="${chatId}"]`);
            chatList.append(item);
        });
    }

    /*
        The same get_chats response tells us whether the currently
        opened chat user is typing.

        So we update the main typing indicator from here too.
    */
    updateMainTypingIndicatorFromChats(chats);
}

function createChatItem(chat) {
    /*
        Create a stable chat row once.

        Later, updateChatItem() only changes the inner text/badge/class.
        The whole row is not recreated again and again.
    */
    const item = $(`
        <div class="chat-item" data-user-id="${chat.user_id}">
            <div class="avatar"></div>

            <div class="chat-info">
                <div class="chat-top">
                    <span class="chat-name">
                        <span class="chat-name-text"></span>
                        <span class="unread-slot"></span>
                    </span>

                    <span class="chat-time"></span>
                </div>

                <div class="chat-preview"></div>
            </div>
        </div>
    `);

    return item;
}

function updateChatItem(chatItem, chat) {
    const chatId = String(chat.user_id);

    /*
        Build a signature of the important visual data.
        If this signature is unchanged, the row does not need updates.
    */
    const newSignature = JSON.stringify({
        name: chat.name,
        avatar: chat.avatar,
        latest_message: chat.latest_message,
        latest_time: chat.latest_time,
        unread: Number(chat.unread),
        is_typing: Boolean(chat.is_typing),
        active: Number(chat.user_id) === Number(currentChatUserId)
    });

    const oldSignature = chatCache.get(chatId);

    if (oldSignature === newSignature) {
        return;
    }

    chatCache.set(chatId, newSignature);

    const isActive = Number(chat.user_id) === Number(currentChatUserId);

    chatItem.toggleClass("active", isActive);
    chatItem.attr("data-user-name", chat.name);

    chatItem.find(".avatar").text(chat.avatar);
    chatItem.find(".chat-name-text").text(chat.name);
    chatItem.find(".chat-time").text(chat.latest_time);
    /*
        Chat history preview.

        Normal state:
        show latest message.

        Typing state:
        show animated typing... preview.
    */
    const preview = chatItem.find(".chat-preview");

    if (chat.is_typing) {
        preview.addClass("typing-preview");
        preview.html(`
            typing
            <span class="typing-dots" aria-hidden="true">
                <span></span>
                <span></span>
                <span></span>
            </span>
        `);
    } else {
        preview.removeClass("typing-preview");
        preview.text(chat.latest_message);
    }

    const unreadSlot = chatItem.find(".unread-slot");

    if (Number(chat.unread) > 0) {
        unreadSlot.html(`<span class="unread">${chat.unread}</span>`);
    } else {
        unreadSlot.empty();
    }
}

function getCurrentChatDomOrder() {
    const order = [];

    $("#chatList").children(".chat-item").each(function () {
        order.push(String($(this).attr("data-user-id")));
    });

    return order;
}


/* =====================================================
   OPEN CHAT
===================================================== */

function openChat(userId, userName) {
    const previousChatUserId = currentChatUserId;
    const changedChat = Number(currentChatUserId) !== Number(userId);

    /*
        If user switches chat while typing, clear typing signal
        for the previous receiver first.
    */
    if (changedChat && previousChatUserId !== null) {
        clearTypingSignal(previousChatUserId);
    }

    currentChatUserId = userId;
    currentChatUserName = userName;

    hideMainTypingIndicator();

    $("#chatUserName").text(userName);
    $("#chatInfo").text("Conversation opened. Messages update without page reload.");

    /*
        If the user opened a different chat,
        clear old message memory so the new conversation loads cleanly.
    */
    if (changedChat) {
        messageCache.clear();
        renderedMessageIds.clear();

        $("#messageArea").html(`<div class="empty-chat">Loading conversation...</div>`);
    }

    /*
        Opening a chat should go to the latest message once.
        After that, polling must not drag the user back down.
    */
    forceScrollToBottomOnce = true;

    loadMessages();
    markSeen(userId);
    loadChatHistory();
}


/* =====================================================
   MESSAGE AJAX
   Loads messages for the selected conversation.

   Old bad way:
   - rebuild the full message area every second

   New better way:
   - append only new messages
   - update only status/time/text if changed
   - keep scroll stable if user is reading old messages
===================================================== */

function loadMessages() {
    if (currentChatUserId === null) {
        return;
    }

    if (isLoadingMessages) {
        return;
    }

    isLoadingMessages = true;

    const messageArea = $("#messageArea");

    /*
        Save scroll state before any DOM change.

        If user is near the bottom, new messages can keep them at bottom.
        If user scrolled up, we should not force them down.
    */
    const wasNearBottom = isMessageAreaNearBottom();
    const previousScrollTop = messageArea.scrollTop();

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

            updateMessagesDom(response.messages, wasNearBottom, previousScrollTop);
        },
        complete: function () {
            isLoadingMessages = false;
        }
    });
}

function updateMessagesDom(messages, wasNearBottom, previousScrollTop) {
    const messageArea = $("#messageArea");
    const desiredOrder = [];

    const isFirstLoad = messageCache.size === 0;
    let hasNewMessage = false;
    let hasAnyVisualChange = false;

    /*
        Empty conversation case.
    */
    if (messages.length === 0) {
        if (messageArea.children(".empty-chat").length === 0) {
            messageArea.html(`<div class="empty-chat">No messages yet. Start the conversation.</div>`);
        }

        messageCache.clear();
        renderedMessageIds.clear();
        forceScrollToBottomOnce = false;
        return;
    }

    /*
        If messages exist, remove the empty placeholder.
    */
    messageArea.children(".empty-chat").remove();

    /*
        Step 1:
        Create missing message rows and update existing rows.
    */
    messages.forEach(function (message) {
        const messageId = String(message.id);
        desiredOrder.push(messageId);

        let messageRow = messageArea.children(`.message-row[data-message-id="${messageId}"]`);

        if (messageRow.length === 0) {
            messageRow = createMessageRow(message, true);
            messageArea.append(messageRow);

            hasNewMessage = true;
            hasAnyVisualChange = true;
        } else {
            const changed = updateMessageRow(messageRow, message);

            if (changed) {
                hasAnyVisualChange = true;
            }
        }

        renderedMessageIds.add(Number(message.id));
    });

    /*
        Step 2:
        Remove message rows that are no longer returned.
        Usually not needed in this demo, but it keeps the DOM accurate.
    */
    messageArea.children(".message-row").each(function () {
        const row = $(this);
        const id = String(row.attr("data-message-id"));

        if (!desiredOrder.includes(id)) {
            row.remove();
            messageCache.delete(id);
            hasAnyVisualChange = true;
        }
    });

    /*
        Step 3:
        Reorder only if the actual order changed.

        Important:
        We do not want to move DOM nodes every second.
        Moving nodes can interrupt scrolling and hover states.
    */
    const currentOrder = getCurrentMessageDomOrder();

    if (!arraysAreEqual(currentOrder, desiredOrder)) {
        desiredOrder.forEach(function (messageId) {
            const row = messageArea.children(`.message-row[data-message-id="${messageId}"]`);
            messageArea.append(row);
        });

        hasAnyVisualChange = true;
    }

    /*
        Scroll rule:

        Scroll to bottom only when:
        1. chat was opened
        2. user just sent a message
        3. first load of this chat
        4. a new message arrived while user was already near bottom

        If user manually scrolled up:
        do NOT drag them down.
    */
    if (forceScrollToBottomOnce || isFirstLoad || (hasNewMessage && wasNearBottom)) {
        smoothScrollToBottom();
        forceScrollToBottomOnce = false;
    } else if (hasAnyVisualChange && !wasNearBottom) {
        messageArea.scrollTop(previousScrollTop);
    }
}

function createMessageRow(message, isNewMessage) {
    const sentByMe = Number(message.sender_id) === Number(CURRENT_USER_ID);
    const rowClass = sentByMe ? "sent" : "received";
    const newClass = isNewMessage ? "message-new" : "";

    /*
        Small avatar beside each message.

        Received message:
        avatar on the LEFT of the bubble.

        Sent message:
        avatar on the RIGHT of the bubble.
    */
    const avatarLetter = sentByMe
        ? getFirstLetter(CURRENT_USER_NAME)
        : getFirstLetter(currentChatUserName);

    let rowHtml = "";

    if (sentByMe) {
        rowHtml = `
            <div class="message-row ${rowClass} ${newClass}" data-message-id="${message.id}">
                <div class="bubble">
                    <div class="message-text"></div>
                    <div class="meta"></div>
                </div>

                <div class="message-avatar">${escapeHtml(avatarLetter)}</div>
            </div>
        `;
    } else {
        rowHtml = `
            <div class="message-row ${rowClass} ${newClass}" data-message-id="${message.id}">
                <div class="message-avatar">${escapeHtml(avatarLetter)}</div>

                <div class="bubble">
                    <div class="message-text"></div>
                    <div class="meta"></div>
                </div>
            </div>
        `;
    }

    const row = $(rowHtml);

    updateMessageRow(row, message);

    return row;
}

function updateMessageRow(row, message) {
    const messageId = String(message.id);
    const newSignature = getMessageSignature(message);
    const oldSignature = messageCache.get(messageId);

    /*
        If the message did not change, do nothing.
        This is the main anti-jitter logic.
    */
    if (oldSignature === newSignature) {
        return false;
    }

    messageCache.set(messageId, newSignature);

    const sentByMe = Number(message.sender_id) === Number(CURRENT_USER_ID);
    const rowClass = sentByMe ? "sent" : "received";
    const metaText = getMessageMetaText(message, sentByMe);

    row.removeClass("sent received");
    row.addClass(rowClass);

    row.find(".message-text").text(message.message_text);
    row.find(".meta").text(metaText);

    /*
        Keep avatar letter updated too.

        This matters if later names come from database.
    */
    const avatarLetter = sentByMe
        ? getFirstLetter(CURRENT_USER_NAME)
        : getFirstLetter(currentChatUserName);

    row.find(".message-avatar").text(avatarLetter);

    return true;
}

function getMessageSignature(message) {
    /*
        We include status because:
        Sent -> Delivered -> Seen must update visually.
    */
    return JSON.stringify({
        id: message.id,
        sender_id: message.sender_id,
        message_text: message.message_text,
        status: message.status,
        time_label: message.time_label
    });
}

function getMessageMetaText(message, sentByMe) {
    let meta = message.time_label || "";

    if (sentByMe) {
        meta += " · " + capitalize(message.status);
    }

    return meta;
}

function getCurrentMessageDomOrder() {
    const order = [];

    $("#messageArea").children(".message-row").each(function () {
        order.push(String($(this).attr("data-message-id")));
    });

    return order;
}


/* =====================================================
   SEND MESSAGE
===================================================== */

function sendMessage() {
    if (currentChatUserId === null) {
        alert("Select a chat first.");
        return;
    }

    const messageText = $("#messageInput").val().trim();

    /*
        For now:
        - text message works normally through AJAX
        - attachment selection UI works
        - actual backend upload is not connected yet
    */
    if (messageText === "" && selectedAttachmentFile === null) {
        return;
    }

    if (selectedAttachmentFile !== null) {
        alert("Attachment UI is ready. Backend upload will be connected later.");

        /*
            Temporary behavior:
            If user selected a file and also wrote text,
            the text will still be sent normally.

            If user selected only a file,
            nothing is saved yet because upload backend is not done.
        */
        if (messageText === "") {
            return;
        }
    }

    $("#sendBtn").prop("disabled", true);

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
            clearAttachment();

            /*
                Clear typing immediately after sending.
                The backend also clears typing in send_message,
                but this keeps frontend state clean too.
            */
            clearTypingSignal();

            /*
                After sending, we do want to move to the latest message.
            */
            forceScrollToBottomOnce = true;

            loadMessages();
            loadChatHistory();
        },
        complete: function () {
            $("#sendBtn").prop("disabled", false);
            $("#messageInput").focus();
        }
    });
}


/* =====================================================
   MESSAGE STATUS AJAX
===================================================== */

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
        success: function (response) {
            /*
                Only reload chat history if some unread messages
                actually changed to seen.

                Before, this was calling loadChatHistory()
                every second even if nothing changed.
            */
            if (response && Number(response.updated) > 0) {
                loadChatHistory();
            }
        }
    });
}


/* =====================================================
   TYPING INDICATOR AJAX + UI

   How it works:
   1. When I type, chat.js sends set_typing to api.php.
   2. api.php stores temporary typing state in typing.json.
   3. The other browser already polls get_chats every 1 second.
   4. get_chats returns is_typing = true/false.
   5. chat.js shows typing animation in chat history and main chat.
===================================================== */

function handleTypingInput() {
    if (currentChatUserId === null) {
        return;
    }

    const messageText = $("#messageInput").val().trim();

    /*
        If input is empty, clear typing status immediately.
    */
    if (messageText === "") {
        clearTypingSignal();
        return;
    }

    sendTypingSignalThrottled();

    /*
        If user stops typing for 3 seconds,
        clear typing status.

        The backend also expires typing after 3 seconds,
        but this makes the UI feel cleaner.
    */
    clearTimeout(typingClearTimer);

    typingClearTimer = setTimeout(function () {
        clearTypingSignal();
    }, 3000);
}

function sendTypingSignalThrottled() {
    if (currentChatUserId === null) {
        return;
    }

    const now = Date.now();

    /*
        Do not send typing AJAX on every keypress.
        Send at most once every 1.5 seconds.
    */
    if (now - lastTypingSentAt < TYPING_SEND_INTERVAL_MS) {
        return;
    }

    lastTypingSentAt = now;

    $.ajax({
        url: "api.php?action=set_typing",
        method: "POST",
        data: {
            user_id: CURRENT_USER_ID,
            receiver_id: currentChatUserId
        },
        dataType: "json"
    });
}

function clearTypingSignal(receiverId = currentChatUserId) {
    if (receiverId === null || receiverId === undefined) {
        return;
    }

    clearTimeout(typingClearTimer);
    typingClearTimer = null;
    lastTypingSentAt = 0;

    $.ajax({
        url: "api.php?action=clear_typing",
        method: "POST",
        data: {
            user_id: CURRENT_USER_ID,
            receiver_id: receiverId
        },
        dataType: "json"
    });
}

function updateMainTypingIndicatorFromChats(chats) {
    if (currentChatUserId === null) {
        hideMainTypingIndicator();
        return;
    }

    const activeChat = chats.find(function (chat) {
        return Number(chat.user_id) === Number(currentChatUserId);
    });

    if (activeChat && activeChat.is_typing) {
        showMainTypingIndicator(activeChat.name);
    } else {
        hideMainTypingIndicator();
    }
}

function showMainTypingIndicator(userName) {
    $("#typingUserName").text(userName);
    $("#typingIndicator").removeClass("is-hidden");
}

function hideMainTypingIndicator() {
    $("#typingIndicator").addClass("is-hidden");
    $("#typingUserName").text("");
}


/* =====================================================
   ATTACHMENT UI
===================================================== */

function updateAttachmentPreview() {
    if (selectedAttachmentFile === null) {
        clearAttachment();
        return;
    }

    $("#attachmentFileName").text(selectedAttachmentFile.name);
    $("#attachmentPreview").removeClass("is-hidden");
    $("#attachmentBtn").addClass("has-file");
}

function clearAttachment() {
    selectedAttachmentFile = null;

    $("#attachmentInput").val("");
    $("#attachmentFileName").text("");
    $("#attachmentPreview").addClass("is-hidden");
    $("#attachmentBtn").removeClass("has-file");
}


/* =====================================================
   SCROLL HELPERS
===================================================== */

function isMessageAreaNearBottom() {
    const messageArea = $("#messageArea");

    if (messageArea.length === 0) {
        return true;
    }

    const element = messageArea[0];

    const distanceFromBottom =
        element.scrollHeight - element.scrollTop - element.clientHeight;

    /*
        If user is within 120px of the bottom,
        we treat them as already reading latest messages.
    */
    return distanceFromBottom < 120;
}

function smoothScrollToBottom() {
    const messageArea = $("#messageArea");

    if (messageArea.length > 0) {
        messageArea.stop().animate(
            { scrollTop: messageArea[0].scrollHeight },
            280
        );
    }
}


/* =====================================================
   SMALL UTILITY FUNCTIONS
===================================================== */

function arraysAreEqual(a, b) {
    if (a.length !== b.length) {
        return false;
    }

    for (let i = 0; i < a.length; i++) {
        if (String(a[i]) !== String(b[i])) {
            return false;
        }
    }

    return true;
}

function getFirstLetter(name) {
    if (!name) {
        return "?";
    }

    return String(name).trim().charAt(0).toUpperCase();
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