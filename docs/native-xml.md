# Native XML and Schedule Protocol

Recovered from `/Applications/NovoDS Studio.app/Contents/MacOS/NovoDS Studio` (`4.4.1.101`, SHA-256 `81a86e4afae79d9a012f451833f4c904f5cc1997c31c726214c46ec30b08b543`) and verified against a physical NovoDS player.

## Playlist (`index.xml`)

Implemented in `nativePlaylistXml` and `nativePlaylistFiles` (`lib/native-xml.mjs`):

- Root `<NovoDS Version="1.1" Description="..." Playlist_UUID="..." Model_Type="ds200" Interactive="false" Layout_Type="1" Show_ConnOverlay="false" ConnOverlay_Value="false">`.
- Each studio sequence item becomes a full-screen `<Page>` with a single `ContentType="Media"` `<Section>` and `<MediaItem>` (`duration` in seconds, `videoDuration` populated for video items, `pdfPageRange=""` for images).
- Upload order is `index.xml` followed by each unique referenced media file over TCP 20110 (`TCP_UPLOAD`, `TCP_UPLOAD_FILE_COUNT`, `TCP_UPLOAD_DONE`) and AES-256-CFB file transfer on TCP 20117 (`lib/deploy.mjs`).
- AES key derivation uses the player's live `GET_Device_Name` and `GET_Version` BSP string (`ND-G1000-0132`). Readback verifies the playlist appears in `GET_PLAYLISTS;NULL` (including the `[Internal] ` prefix).

## Weekly Schedule (`TCP_SCHEDULE;...`)

Implemented in `nativeScheduleXml`, `nativeSchedulePayload`, and `nativeScheduleMatches` (`lib/native-xml.mjs`) from `AlarmParamsDialog2::accept` (`0x100357130`), `ScheduleUI::genarateXMLE` (`0x100178100`), `ScheduleUI::get_Upload_Content` (`0x10017c110`), and `Device::TCP_uploadSchedule` (`0x10012b640`):

- Recurrence `Type`: `0` one-time, `1` hourly, `2` daily, `3` weekly, `4` monthly. Web studio schedules use `Type="3"`.
- `WeekMask`: 7-bit mask in Monday-first checkbox order (`Mon=1`, `Tue=2`, `Wed=4`, `Thu=8`, `Fri=16`, `Sat=32`, `Sun=64`). Web studio days `0..6` (`Sun..Sat`) map with `1 << ((day + 6) % 7)`.
- `DateTime`: epoch milliseconds (`QDateTime(currentDate, startTime).toMSecsSinceEpoch()`).
- `Duration`: `end - start` in seconds (`hour * 3600 + minute * 60`).
- `StartTime` and `EndTime`: `-1` when no recurrence date-range bounds are enabled.
- Child `<Play Repeat="true"><Item Playlist="..." Duration="-1" Publishid="..."/></Play>`.
- Upload payload format:
  `TCP_SCHEDULE;<AlarmManager .../>[.PLS_FILES.]<?xml version="1.0" encoding="utf-8"?>\n<Playlists><Playlist Name="..."><File Name="index.xml" Size="..."/><File Name="..." Size="..."/></Playlist></Playlists>`
  sent **after** `deployPlaylistSession` for each referenced playlist. Native Studio mode activates through `Device::slot_finishThread` calling `DeviceTCP::tcp_Upload_Schedule` (`0x10009c460`). The legacy `SCHEDULE;` command does not activate schedules on the tested firmware. No activation ACK is returned.
- Verification reads back both `GET_PLAYLISTS;NULL` and `DOWNLOAD_SCHEDULE;NULL`, comparing parsed XML tags and attributes (`nativeScheduleMatches`).

## Publish and play

After playlist upload and listing verification, send `TCP_PLAY;<storedName>`, then verify with `REMOTE_CONTROL;[Current_Playing_Playlist_Name]`. `GET_All` does not include playback status. Firmware can return a repeated `[Internal]` prefix when the stored name includes it.

Live Device 2 verification passed for playlist publish-and-play and weekly schedule publication. Restored the captured `SY2026-2027` schedule (five alarms), all 12 existing playlists, and `[Internal]SY26-27 (19Oct-6Nov)` playback. The existing `test` playlist was preserved.
