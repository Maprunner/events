# events
Simon's orienteering events

## Local development

Install Node.js, PHP with PDO SQLite enabled, and npm dependencies:

```sh
npm ci
```

Run the PHP API and Vite in separate terminals:

```sh
npm run dev:api
npm run dev
```

Open the Vite URL shown in the terminal (normally `http://127.0.0.1:5173`).
Vite proxies `/api/events.php` to the local PHP server.

## Build and deploy with Nginx

Build the static dashboard and copy the generated `dist` directory to
`/var/www/events/dist`. Keep `events.db` at `/var/www/events/events.db`, outside
the web root. Configure Nginx with [nginx.conf](./nginx.conf), adjusting the
PHP-FPM address and paths to match the server, then reload Nginx. The PHP-FPM
user needs read access to the database.

Create or refresh the production build with:

```sh
npm run build
```
