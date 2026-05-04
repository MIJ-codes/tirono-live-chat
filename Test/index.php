<?php

require_once __DIR__ . "/config.php";

$currentUserId = getCurrentUserId($USERS);
$currentUserName = $USERS[$currentUserId]["name"];

?>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>AJAX Live Chat Prototype</title>

    <link rel="stylesheet" href="assets/css/style.css">

    <script src="https://ajax.googleapis.com/ajax/libs/jquery/3.7.1/jquery.min.js"></script>

    <script>
        const CURRENT_USER_ID = <?php echo json_encode($currentUserId); ?>;
        const CURRENT_USER_NAME = <?php echo json_encode($currentUserName); ?>;
    </script>
</head>

<body>

<div class="app">

    <!-- Column 1: black sidebar -->
    <aside class="black-sidebar">
        <button class="icon-btn" id="homeBtn" title="Home">🏠</button>
        <button class="icon-btn" id="chatBtn" title="Chat">💬</button>
    </aside>

    <!-- Home page -->
    <section id="homeSection" class="home-section">
        <h1>Hello, this is Tirono Technologies.</h1>

        <p>
            Current demo user:
            <strong><?php echo safeText($currentUserName); ?></strong>
        </p>

        <p>
            This is a temporary AJAX prototype inside the
            <strong>Test</strong> folder.
        </p>

        <div class="test-box">
            <h3>Test links</h3>

            <p>Open these in two separate windows:</p>

            <a href="index.php?user_id=1" target="_blank">Open as Admin</a>
            <a href="index.php?user_id=2" target="_blank">Open as Garry</a>
        </div>

        <div class="progress-box">
            <h3>Today&apos;s AJAX progress</h3>

            <ul>
                <li>Messages send without page reload.</li>
                <li>Conversation refreshes using AJAX polling.</li>
                <li>Left chat history refreshes using AJAX polling.</li>
                <li>Latest active chat moves to the top.</li>
                <li>Sent, Delivered, and Seen status logic is working.</li>
            </ul>
        </div>
    </section>

    <!-- Chat page -->
    <section id="chatSection" class="chat-section">

        <!-- Column 2: chat history -->
        <aside class="chat-history">
            <div class="history-header">
                <h2>Chats</h2>
                <p>You are: <?php echo safeText($currentUserName); ?></p>
            </div>

            <div id="chatList" class="chat-list">
                <!-- Loaded using AJAX -->
            </div>
        </aside>

        <!-- Column 3: main chat area -->
        <main class="chat-main">
            <header class="chat-header">
                <h2 id="chatUserName">Select a chat</h2>
                <p id="chatInfo">AJAX polling active every 1 second.</p>
            </header>

            <div id="messageArea" class="message-area">
                <div class="empty-chat">Choose a chat from the left side.</div>
            </div>

            <footer class="input-area">
                <input type="text" id="messageInput" placeholder="Type a message...">
                <button id="sendBtn">Send</button>
            </footer>
        </main>

    </section>

</div>

<script src="assets/js/chat.js"></script>

</body>
</html>