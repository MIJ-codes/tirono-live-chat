<?php

date_default_timezone_set("Asia/Dhaka");

/*
    Demo users for today's AJAX prototype.

    Later, Codex can replace this array with a MySQL users table.
*/
$USERS = [
    1 => ["id" => 1, "name" => "Admin"],
    2 => ["id" => 2, "name" => "Garry"],
    3 => ["id" => 3, "name" => "Test"],
    4 => ["id" => 4, "name" => "Dr. Samir"]
];

define("MESSAGE_DATA_FILE", __DIR__ . "/data/messages.json");
define("TYPING_DATA_FILE", __DIR__ . "/data/typing.json");

function ensureMessageDataFile() {
    $dataDir = dirname(MESSAGE_DATA_FILE);

    if (!is_dir($dataDir)) {
        mkdir($dataDir, 0777, true);
    }

    if (!file_exists(MESSAGE_DATA_FILE)) {
        file_put_contents(MESSAGE_DATA_FILE, "[]");
    }
}

function ensureTypingDataFile() {
    $dataDir = dirname(TYPING_DATA_FILE);

    if (!is_dir($dataDir)) {
        mkdir($dataDir, 0777, true);
    }

    if (!file_exists(TYPING_DATA_FILE)) {
        file_put_contents(TYPING_DATA_FILE, "[]");
    }
}

function readTypingStatuses() {
    ensureTypingDataFile();

    $fp = fopen(TYPING_DATA_FILE, "r");

    if (!$fp) {
        return [];
    }

    flock($fp, LOCK_SH);

    $json = stream_get_contents($fp);
    $typingStatuses = json_decode($json, true);

    flock($fp, LOCK_UN);
    fclose($fp);

    return is_array($typingStatuses) ? $typingStatuses : [];
}

function updateTypingStatusesLocked($callback) {
    ensureTypingDataFile();

    $fp = fopen(TYPING_DATA_FILE, "c+");

    if (!$fp) {
        return null;
    }

    flock($fp, LOCK_EX);

    rewind($fp);
    $json = stream_get_contents($fp);
    $typingStatuses = json_decode($json, true);

    if (!is_array($typingStatuses)) {
        $typingStatuses = [];
    }

    $changed = false;

    $result = $callback($typingStatuses, $changed);

    if ($changed) {
        ftruncate($fp, 0);
        rewind($fp);

        fwrite(
            $fp,
            json_encode(array_values($typingStatuses), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)
        );

        fflush($fp);
    }

    flock($fp, LOCK_UN);
    fclose($fp);

    return $result;
}

function isTypingActive($typingStatuses, $senderId, $receiverId) {
    $now = time();

    foreach ($typingStatuses as $typing) {
        if (
            isset($typing["sender_id"], $typing["receiver_id"], $typing["updated_at"]) &&
            (int) $typing["sender_id"] === (int) $senderId &&
            (int) $typing["receiver_id"] === (int) $receiverId
        ) {
            $updatedAt = strtotime($typing["updated_at"]);

            if ($updatedAt === false) {
                return false;
            }

            /*
                If the last typing signal is within 3 seconds,
                we consider that user still typing.

                This is a temporary live-state check.
                It is not saved as a real chat message.
            */
            return ($now - $updatedAt) <= 3;
        }
    }

    return false;
}

function clearTypingPair($senderId, $receiverId) {
    return updateTypingStatusesLocked(function (&$typingStatuses, &$changed) use ($senderId, $receiverId) {
        $beforeCount = count($typingStatuses);

        $typingStatuses = array_filter($typingStatuses, function ($typing) use ($senderId, $receiverId) {
            return !(
                (int) $typing["sender_id"] === (int) $senderId &&
                (int) $typing["receiver_id"] === (int) $receiverId
            );
        });

        $typingStatuses = array_values($typingStatuses);

        if (count($typingStatuses) !== $beforeCount) {
            $changed = true;
        }

        return true;
    });
}

function getCurrentUserId($users) {
    $userId = 1;

    if (isset($_GET["user_id"])) {
        $userId = (int) $_GET["user_id"];
    }

    if (isset($_POST["user_id"])) {
        $userId = (int) $_POST["user_id"];
    }

    if (!isset($users[$userId])) {
        $userId = 1;
    }

    return $userId;
}

function sendJson($data) {
    header("Content-Type: application/json");
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function safeText($text) {
    return htmlspecialchars($text ?? "", ENT_QUOTES, "UTF-8");
}

function formatTime($datetime) {
    return date("h:i A", strtotime($datetime));
}

/*
    Read messages safely.

    This is still JSON storage, not final database storage.
    But it is safe enough for today's AJAX prototype.
*/
function readMessages() {
    ensureMessageDataFile();

    $fp = fopen(MESSAGE_DATA_FILE, "r");

    if (!$fp) {
        return [];
    }

    flock($fp, LOCK_SH);

    $json = stream_get_contents($fp);
    $messages = json_decode($json, true);

    flock($fp, LOCK_UN);
    fclose($fp);

    return is_array($messages) ? $messages : [];
}

/*
    Locked update function.

    This prevents the disappearing-message problem.

    Problem before:
    send_message, mark_delivered, and mark_seen were all writing
    to messages.json at the same time.

    Result:
    One AJAX request could overwrite another request.

    This function locks the file before editing it.
*/
function updateMessagesLocked($callback) {
    ensureMessageDataFile();

    $fp = fopen(MESSAGE_DATA_FILE, "c+");

    if (!$fp) {
        return null;
    }

    flock($fp, LOCK_EX);

    rewind($fp);
    $json = stream_get_contents($fp);
    $messages = json_decode($json, true);

    if (!is_array($messages)) {
        $messages = [];
    }

    $changed = false;

    $result = $callback($messages, $changed);

    if ($changed) {
        ftruncate($fp, 0);
        rewind($fp);

        fwrite(
            $fp,
            json_encode(array_values($messages), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)
        );

        fflush($fp);
    }

    flock($fp, LOCK_UN);
    fclose($fp);

    return $result;
}

function getNextMessageId($messages) {
    $maxId = 0;

    foreach ($messages as $message) {
        if ((int) $message["id"] > $maxId) {
            $maxId = (int) $message["id"];
        }
    }

    return $maxId + 1;
}

ensureMessageDataFile();
ensureTypingDataFile();