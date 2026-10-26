"""Owner-window recording supervisor. Preparation is not execution approval.

Run a fresh sealed collector directly from the owner's ordinary Windows terminal,
never from a chat-managed execution job. No breakaway flag, service or task is
installed. Status observers do not own the recording process. Nothing restarts.
"""
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import os
import re
import sys
import time

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
PRIVATE = ROOT.parent / '.private'
MODE = 'owner_console_single_member_jobs'
FINALIZATION_SECONDS = 35  # up to12s child cleanup +20s endpoint read + local writes


def stamp(value):
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('explicit_timezone_required')
    return parsed.timestamp()


def utc():
    return datetime.now(timezone.utc).isoformat()


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate_binding(review, auth, seal, *, now, hashes):
    """Pure policy, separate from Windows/process/filesystem adapters."""
    owner = review.get('ownerSupervision', {})
    required = ('ownerReadOnlyCaptureApproved', 'ownerWindowLoggingApproved',
        'phoneConnectedUnlockedOwnerConfirmed', 'installedBuild39OwnerConfirmed',
        'billingRemainsOff', 'bothPlansInactiveOwnerConfirmed',
        'noBillingSettingsChangedSinceSavedShutdownOwnerConfirmed')
    if (not re.fullmatch(r'android39-billing-off-[a-z0-9-]+', review.get('sessionId', ''))
            or auth.get('sessionId') != review['sessionId']
            or owner.get('mode') != MODE or review.get('versionCode') != 39
            or any(auth.get(key) is not True for key in required)
            or owner.get('streamSeconds') != 2100 or owner.get('sessionSeconds') != 2400
            or owner.get('maximumDeviceCommands') != 5
            or owner.get('restarts') != 0 or owner.get('cloudApiRequests') != 0
            or not re.fullmatch(r'SIDELINE_ANDROID39_BILLING_OFF_STABILITY_[0-9]{8}(?:_OWNER)?_APPROVED',
                                owner.get('approvalEnvironmentVariable', ''))):
        raise ValueError('fresh_owner_window_scope_required')
    if (auth.get('reviewSha256') != hashes['review']
            or seal.get('reviewSha256') != hashes['review']
            or owner.get('sourceSha256') != hashes['sources']
            or auth.get('ownerSourceSha256') != hashes['sources']):
        raise ValueError('owner_source_binding_changed')
    approved, deadline = stamp(auth['approvedAtUtc']), stamp(auth['sessionMustEndByUtc'])
    if not (0 <= now-approved <= 150 and deadline-approved == 2400):
        raise ValueError('fresh_full_owner_window_required')
    return deadline


def write_once(path, value):
    if path.exists():
        raise RuntimeError('one_use_record_already_exists')
    pending = path.with_suffix(path.suffix + '.pending')
    with pending.open('x', encoding='utf-8') as handle:
        json.dump(value, handle, indent=2)
        handle.write('\n')
        handle.flush()
        os.fsync(handle.fileno())
    pending.rename(path)


def write_logcat_identity(session, identity):
    if not re.fullmatch(r'android39-billing-off-[a-z0-9-]+', session):
        raise ValueError('bound_fresh_session_required')
    directory = PRIVATE / session
    directory.mkdir(parents=True, exist_ok=True)
    write_once(directory / 'logcat-process-identity.json', identity)


class Files:
    def __init__(self, review_dir, session):
        self.review_dir, self.session = review_dir, session
        self.capture = review_dir / 'execution'
        self.owner = review_dir / 'owner-execution'
        self.private = PRIVATE / session

    def reserve(self):
        if (self.owner.exists() or self.capture.exists()
                or (self.review_dir / 'session-closed.json').exists()):
            raise RuntimeError('closed_or_used_session_cannot_resume')
        self.owner.mkdir()
        self.private.mkdir(parents=True, exist_ok=True)
        write_once(self.owner / 'launch-intent.json', dict(sessionId=self.session,
            at=utc(), launchLimit=1, retries=0, mode=MODE))

    def identity(self, name, identity):
        write_once(self.private / (name + '-process-identity.json'), identity)

    def heartbeat(self, value):
        pending = self.owner / 'supervisor-live.pending'
        pending.write_text(json.dumps(dict(sessionId=self.session, at=utc(), **value)), encoding='utf-8')
        pending.replace(self.owner / 'supervisor-live.json')

    def capture_heartbeat(self):
        path = self.capture / 'capture-live.json'
        return read_json(path) if path.exists() else None

    def capture_result(self):
        path = self.capture / 'capture-result.json'
        return read_json(path) if path.exists() else None

    def stop(self, reason):
        # The same collector stops once; this never starts a replacement.
        if self.capture.exists() and not (self.capture / 'stop-capture.json').exists():
            write_once(self.capture / 'stop-capture.json', dict(at=utc(), reason=reason))

    def result(self, value):
        write_once(self.owner / 'supervisor-result.json', dict(sessionId=self.session, at=utc(), **value))


