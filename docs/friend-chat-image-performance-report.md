# Friend Chat Image Performance Report

## Scope and outcome

This change optimizes new friend-chat image uploads and protected media loading without migrating or recompressing historical media. Direct and group chats keep their existing authorization, moderation, deletion, forwarding, save, viewer, picker-recovery, caption, and upload-cancellation behavior.

No private user media was used. No production data, Firebase resource, EAS build, dependency, or native configuration was changed during this work.

## Root causes

The audit found several independent costs in the previous path:

1. New display images used a single 1600 px / 0.82 encode and thumbnails used a single 512 px / 0.72 encode. An oversized result failed instead of trying bounded lower-quality and smaller-dimension encodes.
2. Each mounted thumbnail component acquired its own short-lived media grant. Rerenders and concurrent consumers had no shared in-flight request or valid-grant reuse.
3. The image cache depended on an expiring authorization URL and `expo-image` memory behavior. It had no stable, account-scoped disk identity, size bound, or LRU policy.
4. Mounted timeline images started loading without FlatList visibility prioritization. Nearby and offscreen media could compete with visible messages.
5. The full-screen viewer correctly avoided loading full images until opened, but it could not show a protected cached thumbnail first or reuse a stable cached display file.
6. A newly sent image was removed from the local draft after finalization and then downloaded again instead of priming the stable cache.
7. Server finalization compared Storage metadata but did not inspect the actual v2 JPEG byte envelope and dimensions.

Chat cards did not intentionally request the full display image before this change, and they still request only thumbnails. Full display media remains viewer-only.

## Measurements

### Method

Before and after measurements used the same deterministic synthetic landscape photo, portrait photo, and text-heavy screenshot on the same Windows desktop process. The proxy used the desktop JPEG codec to compare the old initial profile with v2 initial settings. It is not an Expo ImageManipulator or physical-device benchmark, so it does not prove Android/iOS latency or visual quality.

| Synthetic input | Source bytes | Legacy display | Legacy thumbnail | V2 display | V2 thumbnail | Combined reduction | Legacy processing | V2 processing |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Landscape photo | 1,309,891 | 143,285 | 24,696 | 106,202 | 19,828 | 25.0% | 182 ms | 208 ms |
| Portrait photo | 1,374,062 | 144,606 | 24,570 | 107,176 | 20,015 | 24.8% | 144 ms | 150 ms |
| Text-heavy screenshot | 678,520 | 237,407 | 33,153 | 175,203 | 26,408 | 25.5% | 57 ms | 59 ms |

Across these inputs, processed display-plus-thumbnail bytes fell from 607,717 to 454,832, a 25.2% reduction. The v2 initial encode took slightly longer in this desktop proxy because it resized to different dimensions. Bounded retries add work only when an encoded candidate exceeds its byte limit.

The hard combined per-message cap changes from 3.5 MiB under the legacy profile to 1.117 MiB under v2, a maximum-cap reduction of about 68.1%. Actual savings depend on source detail and codec behavior.

For timeline traffic, the thumbnail hard cap changes from 512 KiB to 120 KiB, up to 76.6% less transfer for a formerly maximum-sized thumbnail. In the synthetic sample, thumbnail bytes fell from 82,419 to 66,251, a 19.6% reduction. Display-image transfer occurs only after the viewer opens; sample display bytes fell 26.0%.

### Runtime diagnostics

Development-only, privacy-safe timings now cover:

- compression
- thumbnail creation
- upload duration
- message finalization
- media-grant acquisition
- cache hit or miss
- thumbnail download
- full-image download
- thumbnail decode-to-visible
- display-image decode-to-visible

Diagnostics emit only a fixed trace name and rounded duration. Cache diagnostics emit only a fixed hit/miss name. They do not log users, conversations, messages, filenames, paths, URLs, tokens, captions, or image content.

