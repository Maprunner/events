# events
Simon's orienteering events

## Local development

````sh
npm install 
````

to make sure you have all necessary dependencies installed.

````sh
npm run dev
````
to start the vite development server.

You need to be running a separate server to manage the API calls. At present this is assumed to be XAMPP or similar. In future I guess there should be a way of doing this in node.

You should now be able to access events at http://127.0.0.1:5173/events/

Vite proxies `/api/events.php` to the XAMPP server.

## Build and deploy

```sh
npm run build
```
to run the build.

Sync /dist to the server

The dashboard map uses Leaflet with OpenStreetMap tiles and displays georeferenced events matching the active filters.

Copy api directory to server