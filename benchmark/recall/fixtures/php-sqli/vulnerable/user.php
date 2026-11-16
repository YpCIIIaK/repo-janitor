<?php
$id = $_GET['id'];
$rows = $db->query("SELECT * FROM users WHERE id = $id");