Upload, network, time-to-visible, cache-hit, memory, and scrolling measurements require Android and iOS device runs on controlled networks. None are claimed from emulator or desktop proxy data.

## Version 2 image profile

New clients send `mediaProfileVersion: 2`.

| Variant | Initial longest edge | Initial quality | Hard byte limit | Retry schedule |
| --- | ---: | ---: | ---: | --- |
| Display | 1440 px | 0.75 | 1 MiB | 4 quality steps across 3 dimension scales; 12 attempts maximum |
| Thumbnail | 480 px | 0.65 | 120 KiB | 4 quality steps across 3 dimension scales; 12 attempts maximum |

Both variants:

- encode as JPEG with a matching `.jpg` path
- preserve aspect ratio
- never upscale smaller images
- use Expo ImageManipulator to render a new file, correcting encoded orientation and excluding source metadata
- verify actual output bytes and dimensions after every attempt
- delete rejected candidates immediately
- delete the accepted display candidate if thumbnail processing fails
- return an existing localized, recoverable processing error if bounded attempts cannot satisfy the profile

The existing 5 MiB source safety limit is unchanged. Original camera files are never uploaded or retained by this flow.

## Backend validation and compatibility

Missing profile versions normalize to legacy profile 1. Historical messages and installed legacy clients keep their existing 1600 px / 3 MiB display and 512 px / 512 KiB thumbnail limits. They are not reinterpreted as v2.

Profile 2 requires JPEG, a longest edge no greater than 1440/480 px, and the new byte limits. Unknown versions are rejected. Storage Rules require an authenticated owner, active account standing, exact reservation paths, exact reserved bytes, allowed content types, and an unexpired reservation. Direct Storage reads remain denied.

During finalization, Functions verify both Storage objects exist, compare Storage-reported types and bytes with the reservation, download v2 objects, compare actual byte counts, parse JPEG dimensions from the uploaded bytes, and reject malformed or mismatched media. The emulator suite covers valid legacy/v2 uploads, unknown versions, byte limits, wrong content type, a missing object, falsified dimensions, duplicate finalization, authorization, blocking, restriction, and protected forwarding/deletion behavior.

## Loading, cache, and grants

Timeline image messages reserve their stored thumbnail aspect ratio before download, render a branded placeholder, and expose a localized accessible retry state. FlatList viewability prioritizes visible thumbnails and a bounded two-message neighborhood. At most three protected media downloads run concurrently; queued work with no remaining consumer is cancelled.

The cache identity contains authenticated account, conversation, message, media profile, and variant. It is SHA-256 hashed before use as a filename or persisted manifest value. The application cache is bounded to 64 MiB and 128 entries with LRU eviction. Cached bytes are checked against trusted message metadata before use.

Authorization behavior is now:

- disk cache hit: zero grant calls and zero network downloads
- same valid in-memory grant: zero new callable requests
- concurrent cache miss for the same identity: one shared download and one shared grant request
- offscreen item: no grant until it enters the visibility/prefetch window
- viewer: cached thumbnail first; display variant requested only while open

Grant batching was not added. Cache reuse, visibility gating, valid-grant reuse, and in-flight deduplication remove the known repeated requests without increasing the authorization surface. Device diagnostics should be reviewed after rollout; a bounded batch-thumbnail callable should be considered only if measured grant latency still dominates visible loading.

Newly finalized sender images prime both display and thumbnail cache entries from the already processed local files before draft cleanup, avoiding an immediate Firebase redownload.

Protected cache and grant state is cleared on sign-out, account deletion, restricted standing, conversation-access failure, message deletion, moderation removal, and explicit unavailable/retry handling. Cache keys are account-scoped, and active downloads cannot commit after cache generation or authenticated user changes.

## Changed files

### Runtime and UI

