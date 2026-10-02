# Sentinel CCTV Security Command Center

A self-contained, local-first CCTV dashboard that runs directly in a modern browser. No build step or third-party runtime is required. Its interface adapts to desktop, tablet, mobile and TV remotes. The app uses plain browser JavaScript rather than the earlier React/TypeScript blueprint because this workspace has no Node.js toolchain; this keeps the deliverable immediately runnable and testable without a dependency install.

## Run

Open `index.html` in a current Chromium-based browser. For camera streaming and more reliable IndexedDB behavior, serve this folder from a trusted HTTPS origin or localhost. For example, if Python is installed, run `python -m http.server 8000` in this directory and open `http://localhost:8000`.

Configure a go2rtc base URL under **Settings → Media gateway**. The application sends an SDP offer to the gateway's `/api/webrtc?src=<stream-key>` endpoint. Configure go2rtc and its reverse proxy for browser-origin access, HTTPS, and the required ICE/TURN path. The browser cannot scan LAN devices on its own; optional nearby ONVIF discovery uses the loopback helper described below.

## Adding an IP camera (Tapo, Yoosee, V380, etc.)

Sentinel uses go2rtc for camera video. For easier setup it can discover ONVIF-compatible devices on the local LAN, but discovery does not automatically configure a stream. Other camera types and cameras that do not advertise ONVIF must be added manually using a documented RTSP source in go2rtc. No single application can connect to every proprietary camera protocol; cloud/P2P-only devices may not support local streaming at all.

### Nearby ONVIF discovery

1. Run the optional helper on a Windows/Linux computer connected to the same LAN as the cameras (normally the go2rtc host). Python 3.10 or newer is required; the helper uses only Python's standard library:

   ```powershell
   py onvif_discovery.py
   ```

   Keep its terminal running while scanning. It listens only on `127.0.0.1:8766` and needs UDP multicast on the local network. If your firewall prompts, allow Python on the trusted **Private** network only.
2. Open Sentinel in a current browser on that same computer, open **Settings → Camera registry → Add camera**, and click **Scan network**. If the list is empty, verify ONVIF is enabled on the camera and that multicast/UDP 3702 is allowed between the computer and camera VLAN.
3. Select a result to prefill its name and IP address. This only adds camera details to Sentinel; it does not retrieve credentials or RTSP paths and does not configure go2rtc. Create and test a named stream in go2rtc, then enter that exact stream name in Sentinel's **Main stream key** field before saving.
4. Stop the helper with Ctrl+C when discovery is finished.

The helper sends ONVIF WS-Discovery multicast only on the local network and returns advertised device addresses. It does not authenticate to cameras, read video, or scan IP ranges. GitHub Pages and other remote browsers cannot scan the viewer's LAN directly; the local helper must be running on the same computer as the browser. Browser private-network permission and network/VLAN multicast policy may also apply.

1. Connect the camera and the computer/server running go2rtc to the same trusted network. In your router, create a DHCP reservation for the camera so its LAN address remains stable.
2. In the camera's official app or manual, check for **RTSP**, **ONVIF**, or **third-party NVR** support. Enable local streaming if offered and create a dedicated local camera account. Cloud/P2P access through the vendor app alone does not guarantee RTSP support.
3. **TP-Link Tapo:** for supported models, open the camera settings in the Tapo app and look for **Advanced Settings → Camera Account** to create local credentials. Common RTSP paths are `/stream1` for the main stream and `/stream2` for a lower-resolution stream, but verify the path and support for your exact model/firmware.
4. **Yoosee/V380:** check the exact model's app/manual for RTSP, ONVIF, or third-party NVR support and its documented URL. Availability is model/firmware dependent; some devices expose only vendor cloud/P2P service. If RTSP is not documented or enabled, do not assume a guessed URL will work.
5. Add the camera's documented RTSP source to the go2rtc configuration, using a distinct stream name for each quality level. For example:

   ```yaml
   streams:
     front_door: rtsp://CAMERA_USER:URL_ENCODED_PASSWORD@192.168.1.50:554/stream1
     front_door_sub: rtsp://CAMERA_USER:URL_ENCODED_PASSWORD@192.168.1.50:554/stream2
   ```

   Replace the example address, credentials, and paths with the values for your camera; the example paths are not universal. Protect the go2rtc config as it contains credentials, and URL-encode reserved characters in the password. Restart/reload go2rtc if required by your deployment, then test both named streams using go2rtc's stream page/API.
