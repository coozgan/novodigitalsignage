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
# Fresh deployment only. Keep this name unchanged for later upgrades.
export COMPOSE_PROJECT_NAME=novods-studio
docker compose up -d --build
docker compose ps
```

For repeatable commands, save `COMPOSE_PROJECT_NAME=novods-studio` and your chosen `NOVODS_PORT` in a `.env` file beside `compose.yaml`. **On an existing installation, keep its current project name instead.** Compose prefixes the data volume with that name. Changing the project name or moving to a differently named folder without setting it can attach a new empty volume, making existing data appear missing.

Find the existing project and volume before updating:

```sh
docker ps --format '{{.Names}}\t{{.Label "com.docker.compose.project"}}\t{{.Ports}}'
docker inspect YOUR_CONTAINER_NAME --format '{{json .Mounts}}'
```

The current local installation uses project `novods-shipping-check` and web port `3100`. To update **that installation**, use `NOVODS_PORT=3100 docker compose -p novods-shipping-check up -d --build --wait`. Do not change it to the fresh-deployment name above.

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

## Upgrade procedure and acceptance checks

1. Confirm the existing Compose project name, web port and `/data` volume. Use those same settings for every command below.
2. Back up `/data` with the stop/export/start procedure above. Check that the archive command succeeded and the archive lists `studio.json`, uploaded media and `devices.json` if present. Do not restore over a populated volume.
3. Update the source, then rebuild and wait for health:

   ```sh
   docker compose config --quiet
   docker compose up -d --build --wait
   docker compose ps
   docker compose logs --tail=100
   ```

4. Open the UI at the configured port and refresh it. Check that existing library assets, playlists, schedules and device IPs remain. `GET /api/studio` and container health verify the web app and storage readability, **not device reachability or playback**.
5. From the running container, check control connectivity separately for each registered IP, replacing the example IP with the target device:

   ```sh
   docker compose exec -T novods-studio node -e 'const s=require("node:net").connect(20110,"192.168.80.100");s.setTimeout(3000);s.on("connect",()=>{console.log("Control port reachable");s.end()});s.on("error",e=>{console.error(e.code);process.exitCode=1});s.on("timeout",()=>{console.error("Control port timed out");s.destroy();process.exitCode=1})'
   ```

   `ECONNREFUSED` means the control connection was rejected, not that Docker storage is broken or the entire player is necessarily offline. Check the IP, player service and firewall. A timeout can indicate routing, firewall drops or an offline player. A successful TCP connection is only a preliminary check. Next read device status and schedule in the UI, and test a screenshot. Devices can become unavailable independently, so test each one.
6. Publishing replaces the device's schedule. Before a controlled playback test, download the current device schedule XML and record its playlists and current playback. A backup file is not itself a supported UI restore workflow. Confirm how to restore the original schedule before replacing it.
7. For an authorized test, publish a short future schedule, refresh **device schedule**, and compare its date, start, end and duration against the saved selection. At the start, verify the active playlist and screen output. Upload success or matching schedule XML alone does not prove playback. Do not report untested players as working.
8. Restore the intended schedule after testing and read it back. For deletion, require verified readback. An attempted deletion or failed readback is not proof that the device schedule was removed.

### Scheduling and timezones

- The app now saves the browser's IANA timezone with each schedule and converts wall time explicitly. **Do not use a container `TZ` setting as a substitute for this fix.** At UTC+8, 14:59 must encode as 06:59 UTC, not 14:59 UTC. The two-minute example 14:59–15:01 must retain a 120-second duration.
- Existing local schedules without a timezone remain stored but must be **edited and saved before publishing**. Check the timezone shown in the editor. Already-published incorrect rules are not automatically corrected by rebuilding Docker. Republish them after checking the intended time.
- Verify the browser/host clock and the player's clock and timezone agree with the intended location. The device viewer renders timestamps in browser local time and cannot establish the player's timezone.
- Choose **Weekly** for selected weekdays or **Specific date (one-time)** for a calendar date. Both currently require start and end on the same day. One-time native serialization and HTTP persistence are tested, but physical one-time timed playback still requires a controlled hardware acceptance test.
- Weekly playback was observed on Frontoffice during an earlier controlled test. That does not certify every device, every date mode or current network reachability.

## Local validation

```sh
npm test
npm run build
docker compose config --quiet
docker compose up -d --build
curl --fail http://localhost:3000/api/studio
docker compose ps
```

The current `npm test` suite includes a production-server test that requires both configured LAN players to be reachable. A device-reachability failure can occur even when unit/API tests and the Docker build pass. Record that blocker rather than treating a healthy container as a successful hardware test.

On a test deployment, upload a small image and create a playlist, then run `docker compose down` followed by `docker compose up -d`. Confirm both remain. This verifies the volume without touching a real device. Check actual device connectivity separately from the target host.

For an automated check using a fresh isolated volume (requires Node.js 22 on the host):

```sh
NOVODS_PORT=3100 docker compose -p novods-shipping up -d --build --wait
node scripts/docker-smoke.mjs http://127.0.0.1:3100 novods-shipping
```

The check uploads a test image, saves a playlist, checks cross-origin rejection and media ranges, then recreates the container and verifies persistence. It requires empty studio data and leaves its test data in the isolated volume. Do not point it at a production deployment. Stop other Studio containers first because the device callback ports cannot be shared.