- `constants/friendChatImageProfile.ts`
- `services/friendChatImageService.ts`
- `services/friendChatImageCacheService.ts`
- `services/chatService.ts`
- `utils/friendChatImageCacheCore.ts`
- `utils/friendChatImagePickerResumeCore.ts`
- `utils/performanceDiagnostics.ts`
- `components/FriendChatImageMessage.tsx`
- `components/FriendChatImageViewer.tsx`
- `app/(social)/chat/[chatId].tsx`

### Backend and Rules

- `functions/src/friendChatCore.ts`
- `functions/src/friendChat.ts`
- `storage.rules`

### Regression coverage and documentation

- `package.json`
- `scripts/test-friend-chat-core.cjs`
- `scripts/test-friend-chat-functions-emulator.cjs`
- `scripts/test-friend-chat-image-actions.cjs`
- `scripts/test-friend-chat-image-picker-resume.cjs`
- `scripts/test-friend-chat-image-performance.cjs`
- `scripts/test-friend-chat-media-storage-rules.cjs`
- `scripts/test-friend-chat-viewer-deletion-dates.cjs`
- `docs/friend-chat-image-performance-report.md`

## Verification

The following passed locally:

- Functions TypeScript build
- full friend-chat core and viewer/deletion regression suite
- image picker, activity recreation, stale result, and temporary cleanup suite
- image performance/profile/cache contract suite
- image actions, secure Save Photo, forwarding, and localization suite
- message reporting modal suite
- chat composer/keyboard layout suite
- notification regression suite
- local user-state cleanup suite
- friend-chat Functions emulator
- friend-chat Firestore Rules emulator
- protected media Storage Rules emulator
- account-standing emulator
- account-deletion emulator
- root TypeScript check
- ESLint
- `git diff --check`

Emulator denial messages are expected assertions. The account-deletion emulator also reported expected local Secret Manager warnings for unavailable Apple secrets; its tested deletion flow completed successfully.

## Rollout order

1. Deploy Functions with dual legacy/v2 validation.
2. Deploy Storage Rules with dual legacy/v2 upload branches.
3. Run post-deploy callable and Rules smoke checks.
4. Release the v2 client.
5. Monitor fixed development traces during QA and production-safe backend error rates without logging media identifiers.

No Firestore Rules or index deployment is required by this change.

Legacy upload support can be retired after the minimum supported client is known to send v2 and the compatibility period has elapsed. Stop accepting new no-version/profile-1 reservations first, while keeping legacy message hydration, protected reads, forwarding, save, deletion, and moderation support indefinitely for historical media.

## Rollback

Keep the dual-profile Functions and Storage Rules deployed. Roll back the client to the prior upload profile if required; historical v2 messages remain readable because stored message hydration and secure media access understand both profiles. Do not remove v2 Rules or backend parsing while any v2 message exists. No media migration is needed for rollback.

## Release requirements

- Firebase Functions deployment: required before releasing the v2 client
- Storage Rules deployment: required before releasing the v2 client
- Firestore Rules deployment: not required
- Firestore indexes: not required
- Realtime Database Rules: not required
- New JavaScript/native dependency: not required
- Native configuration change: not required
- New client delivery: required to ship the optimization; it may use the project's normal binary or OTA process if policy and the installed native module set permit

No deployment or build was started in this task.

## Remaining physical-device checks

Run the same synthetic landscape, portrait, small-text screenshot, already-small, extreme-aspect, rotated, and corrupt-image procedure on narrow and typical Android/iOS devices. Capture processing, upload, grant, thumbnail-visible, full-visible, and cache-hit traces on controlled Wi-Fi and cellular profiles.

Also verify direct and group timelines with many images, rapid scrolling/reversal, navigation away/back, offline-to-online retry, low-memory relaunch, activity recreation in the picker, a mid-upload cancellation, large text, TalkBack, VoiceOver, Save Photo, Forward, Delete for me/everyone, moderation removal, sign-out/account switch, restriction, and account deletion. Inspect screenshot text readability, skin tones, gradients, rotation, transparency conversion, and memory pressure before production rollout.
