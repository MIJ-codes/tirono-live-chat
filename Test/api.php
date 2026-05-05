<?php

require_once __DIR__ . "/config.php";

/*
    =====================================================
    AJAX API CONTROLLER
    =====================================================

    This file receives AJAX requests from assets/js/chat.js.

    Current prototype storage:
    - messages are stored in data/messages.json
    - typing status is stored in data/typing.json

    Later database migration:
    - replace readMessages()/updateMessagesLocked() with MySQL queries
    - replace readTypingStatuses()/updateTypingStatusesLocked() with a typing_status table

    Important:
    Keep the JSON response shapes the same so chat.js keeps working.
*/

$currentUserId = getCurrentUserId($USERS);
$action = $_GET["action"] ?? $_POST["action"] ?? "";


/* =====================================================
   ACTION: GET CHATS

   Purpose:
   Returns the left chat history list.

   chat.js uses this for:
   - chat history rows
   - latest message preview
   - unread count
   - typing preview in chat history
   - main chat typing indicator
===================================================== */

if ($action === "get_chats") {
    $messages = readMessages();

    /*
        Typing state is temporary live data.

        Example:
        If Garry is typing to Admin, typing.json stores:
        sender_id = 2, receiver_id = 1, updated_at = time

        When Admin loads chat history, Garry's row gets:
        is_typing = true
    */
    $typingStatuses = readTypingStatuses();

    $chatList = [];

    foreach ($USERS as $userId => $user) {
        if ((int) $userId === (int) $currentUserId) {
            continue;
        }

        $latestMessage = null;
        $unreadCount = 0;

        foreach ($messages as $message) {
            $isConversation =
                (
                    (int) $message["sender_id"] === (int) $currentUserId &&
                    (int) $message["receiver_id"] === (int) $userId
                ) ||
                (
                    (int) $message["sender_id"] === (int) $userId &&
                    (int) $message["receiver_id"] === (int) $currentUserId
                );

            /*
                Find the newest message between current user and this user.
                This controls latest preview + ordering in chat history.
            */
            if ($isConversation) {
                if ($latestMessage === null || (int) $message["id"] > (int) $latestMessage["id"]) {
                    $latestMessage = $message;
                }
            }

            /*
                Unread count means:
                - message came from the other user
                - message is for current user
                - message is not seen yet
            */
            if (
                (int) $message["sender_id"] === (int) $userId &&
                (int) $message["receiver_id"] === (int) $currentUserId &&
                $message["status"] !== "seen"
            ) {
                $unreadCount++;
            }
        }

        $latestMessageText = "No messages yet";
        $latestTime = "";
        $sortId = 0;

        if ($latestMessage) {
            $latestMessageText = trim($latestMessage["message_text"] ?? "");

            if ($latestMessageText === "") {
                $latestMessageText = "Attachment";
            }

            $latestTime = formatTime($latestMessage["created_at"]);
            $sortId = (int) $latestMessage["id"];
        }

        /*
            Check if this user is typing to the current user.

            Example:
            currentUserId = Admin
            userId        = Garry

            isTypingActive checks if Garry -> Admin was updated
            within the last 3 seconds.
        */
        $isTyping = isTypingActive($typingStatuses, $userId, $currentUserId);

        $chatList[] = [
            "user_id" => (int) $userId,
            "name" => $user["name"],
            "avatar" => strtoupper(substr($user["name"], 0, 1)),
            "latest_message" => $latestMessageText,
            "latest_time" => $latestTime,
            "unread" => $unreadCount,

            /*
                New field for typing indicator.
                chat.js uses this to show:
                - typing... in chat history
                - Garry is typing... above the input area
            */
            "is_typing" => $isTyping,

            /*
                Used only for ordering.
                Newest conversation appears first.
            */
            "sort_id" => $sortId
        ];
    }

    usort($chatList, function ($a, $b) {
        if ($a["sort_id"] === $b["sort_id"]) {
            return strcmp($a["name"], $b["name"]);
        }

        return $b["sort_id"] <=> $a["sort_id"];
    });

    sendJson([
        "success" => true,
        "chats" => $chatList
    ]);
}


/* =====================================================
   ACTION: GET MESSAGES

   Purpose:
   Returns messages between current user and selected chat user.

   Request example:
   api.php?action=get_messages&user_id=1&chat_user_id=2
===================================================== */

if ($action === "get_messages") {
    $chatUserId = isset($_GET["chat_user_id"]) ? (int) $_GET["chat_user_id"] : 0;

    if (!isset($USERS[$chatUserId])) {
        sendJson([
            "success" => false,
            "message" => "Invalid chat user."
        ]);
    }

    $messages = readMessages();
    $conversation = [];

    foreach ($messages as $message) {
        $isConversation =
            (
                (int) $message["sender_id"] === (int) $currentUserId &&
                (int) $message["receiver_id"] === (int) $chatUserId
            ) ||
            (
                (int) $message["sender_id"] === (int) $chatUserId &&
                (int) $message["receiver_id"] === (int) $currentUserId
            );

        if ($isConversation) {
            $message["time_label"] = formatTime($message["created_at"]);
            $conversation[] = $message;
        }
    }

    usort($conversation, function ($a, $b) {
        return (int) $a["id"] <=> (int) $b["id"];
    });

    sendJson([
        "success" => true,
        "messages" => $conversation
    ]);
}


/* =====================================================
   ACTION: SEND MESSAGE

   Purpose:
   Saves a message with status = sent.

   Important:
   After sending, we clear typing status immediately so the
   receiver does not keep seeing "typing...".
===================================================== */

