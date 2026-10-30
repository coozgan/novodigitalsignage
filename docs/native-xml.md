# Native XML recovery

## Status and safety boundary

Recovery is **partial**. No playlist or schedule serializer is implemented: known element names alone do not establish a playable file. In particular, the web studio's flat media list and recurring weekday schedule cannot safely be mapped to native pages, regions and alarms yet. Do not substitute generic XML or upload the illustrative fragments below.

Investigation on 2026-10-30 was read-only. No media, native settings, device state, or active Hopper target was changed. No device connections or writes were made. The pre-existing Hopper session was reused and left open for other workers.

## Artifact and evidence

- Application: `/Applications/NovoDS Studio.app`, resource `Contents/Resources/appVersion`: `4.4.1.101`.
- Executable: `Contents/MacOS/NovoDS Studio`, x86_64 Mach-O.
- SHA-256: `81a86e4afae79d9a012f451833f4c904f5cc1997c31c726214c46ec30b08b543` (REA target identity).
- Symbol discovery: `ev_72efaf0853f3307985f4a325b3a08a797e2ac6ee90b24c47ea77ea4ad4c4ce6f`.
- `EditPlaylist::saveXML()` at `0x10006a000` and `ScheduleView::doSave(...)` at `0x100383b60`: `ev_2d5251db0caa735dacb15aaf610b1d86f072b2c97832b42a043d5e469dba74e9`.
- `ScheduleView::getXML(QString,QList<Alarm*>*,bool)` at `0x100382a60`: symbol evidence `ev_e793a06121ccac3a685bd5265c71a6adc143393112b88c74c596d92912ca041b`, decompilation `ev_bd4cbbc68c87f9c7757298c6429195a9bcc7b0a63d29c85940722308e5740e5f`.

These are static observations, not observed application execution. The displayed playlist and schedule pseudocode was truncated. Only the visible portions are described here. Qt reference-counting noise and omitted call arguments make field values less certain than literal names. No claim of complete schema recovery is made.

## Playlist observations

The visible beginning of `EditPlaylist::saveXML()` constructs an XML processing instruction with `version="1.0"`, then a `NovoDS` root. Its `Version` attribute is the literal `1.1`.

Root attributes observed:

| Attribute | Observed source |
| --- | --- |
| `Description` | General settings plain-text description |
| `Playlist_UUID` | `Playlist::getPlaylistUUID()` |
| `Model_Type` | `Playlist::getModelType()` |
| `Interactive` | `Playlist::getInteractive()`, `true` or `false` |
| `Layout_Type` | Decimal `Playlist::getPlayListLayoutType()` |
| `Show_ConnOverlay` | Only emitted in the visible enabled-overlay branch |
| `ConnOverlay_Value` | Boolean literal in that same branch |

The serializer creates `Pages` and iterates `Playlist::Pages()` to create `Page` elements. The visible page attributes are `ID`, `FreeDesignerMode`, `SerialNumber`, `Description`, `BackgroundMusic`, `BackgroundMusicUrl`, and `BackgroundMusicSize`. The first-page branch starts writing `BgMusicApplyToAll`. Later page/region/media serialization is outside the inspected visible portion.

Structural fragment only, not a deployable playlist:

```xml
<?xml version="1.0"?>
<NovoDS Version="1.1">
  <Pages>
    <!-- Page metadata and region/media schema remain to be recovered. -->
  </Pages>
</NovoDS>
```

`Global::getPlayListXmlFilePath(QString)` is at `0x100183ce0`, and its no-argument overload is at `0x100183ea0`. These are follow-up targets for establishing the filename contract. The executable contains `index.xml` and `/index.xml` strings, but string presence alone does not establish which generated file is uploaded or the archive layout.

## Schedule observations

`ScheduleView::doSave` obtains `Global::getSchedulePath`, opens a file, calls `ScheduleView::getXML`, and writes the returned text with `QTextStream`.

The visible `getXML` creates:

- XML instruction `version="1.0" encoding="utf-8"`.
- Root `AlarmManager` with `Version="1.0"` and `Name`.
- `DefaultPlaylist` and `PlayDefaultPlaylistWaitTime` attributes.
- An `Alarms` child, containing `Alarm` elements in the normal branch.

A boolean argument selects a branch writing empty `DefaultPlaylist`, wait time `5`, and skipping the visible alarm loop. Its semantic purpose has not been established. The normal branch obtains the default playlist from a combo box and wait time from a spin box, and calls `PlaylistDoc::checkAttechedFiles` (native spelling).

Observed `Alarm` attributes: `ID`, `Description`, `DateTime`, `Playlist`, `Enabled`, `Type`, `Duration`, `Interval_Hourly`, `StartTime`, `EndTime`, `WeekMask`. `DateTime` is fed by `QDateTime::toMSecsSinceEpoch()`. `Enabled` is a `true`/`false` literal. Numeric fields use numeric setters or `QString::number`, but the time units, enum values, weekday ordering and mask representation are not resolved by these observations.

