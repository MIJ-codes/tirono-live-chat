<?php

require_once __DIR__ . "/config.php";

$currentUserId = getCurrentUserId($USERS);
$action = $_GET["action"] ?? $_POST["action"] ?? "";

/*
    AJAX endpoint:
    api.php?action=get_chats

    Returns the left chat history.
*/
if ($action === "get_chats") {
    $messages = readMessages();
    $chatList = [];

    foreach ($USERS as $userId => $user) {
        if ($userId == $currentUserId) {
            continue;
        }

        $latestMessage = null;
        $unreadCount = 0;

        foreach ($messages as $message) {
            $isConversation =
                ((int) $message["sender_id"] === (int) $currentUserId && (int) $message["receiver_id"] === (int) $userId) ||
                ((int) $message["sender_id"] === (int) $userId && (int) $message["receiver_id"] === (int) $currentUserId);

            if ($isConversation) {
                if ($latestMessage === null || (int) $message["id"] > (int) $latestMessage["id"]) {
                    $latestMessage = $message;
                }
            }

            if (
                (int) $message["sender_id"] === (int) $userId &&
                (int) $message["receiver_id"] === (int) $currentUserId &&
                $message["status"] !== "seen"
            ) {
                $unreadCount++;
            }
        }

        $chatList[] = [
            "user_id" => $userId,
            "name" => $user["name"],
            "avatar" => strtoupper(substr($user["name"], 0, 1)),
            "latest_message" => $latestMessage ? $latestMessage["message_text"] : "No messages yet",
            "latest_time" => $latestMessage ? formatTime($latestMessage["created_at"]) : "",
            "unread" => $unreadCount,
            "sort_id" => $latestMessage ? (int) $latestMessage["id"] : 0
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

/*
    AJAX endpoint:
    api.php?action=get_messages

    Returns messages between current user and selected chat user.
*/
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
            ((int) $message["sender_id"] === (int) $currentUserId && (int) $message["receiver_id"] === (int) $chatUserId) ||
            ((int) $message["sender_id"] === (int) $chatUserId && (int) $message["receiver_id"] === (int) $currentUserId);

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

/*
    AJAX endpoint:
    api.php?action=send_message

    Saves a message with status = sent.
*/
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

    $newMessage["time_label"] = formatTime($newMessage["created_at"]);

    sendJson([
        "success" => true,
        "message" => $newMessage
    ]);
}

/*
    AJAX endpoint:
    api.php?action=mark_delivered

    If this browser belongs to the receiver,
    all incoming sent messages become delivered.
*/
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

/*
    AJAX endpoint:
    api.php?action=mark_seen

    When current user opens a specific chat,
    messages from that selected user become seen.
*/
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

sendJson([
    "success" => false,
    "message" => "Invalid action."
]);