# Native XML and Schedule Protocol

Recovered from `/Applications/NovoDS Studio.app/Contents/MacOS/NovoDS Studio` (`4.4.1.101`, SHA-256 `81a86e4afae79d9a012f451833f4c904f5cc1997c31c726214c46ec30b08b543`) and verified against a physical NovoDS player.

## Playlist (`index.xml`)

Implemented in `nativePlaylistXml` and `nativePlaylistFiles` (`lib/native-xml.mjs`):

- Root `<NovoDS Version="1.1" Description="..." Playlist_UUID="..." Model_Type="ds200" Interactive="false" Layout_Type="1" Show_ConnOverlay="false" ConnOverlay_Value="false">`.
- Each studio sequence item becomes a full-screen `<Page>` with `Row="1" Column="1"` and a single `ContentType="Media"` `<Section>`. Section dimensions are grid units (`Width="1" Height="1"`), not display pixels, as confirmed by `LandscapeTemplates::create_1`. Pixel dimensions produce a blank rendered page on ND-G1000 firmware 4.5.3.1845.
- Orientation and section validity are numeric. A section contains `<Content>`, which nests `<AttachmentFiles>` and `<MediaItem>` (`duration` in seconds, `videoDuration` populated for video items, `pdfPageRange=""` for images). A root-level `<Timeline Looping="true">` maps ordered item durations to page IDs.
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

## Device-side schedule access and removal

The Devices dashboard has an on-demand device schedule viewer, distinct from local Schedules. `GET /api/devices/schedule?deviceId=...` reads `DOWNLOAD_SCHEDULE;NULL`, returns parsed rules and a SHA-256 revision, and never publishes content. Add `&format=xml` to download the original device XML. Dates are shown in browser local time, not an inferred device timezone or active-rule state.

`DELETE /api/devices/schedule` requires `{deviceId, confirmed:true, revision}` and the same-origin guard. It rereads the schedule and rejects a changed revision before sending anything destructive. Native `ScheduleMenuButton` labels `_Delete_Schedule_` as “Remove (Device Side)” (0x1001c0db6/0x1001c0e6c). `ScheduleUI::openFile` branches on this sentinel at 0x1001740ca to `genarateXML` at 0x1001744a0, generating an empty `AlarmManager`/`Alarms` document. Clearing uses this document via `TCP_SCHEDULE`, the existing Studio-mode schedule upload command. It removes schedule rules/default assignment, not playlist files or local studio content. A subsequent download must contain zero alarms and no default playlist before the API reports verified. Missing/malformed readback or retained rules remain unverified (HTTP 207), never success from an ACK alone.

Read-only API and XML download were checked against FRONTOFFICE's `TESTNOW` schedule. Native clear mapping and successful/failed verification paths are covered offline. The existing hardware schedule was not deleted as a test.

The dashboard now shows selectable alarm rows. Add zero-based `entryIndex` to the confirmed, revision-checked DELETE request to remove one entry. Only that Alarm's original XML span is removed before reupload, preserving all other entries, attributes and the default playlist assignment, even when alarm IDs are duplicated. Readback must match the entire expected document, not just the missing entry, to report verified. Omit `entryIndex` only for the legacy whole-schedule clear API. Single-entry hardware deletion has not been exercised against the user's live schedule.

## Publish and play

After playlist upload and listing verification, send `TCP_PLAY;<bareName>` without the listing's storage prefix, then verify with `REMOTE_CONTROL;[Current_Playing_Playlist_Name]`. `GET_All` does not include playback status. Playback-name readback proves the selection only, not visible rendering. Live screenshots are required to verify the rendered content.

Live Device 2 verification passed for playlist publish-and-play and weekly schedule publication. Restored the captured `SY2026-2027` schedule (five alarms), all 12 existing playlists, and `[Internal]SY26-27 (19Oct-6Nov)` playback. The existing `test` playlist was preserved.

Subsequent rendering repair: redeployed `test` on FRONTOFFICE (`192.168.80.100`) with grid-unit sections. Hardware TCP captures now show moving particles from its video instead of a blank page. Three sequential screenshot API requests returned HTTP 200 with distinct JPEG SHA-256 values (`5ac9681e…`, `8a9ab7ca…`, `c9a44326…`). Screenshot capture tries direct TCP first, without UDP start/stop, because triggering the push service can return the old school slide. Callback frames are drained but never returned as fresh captures. If both pull attempts fail, the API returns an error rather than a potentially stale callback. Pull payloads must have complete JPEG start/end markers. Captured video frames have a green cast compared with the native Quick Look source thumbnail, so color fidelity is not established by these checks.

The existing `SY2026-2027` device schedule can supersede manual `test` playback. A later school slide was confirmed against `[Current_Playing_Playlist_Name]` reporting `SY26-27 (19Oct-6Nov)`, then manual `TCP_PLAY;test` restored the video. The schedule was not disabled or replaced. Repeated identical screenshots of a stationary slide alone do not establish caching.
