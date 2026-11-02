# Host NovoDS Studio on another computer

## Requirements

- Docker Engine with the Compose plugin on Linux, or Docker Desktop on Windows/macOS.
- The Docker host must be able to reach the NovoDS devices' private LAN IP addresses.
- Keep this app on a trusted LAN or VPN. It has **no authentication** and can change device settings. Do not port-forward it to the internet.
- Run only one Studio container against a data volume. Storage is JSON files, not a multi-writer database.

## Start on the other computer

Copy this project folder to the other computer, excluding `node_modules`, `.next`, and `.git`. Alternatively, clone the repository once these deployment files have been pushed:

```sh
git clone https://github.com/coozgan/novodigitalsignage.git
cd novodigitalsignage
```

From the project directory:

```sh
docker compose up -d --build
docker compose ps
```

Open **http://HOST_LAN_IP:3000** from a browser, replacing `HOST_LAN_IP` with that computer's LAN IP. The image builds for the host architecture, including x86-64 PCs and ARM64 machines.

If port 3000 is already occupied, set `NOVODS_PORT` in a `.env` file next to `compose.yaml`, for example `NOVODS_PORT=3100`, then use that port in the browser and firewall rules.

Allow inbound TCP 3000 only from trusted clients, and inbound UDP 20116 and TCP 20114 from the device network in the host firewall. Device communication requires outbound TCP 20110 (control), TCP 20117 (uploads), TCP 20114 (screenshots), and UDP 20116, 20112, and 20109 (discovery/capture). Docker publishes the fixed discovery reply and screenshot callback ports. If Docker Desktop or a firewall prevents device callbacks, discovery or screenshots can time out even when the web UI works. Prefer a Linux Docker host for device-network troubleshooting. Do not run another NovoDS listener on host UDP 20116 or TCP 20114.

## Keep existing media, playlists, schedules, and devices

The local `data/` directory is ignored by Git and excluded from the image. A new deployment starts with empty studio data and the app's default device registry. To migrate existing content:

1. Stop the old Studio process before copying its entire `data/` directory to the new computer, next to `compose.yaml`.
2. Before first startup, run these commands in the new project directory. Only import into a fresh volume. Do not overwrite an existing deployment's data.

```sh
docker compose build
docker compose create
# Copy all files, including media and the device registry, into the stopped container's volume.
docker compose cp ./data/. novods-studio:/data/
docker compose run --rm --no-deps --user root novods-studio chown -R node:node /data
docker compose start
```

Check the Media Library, playlists, schedules, and Devices in the UI. Update device IPs if the new host is on a different reachable subnet. Test a read-only device status/screenshot before changing any device settings.

## Storage and maintenance

Docker stores application files in the `studio-data` named volume mounted at `/data`. Container rebuilds and `docker compose down` preserve it. **Do not run `docker compose down -v`**, which deletes the volume and its contents.

```sh
# Logs and health
docker compose logs --tail=100 -f
docker compose ps

# Stop without deleting data
docker compose down

# Rebuild after copying updated source files (or git pull)
docker compose up -d --build
```

To back up, stop the service for a consistent copy, export the volume, then restart:

```sh
docker compose stop
docker compose run --rm --no-deps novods-studio tar -C /data -czf - . > studio-backup.tar.gz
docker compose start
```

Store backups securely since they include uploaded media and device configuration. Extract a backup into a local `data/` directory and use the fresh-volume import procedure above to restore on another host.

## Local validation

```sh
npm test
npm run build
docker compose config --quiet
docker compose up -d --build
curl --fail http://localhost:3000/api/studio
docker compose ps
```

On a test deployment, upload a small image and create a playlist, then run `docker compose down` followed by `docker compose up -d`. Confirm both remain. This verifies the volume without touching a real device. Check actual device connectivity separately from the target host.

For an automated check using a fresh isolated volume (requires Node.js 22 on the host):

```sh
NOVODS_PORT=3100 docker compose -p novods-shipping up -d --build --wait
node scripts/docker-smoke.mjs http://127.0.0.1:3100 novods-shipping
```

The check uploads a test image, saves a playlist, checks cross-origin rejection and media ranges, then recreates the container and verifies persistence. It requires empty studio data and leaves its test data in the isolated volume. Do not point it at a production deployment. Stop other Studio containers first because the device callback ports cannot be shared.