6. In Sentinel, open **Settings → Media gateway**, enter the base URL reachable from the browser (for example, the go2rtc host's LAN address and configured port), and save. Under **Camera registry**, choose **Add camera** and enter the exact `front_door` stream name as the main stream key and `front_door_sub` as the optional low-resolution substream key. The names must match go2rtc exactly.
7. Open **Live Cameras** and connect the new tile. Test from each network where it will be used. HTTPS-hosted dashboards need a securely reachable gateway and a working WebRTC ICE/TURN route; an RTSP test on the server alone does not prove the browser can receive WebRTC.

**Security:** Change default camera passwords and keep cameras on a trusted/isolated network. Do not port-forward camera RTSP (commonly TCP 554) or expose an unauthenticated go2rtc service to the public internet. Prefer a VPN or authenticated HTTPS reverse proxy, and restrict gateway access with firewall and gateway-side authentication/authorization. Sentinel stores only stream names locally, but stream access still needs to be enforced by the gateway.

## Included workflows

- First-run administrator username and four-digit PIN setup; local viewer accounts with role-limited access; inactivity locking; and a bounded best-effort sign-in log.
- Camera registry, nine-tile grid, viewport-visible stream activation, focused stream promotion, and an explicit four-peer default stream budget.
- Optional loopback-only ONVIF WS-Discovery helper for nearby same-LAN device discovery; non-ONVIF devices continue through manual go2rtc stream setup.
- Administrator-only camera registry, settings, analytics, recordings, snapshots, and a layout editor. Tile order and standard/wide/large sizes are saved locally and shared with viewer accounts.
- go2rtc WebRTC signaling, bounded reconnect, status indicators, and teardown when streams are no longer needed.
- Manual event capture plus optional polling of a configured analytics JSON feed.
- IndexedDB-backed analytics cache, JPEG snapshots, and focused-stream MediaRecorder chunks.
- Recording session browser/download, quota estimate, retention cleanup, and storage controls.
- Automatic expiry cleanup for recordings and snapshots, plus a bounded analytics cache.
- Voice alerts, speech mute, picture-in-picture, responsive layouts, D-pad/keyboard navigation, and keyboard shortcuts.
- Optional per-camera restricted rectangles with low-resolution browser-side pixel-change alerts, tone/speech and a configurable trusted alarm-bridge webhook.
- Local viewer subscription expiry countdowns, per-day visible-tab use limits, renewal links, per-viewer suspension messages, and service-wide viewer maintenance mode.
- Per-viewer camera allow-lists: administrators choose which configured camera streams each viewer sees, with stream activation limited to the assigned cameras.
- Optional service-worker caching for the static app shell on HTTPS/localhost; camera media and analytics still require their configured services.

## Important deployment and security limits

- Cameras must already be configured in go2rtc. This browser app does not provision ONVIF devices, expose PTZ controls, run face/plate inference, or replace an NVR. AI events are consumed from the optional normalized JSON feed or entered locally.
- Nearby discovery only identifies devices that answer ONVIF WS-Discovery multicast. It is not universal camera support, does not discover cloud/P2P-only devices, does not scan IP ranges, and does not configure streams. The optional Python helper must run on the same computer as the browser and must be stopped when not in use.
- Local account roles are a user-interface restriction only, not a security boundary. Anyone with developer-tools or browser-storage access can alter accounts or data. Use server-side authentication and gateway authorization for real access control.
- Account PINs are stored as salted SHA-256 digests in `localStorage`; PINs themselves are not persisted. SHA-256 is fast and four-digit PINs can be guessed offline. Use this only for a trusted kiosk/browser profile, not to protect sensitive surveillance access.
- The sign-in log is local, bounded, editable, and not tamper-proof. It is for convenience and troubleshooting, not compliance or authoritative audit.
- Camera records contain go2rtc stream names, never camera passwords. Do not put credentials in gateway URLs.
- IndexedDB is best-effort browser storage and can be evicted. This app is not an evidentiary NVR and does not guarantee continuous recording, tamper resistance, or durable retention.
- A four-peer budget is conservative by default; actual safe decoder capacity varies by Android TV hardware, browser and codec. Nine camera tiles do not imply nine live hardware decoders.
- Restricted-area monitoring is best-effort frame-difference motion detection, not person/vehicle detection or an AI perimeter alarm. It only evaluates streams active in this dashboard while the page is visible; sleeping browsers, closed tabs, stream outages, camera movement, lighting changes, and browser canvas security restrictions can prevent or confuse detection. Tune sensitivity and test each camera. Do not rely on it as a life-safety or security system.
- Alarm tone and speech come from the dashboard device. Audio is not sent into a camera speaker. To drive a camera speaker or siren, configure a trusted compatible alarm bridge/webhook and hardware; the browser POST requires the bridge to permit CORS and may be blocked by network policy. A successful browser request is not proof the physical alarm sounded.
- Subscription dates, local daily usage counters, maintenance mode, and viewer enable/disable flags are browser-local UI controls, not enforceable billing/access controls. Viewers can alter or clear local data, and different devices do not share these settings. Usage is counted only while the page is visible and the viewer is locally signed in; limits reset at local midnight and cannot prevent bypass by changing the system clock or browser storage. Use a backend for identities, payment verification, synchronized invitations, server-side expiry enforcement, trusted audit trails, and immediate remote suspension.
- Camera assignments are also browser-local interface filtering, not gateway-level authorization. A viewer with direct access to the go2rtc gateway could bypass the dashboard and request any stream. For real camera isolation, enforce per-user stream permissions at an authenticated backend/gateway and keep stream keys private.
- The generated viewer link is only the dashboard URL with the viewer username prefilled. It does not create or synchronize an account, include a PIN, or grant access on another device. Create/configure the account on the destination browser or use a backend identity service; share credentials through a separate secure channel.
- Renewal/payment links are provided by the administrator. A payment does not automatically renew a local subscription: the administrator must update the viewer's subscription, unless a future trusted billing backend automates that operation. Only configure payment links from a trusted HTTPS provider.
- A configured alarm webhook receives camera/zone identifiers and event timestamps. Use a trusted HTTPS endpoint that accepts this exact JSON payload, validates its own authorization/network controls, and does not expose a general-purpose unauthenticated command interface.
- Face, access-control, and plate data are sensitive. Configure lawful collection, retention, access control, and audit practices at the upstream analytics service.
- Browser and go2rtc versions differ. Validate signaling, autoplay, codec, ICE, PiP, and MediaRecorder behavior on the deployed devices and gateway version.

## Browser data

Application data is local to the current browser profile. Resetting browser data can remove local accounts and all locally stored recordings, snapshots, and cached events. Use the Settings retention controls before clearing data. The service worker caches only the static application shell, never camera streams or analytics responses. No cloud synchronization, LAN scanning, or automatic camera credential discovery is included. Older single-PIN profiles are migrated to an `admin` username using the existing PIN digest.

## Accounts and layout

On first launch, create an administrator username and PIN, then confirm the PIN. Sign in with that username and PIN on later visits. Add multiple cameras from the camera registry, then create or edit a viewer in **Settings → Viewer access & subscriptions** and check only the camera streams they may see. A new viewer starts with no cameras assigned until selected; their grid, camera selection shortcuts, PiP, and automatic stream connections are restricted to their assigned cameras. Legacy local viewer accounts without an explicit assignment retain access to configured cameras until you save their camera selection. Viewers can switch grid/focus mode, use PiP, mute voice alerts, and sign out. They cannot change system settings, camera setup/layout, analytics, snapshots, or recordings. Administrators can open **Arrange tiles** on the camera view to move cameras up/down and cycle each tile through standard, wide, and large sizes. These preferences are stored with the local camera registry.

The admin Settings page also shows the latest local sign-in attempts. It does not record PINs and is not tamper-proof. Administrators can set a viewer's subscription duration in days, daily visible-tab allowance in hours, renewal/payment URL, allowed cameras, enabled state, and maintenance message. Use 0 for no subscription expiry or unlimited daily use. Service-wide maintenance mode blocks local viewer sessions but leaves administrators available. Changes apply only to this browser profile.

To create a restricted area, configure the gateway, open **Settings → Restricted areas & alarms**, connect a camera in the live view, choose **Draw area** on the camera tile (or choose a camera from Settings), wait for its image, and drag around the region. For a TV remote, focus the drawing surface, press Enter, use the arrow keys to place the first and opposite corners, then press Enter to save; press Escape to cancel. Enable restricted-zone monitoring and test audio on the dashboard device. Frame changes are sampled at low resolution, require two changed samples, and are throttled to one alert per area per 30 seconds. Lower sensitivity values detect smaller changes and can create more false alarms. Motion events are stored in the local analytics cache. For an external alarm, configure a trusted HTTPS bridge URL; test its CORS and physical output separately.

The admin Settings page also shows the latest local sign-in attempts. It does not record PINs and is not tamper-proof. Administrators can reset local accounts from Settings while signed in; this resets all accounts and starts administrator setup again, but leaves camera and recording data intact. The sign-in screen deliberately has no account-reset control. If the admin PIN is forgotten, the trusted browser-profile owner must clear the app's local account storage; do not expose developer tools or storage controls to viewers.
