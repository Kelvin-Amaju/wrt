<?php
header('Content-Type: application/json; charset=utf-8');

function qaorbitStoreDir(): string
{
    $dir = __DIR__ . '/data';
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }
    return $dir;
}

function qaorbitPassFile(): string
{
    return qaorbitStoreDir() . '/qaorbit-passes.json';
}

function qaorbitNotificationFile(): string
{
    return qaorbitStoreDir() . '/qaorbit-notifications.json';
}

function qaorbitNormalizeIp(?string $ip): string
{
    if ($ip === null || $ip === '') {
        return 'unknown';
    }

    $clean = trim($ip);
    if (str_contains($clean, ',')) {
        $parts = explode(',', $clean);
        $clean = trim($parts[0]);
    }

    return $clean ?: 'unknown';
}

function qaorbitClientIp(): string
{
    $keys = [
        'HTTP_CF_CONNECTING_IP',
        'HTTP_X_FORWARDED_FOR',
        'HTTP_X_REAL_IP',
        'REMOTE_ADDR',
    ];

    foreach ($keys as $key) {
        if (!empty($_SERVER[$key])) {
            return qaorbitNormalizeIp($_SERVER[$key]);
        }
    }

    return 'unknown';
}

function qaorbitLoadJson(string $filePath, array $fallback = []): array
{
    if (!file_exists($filePath)) {
        return $fallback;
    }

    $json = @file_get_contents($filePath);
    if ($json === false || trim($json) === '') {
        return $fallback;
    }

    $decoded = json_decode($json, true);
    return is_array($decoded) ? $decoded : $fallback;
}

function qaorbitWriteJson(string $filePath, array $data): void
{
    file_put_contents($filePath, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL);
}

function qaorbitCleanupExpired(array $records): array
{
    $now = time();
    $active = [];

    foreach ($records as $record) {
        if (isset($record['expiresAt']) && (int) $record['expiresAt'] > $now) {
            $active[] = $record;
        }
    }

    return $active;
}

function qaorbitFormatPass(string $seed): string
{
    $hex = strtoupper(substr(hash('sha256', $seed), 0, 12));
    $parts = str_split($hex, 4);
    return 'QAO-' . implode('-', $parts);
}

function qaorbitGenerateForIp(string $ip): array
{
    $now = time();
    $seed = $ip . '|' . $now . '|' . bin2hex(random_bytes(8));
    $pass = qaorbitFormatPass($seed);

    return [
        'ip' => qaorbitNormalizeIp($ip),
        'pass' => $pass,
        'createdAt' => $now,
        'expiresAt' => $now + 3600,
    ];
}

function qaorbitPersistPass(array $record): void
{
    $records = qaorbitLoadJson(qaorbitPassFile(), []);
    $records = qaorbitCleanupExpired($records);

    $filtered = [];
    foreach ($records as $item) {
        if (!isset($item['ip'])) {
            continue;
        }
        if ((string) $item['ip'] !== (string) $record['ip']) {
            $filtered[] = $item;
        }
    }

    $filtered[] = $record;
    qaorbitWriteJson(qaorbitPassFile(), $filtered);
}

function qaorbitLoadCurrentPass(string $ip): ?array
{
    $records = qaorbitCleanupExpired(qaorbitLoadJson(qaorbitPassFile(), []));
    foreach ($records as $record) {
        if (isset($record['ip']) && (string) $record['ip'] === (string) $ip) {
            return $record;
        }
    }

    return null;
}

function qaorbitPersistNotification(array $notification): void
{
    $events = qaorbitLoadJson(qaorbitNotificationFile(), []);
    $events[] = $notification;
    qaorbitWriteJson(qaorbitNotificationFile(), $events);
}

function qaorbitRespond(int $status, array $payload): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    exit;
}

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$ip = qaorbitClientIp();

if ($method === 'GET') {
    $requestedIp = qaorbitNormalizeIp($_GET['ip'] ?? $ip);
    $passRecord = qaorbitLoadCurrentPass($requestedIp);

    if ($passRecord === null) {
        $passRecord = qaorbitGenerateForIp($requestedIp);
        qaorbitPersistPass($passRecord);
    }

    qaorbitRespond(200, [
        'ok' => true,
        'ip' => $passRecord['ip'],
        'pass' => $passRecord['pass'],
        'createdAt' => $passRecord['createdAt'],
        'expiresAt' => $passRecord['expiresAt'],
        'expiresInSeconds' => max(0, $passRecord['expiresAt'] - time()),
    ]);
}

if ($method !== 'POST') {
    qaorbitRespond(405, ['ok' => false, 'message' => 'Method not allowed.']);
}

$rawBody = file_get_contents('php://input');
$payload = json_decode($rawBody, true);
if (!is_array($payload)) {
    $payload = [];
}

$submittedIp = qaorbitNormalizeIp((string) ($payload['ip'] ?? $_SERVER['REMOTE_ADDR'] ?? $ip));
$submittedPass = strtoupper(trim((string) ($payload['pass'] ?? '')));
$match = qaorbitLoadCurrentPass($submittedIp);

if ($match === null || (string) $match['pass'] !== $submittedPass) {
    qaorbitRespond(200, [
        'ok' => false,
        'valid' => false,
        'message' => 'Invalid or expired QAorbit pass.',
    ]);
}

$event = [
    'id' => uniqid('req_', true),
    'ip' => $submittedIp,
    'pass' => $submittedPass,
    'requestedAt' => gmdate('c'),
    'expiresAt' => gmdate('c', (int) $match['expiresAt']),
    'event' => 'download-request',
];
qaorbitPersistNotification($event);

qaorbitRespond(200, [
    'ok' => true,
    'valid' => true,
    'ip' => $submittedIp,
    'pass' => $submittedPass,
    'expiresAt' => $match['expiresAt'],
    'message' => 'QAorbit pass verified.',
]);