if ($action === "send_message") {
    $receiverId = isset($_POST["receiver_id"]) ? (int) $_POST["receiver_id"] : 0;
    $messageText = trim($_POST["message_text"] ?? "");

    if (!isset($USERS[$receiverId])) {
        sendJson([
            "success" => false,
            "message" => "Invalid receiver."
        ]);
    }

    if ($receiverId === $currentUserId) {
        sendJson([
            "success" => false,
            "message" => "You cannot send a message to yourself."
        ]);
    }

    if ($messageText === "") {
        sendJson([
            "success" => false,
            "message" => "Message cannot be empty."
        ]);
    }

    $newMessage = updateMessagesLocked(function (&$messages, &$changed) use ($currentUserId, $receiverId, $messageText) {
        $newMessage = [
            "id" => getNextMessageId($messages),
            "sender_id" => $currentUserId,
            "receiver_id" => $receiverId,
            "message_text" => $messageText,
            "status" => "sent",
            "created_at" => date("Y-m-d H:i:s"),
            "delivered_at" => null,
            "seen_at" => null
        ];

        $messages[] = $newMessage;
        $changed = true;

        return $newMessage;
    });

    /*
        Clear typing after the message is sent.
        This is also called from chat.js, but doing it here makes
        the backend state correct even if frontend misses the request.
    */
    clearTypingPair($currentUserId, $receiverId);

    $newMessage["time_label"] = formatTime($newMessage["created_at"]);

    sendJson([
        "success" => true,
        "message" => $newMessage
    ]);
}


/* =====================================================
   ACTION: MARK DELIVERED

   Meaning:
   Delivered = receiver browser has fetched/polled the message.
===================================================== */

if ($action === "mark_delivered") {
    $updated = updateMessagesLocked(function (&$messages, &$changed) use ($currentUserId) {
        $updated = 0;

        foreach ($messages as &$message) {
            if (
                (int) $message["receiver_id"] === (int) $currentUserId &&
                $message["status"] === "sent"
            ) {
                $message["status"] = "delivered";
                $message["delivered_at"] = date("Y-m-d H:i:s");
                $updated++;
                $changed = true;
            }
        }

        unset($message);

        return $updated;
    });

    sendJson([
        "success" => true,
        "updated" => $updated
    ]);
}


/* =====================================================
   ACTION: MARK SEEN

   Meaning:
   Seen = receiver opened that specific chat.
===================================================== */

if ($action === "mark_seen") {
    $chatUserId = isset($_POST["chat_user_id"]) ? (int) $_POST["chat_user_id"] : 0;

    if (!isset($USERS[$chatUserId])) {
        sendJson([
            "success" => false,
            "message" => "Invalid chat user."
        ]);
    }

    $updated = updateMessagesLocked(function (&$messages, &$changed) use ($currentUserId, $chatUserId) {
        $updated = 0;

        foreach ($messages as &$message) {
            if (
                (int) $message["sender_id"] === (int) $chatUserId &&
                (int) $message["receiver_id"] === (int) $currentUserId &&
                ($message["status"] === "sent" || $message["status"] === "delivered")
            ) {
                $message["status"] = "seen";
                $message["seen_at"] = date("Y-m-d H:i:s");
                $updated++;
                $changed = true;
            }
        }

        unset($message);

        return $updated;
    });

    sendJson([
        "success" => true,
        "updated" => $updated
    ]);
}


/* =====================================================
   ACTION: SET TYPING

   Purpose:
   Called when the current user types in the message input.

   Example:
   Admin types to Garry.
   sender_id = Admin
   receiver_id = Garry

   This does NOT create a chat message.
   It only updates temporary typing state in typing.json.
===================================================== */

if ($action === "set_typing") {
    $receiverId = isset($_POST["receiver_id"]) ? (int) $_POST["receiver_id"] : 0;

    if (!isset($USERS[$receiverId])) {
        sendJson([
            "success" => false,
            "message" => "Invalid receiver."
        ]);
    }

    if ($receiverId === $currentUserId) {
        sendJson([
            "success" => false,
            "message" => "Cannot type to yourself."
        ]);
    }

    updateTypingStatusesLocked(function (&$typingStatuses, &$changed) use ($currentUserId, $receiverId) {
        $found = false;

        foreach ($typingStatuses as &$typing) {
            if (
                (int) $typing["sender_id"] === (int) $currentUserId &&
                (int) $typing["receiver_id"] === (int) $receiverId
            ) {
                $typing["updated_at"] = date("Y-m-d H:i:s");
                $found = true;
                $changed = true;
                break;
            }
        }

        unset($typing);

        if (!$found) {
            $typingStatuses[] = [
                "sender_id" => $currentUserId,
                "receiver_id" => $receiverId,
                "updated_at" => date("Y-m-d H:i:s")
            ];

            $changed = true;
        }

        return true;
    });

    sendJson([
        "success" => true
    ]);
}


/* =====================================================
   ACTION: CLEAR TYPING

   Purpose:
   Removes typing status immediately.

   Used when:
   - user sends a message
   - user clears input
   - user stops typing for a few seconds

   Even without this action, typing expires after 3 seconds through
   isTypingActive(). This just makes the UI cleaner/faster.
===================================================== */

if ($action === "clear_typing") {
    $receiverId = isset($_POST["receiver_id"]) ? (int) $_POST["receiver_id"] : 0;

    if (!isset($USERS[$receiverId])) {
        sendJson([
            "success" => false,
            "message" => "Invalid receiver."
        ]);
    }

    clearTypingPair($currentUserId, $receiverId);

    sendJson([
        "success" => true
    ]);
}


/* =====================================================
   FALLBACK: INVALID ACTION
===================================================== */

sendJson([
    "success" => false,
    "message" => "Invalid action."
]);
    