def supervise(child, files, *, deadline, session, clock=time.time, sleep=time.sleep):
    """Observe the owned child/files only. No tool-session dependency or restart."""
    start = last_write = clock()
    reason = None
    exit_code = None
    stop_requested = False
    try:
        while True:
            now = clock()
            exit_code = child.poll()
            if exit_code is not None:
                break
            if now >= deadline:
                reason = 'absolute_owner_deadline_reached'
                break
            live = files.capture_heartbeat()
            if live is not None:
                if (live.get('sessionId') != session
                        or live.get('appActionsAuthorized') is not False
                        or live.get('billingTestingAuthorized') is not False):
                    reason = 'capture_identity_or_scope_mismatch'
                    break
                age = now-stamp(live['at'])
                closing = live.get('live') is False
                if age < -1 or age > (FINALIZATION_SECONDS if closing else 5):
                    reason = ('collector_finalization_deadline_reached' if closing
                              else 'capture_heartbeat_stale')
                    break
            elif now-start > 90:
                reason = 'capture_startup_deadline_reached'
                break
            if now-last_write >= 1:
                files.heartbeat(dict(live=True, childRunning=True,
                    observerConnectionRequired=False, retries=0))
                last_write = now
            sleep(0.25)
    except KeyboardInterrupt:
        reason = 'owner_requested_stop'
    except Exception:
        reason = 'local_supervision_failed'
    finally:
        try:
            if reason is not None and child.poll() is None:
                files.stop(reason)
                stop_requested = True
                grace = min(deadline, clock()+5)
                while child.poll() is None and clock() < grace:
                    sleep(0.1)
        except Exception:
            reason = 'local_stop_or_poll_failed'
        # Close this child's non-inherited single-member job. Its descendants
        # have separate ownership; no PID lookup or unrelated process is killed.
        try:
            exit_code = child.poll()
        except Exception:
            reason = 'owned_child_exit_read_failed'
        try:
            child.close_owner()
        except Exception:
            reason = 'owned_child_cleanup_failed'
        try:
            capture = files.capture_result()
            if capture is not None and not isinstance(capture, dict):
                raise ValueError('collector_result_object_required')
        except Exception:
            capture = None
            reason = 'collector_result_unreadable'
        complete = (reason is None and exit_code == 0 and capture is not None
                    and capture.get('sessionId') == session
                    and capture.get('transportStabilityPassed') is True)
        result = dict(status='TRANSPORT_STABILITY_PASSED' if complete else 'INTERRUPTED_OR_FAILED',
            childExitCode=exit_code, reason=reason or ('collector_exited_without_completion'
                if capture is None else 'collector_result_not_passed' if not complete else None),
            collectorCompletionPresent=capture is not None,
            transportStabilityPassed=complete,
            appDeliveryObserved=bool(complete and capture.get('appDeliveryObserved')),
            stopRequested=stop_requested, observerConnectionRequired=False,
            automaticRestarts=0, recaptures=0, cloudApiRequests=0, billingChanges=0)
        try:
            files.heartbeat(dict(live=False, childRunning=False, status=result['status']))
        except Exception:
            result.update(status='INTERRUPTED_OR_FAILED', reason='supervisor_retirement_write_failed',
                          transportStabilityPassed=False)
        files.result(result)
    return result


def load_bound_plan(path):
    path = path.resolve(strict=True)
    path.relative_to((ROOT / 'docs').resolve())
    if path.name != 'review.json':
        raise ValueError('exact_fresh_review_required')
    review, auth = read_json(path), read_json(path.parent / 'authorization.json')
    owner = review.get('ownerSupervision', {})
    sources = {}
    for relative in owner.get('sourceSha256', {}):
        source = (ROOT / relative).resolve(strict=True)
        source.relative_to((ROOT / 'scripts/operations').resolve())
        sources[relative] = digest(source)
    for required in ('scripts/operations/coach_ai_recording_owner.py',
                     'scripts/operations/coach_ai_owned_windows_process.py'):
        if required not in sources:
            raise ValueError('owner_source_pins_required')
    collector = (ROOT / owner['collectorPath']).resolve(strict=True)
    collector.relative_to((ROOT / 'scripts/operations').resolve())
    relative_collector = str(collector.relative_to(ROOT)).replace('\\', '/')
    if collector.suffix != '.py' or relative_collector not in sources:
        raise ValueError('sealed_python_collector_required')
    hashes = dict(review=digest(path), sources=sources)
    deadline = validate_binding(review, auth, read_json(path.parent / 'review-seal.json'),
        now=time.time(), hashes=hashes)
    return review, collector, deadline


def main(review_path):
    from coach_ai_owned_windows_process import (OwnedWindowsProcess,
        ensure_owner_outside_job, current_process_identity)
    review, collector, deadline = load_bound_plan(Path(review_path))
    # No escaping a managed job: reject it. Owner opens the ordinary terminal.
    ensure_owner_outside_job()
    files = Files(Path(review_path).resolve().parent, review['sessionId'])
    files.reserve()
    files.identity('supervisor', current_process_identity())
    os.environ[review['ownerSupervision']['approvalEnvironmentVariable']] = 'once'
    print('Recording window started. Keep this window open; chat monitoring is optional.', flush=True)
    try:
        child = OwnedWindowsProcess([sys.executable, '-B', str(collector), 'capture-readonly'],
            pipes=False, cwd=str(ROOT), identity_callback=lambda value: files.identity('collector', value))
    except Exception:
        files.heartbeat(dict(live=False, childRunning=False, status='LAUNCH_STOPPED_NO_RETRY'))
        files.result(dict(status='LAUNCH_STOPPED_NO_RETRY', automaticRestarts=0,
            recaptures=0, childStarted=False, billingChanges=0))
        print('Recording did not start. No second attempt was made.', flush=True)
        return
    result = supervise(child, files, deadline=deadline, session=review['sessionId'])
    print('Recording complete.' if result['transportStabilityPassed']
          else 'Recording stopped without a successful stability result.', flush=True)
    print('Billing remains unchanged. You can report this result in the chat.', flush=True)


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] != 'owner-window':
        raise SystemExit('Fresh reviewed owner-window plan required; no capture started.')
    try:
        main(sys.argv[2])
    except Exception:
        raise SystemExit('Owner-window preflight stopped; no retry or fallback was made.')