A child `Play` is created with boolean `Repeat`; iteration over additional playlist references follows. The remainder was not visible, so nested reference tag names and final upload-reference document generation are not asserted.

## Local sample search

Read-only inventories found:

- `~/NovoDS.PlayLists`: only `@_overlaymessage_@/@_overlaymessage1_@/@_om_@settings.xml` and `@_overlaymessage_@/singlewire_settings.xml`.
- `~/NovoDS.Schedule`, `~/NovoDS.CustomizedPages`, `~/NovoDS.ZipFolder`, and `~/NovoDS.Cloud`: no files in the searches performed.
- `~/NovoDS`: settings, device database, serial-port settings and logs, not a playlist sample. The device database was not used as playlist evidence.
- `~/Library/Application Support/NovoDS Studio`: Chromium cache/storage files, not native playlist samples.
- Installed `Contents/Resources`: no standalone `.xml`, `.pls`, or `.zip` samples found. Embedded Qt resources were not exhaustively extracted.
- `~/Downloads/NovoDS+Studio_4.4.1.101.zip`: inventory contains only `NovoDS Studio.mpkg` (218390451 bytes), not a directly accessible playlist fixture. Package payloads were not extracted.

The overlay file reads:

```xml
<?xml version='1.0' encoding='UTF-8'?>
<Overlay_Message>
    <Properties Content="" Dimension="3" Duration="-1" Description=""/>
</Overlay_Message>
```

This is an overlay settings document, not evidence for playlist page/media conventions. The bounded searches do not prove there are no samples anywhere on the machine.

## Implementation blockers and next checks

1. Recover the remainder of `EditPlaylist::saveXML` using retained/full evidence, especially region geometry, image/video type values, media filename references and duration units. Trace corresponding readers and default constructors to distinguish mandatory fields from optional ones.
2. Obtain one known-good, single-region image playlist and one video playlist from an existing export or an explicitly authorized isolated native creation. Compare XML and all attached files. Do not modify the user's existing library to produce fixtures.
3. Resolve `Model_Type`, `Layout_Type`, page ID/UUID formats, orientation/resolution representation, and `Global::getPlayListXmlFilePath` naming. Trace native upload packaging rather than assuming ZIP or flat-file semantics.
4. Resolve `Alarm::Type`, `WeekMask`, `StartTime`/`EndTime`/`Duration` units and timezone behavior from setters/readers. The web model uses weekday integers 0..6 and HH:MM, which are not proven equivalent.
5. Recover the complete `Play` children and the separate `Playlists` reference document before constructing a schedule upload payload.
6. Only then add `lib/native-xml.mjs` and `test/native-xml.test.mjs`. Require a golden native fixture, XML escaping/invalid-character tests and rejection of unsupported layouts. An XML parser accepting output proves syntax only, not device compatibility.

## Deployment API follow-up (2026-10-30)

The publish gate remains closed. `/api/deploy` now reads the persistent registry on every request, strictly validates request and ID types, deduplicates targets in selection order, and rejects the entire batch if any target is unknown. A valid saved playlist or schedule returns HTTP 501 with `code: PROTOCOL_UNVERIFIED`, a nontechnical `error`, separate technical `details`, and one `results` entry per unique device (`deviceId`, `status: blocked`, `code`). These are blocked attempts, not transfer or installation success. The route does not import or invoke the upload transport.

A fresh read-only inventory still found only the two overlay settings XML files, not playable fixtures. REA `binary_session` confirmed the existing Hopper session matched the documented executable and reported an active `list_procedures` request. A focused `procedure_pseudo_code` request for `Global::getPlayListXmlFilePath` at `0x100183ce0` failed with `provider_unavailable`, stage `decompilation`, request 37, provider state `unreachable`. The suggested recovery requires closing and reopening the provider. This shared session was not restarted. Neither the native app nor any device was changed. This failure is an investigation blocker, not a filename or packaging result.

Follow-up still requires known-good native playlist/schedule fixtures, complete page/media serialization and file-reference mapping, schedule weekday/time semantics, and independent native ciphertext vectors. No serializer or live publishing is justified by the available evidence.

Regression checks: `node --test test/deploy-api.test.mjs test/deploy.test.mjs` covers both saved item kinds, stale/replaced registry entries, deduplication, malformed inputs, cross-origin requests, unchanged saved state and registry, and fail-fast guards against TCP/UDP connection creation in the blocked API. Transport checks use loopback mocks only, not live devices.

## Validation

No serialization implementation was justified, so no placeholder module, always-throw API or tautological serializer tests were added. Documentation was checked with `git diff --check`. Native import/playback and device acceptance remain **unverified**. Existing tests, if run by the coordinator, do not close the native XML compatibility gap.
