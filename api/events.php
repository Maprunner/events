<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    header('Allow: GET');
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$databasePath = getenv('EVENTS_DB_PATH') ?: dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'events/api/events.db';
if (!is_file($databasePath)) {
    error_log('Events database not found: ' . $databasePath);
    http_response_code(500);
    echo json_encode(['error' => 'Events database is unavailable' . $databasePath]);
    exit;
}

try {
    $database = new PDO('sqlite:' . $databasePath);
    $database->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $database->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $database->exec('PRAGMA query_only = ON');

    $statement = $database->query(
        'SELECT Area, Club, Event, Course, Length, Climb, Controls,
                Minutes, Seconds, Date, Scale, "Contour interval",
                Country, Punch, Time, Year, Latitude, Longitude
         FROM events
         ORDER BY Year DESC, Date DESC, Area COLLATE NOCASE'
    );
    echo json_encode(
        $statement->fetchAll(),
        JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR
    );
} catch (Throwable $error) {
    error_log('Could not read events database: ' . $error->getMessage());
    http_response_code(500);
    echo json_encode(['error' => 'Could not read events database']);
}
