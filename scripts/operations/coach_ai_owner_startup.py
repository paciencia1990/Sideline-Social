"""Diagnostic successor entry. No operation runs on import or without fresh scope.

Writes a stdlib-only bootstrap marker before importing operation modules. The
future sealed launcher supplies an independent owner-startup directory. Closed
launchers, authorizations, native ownership and supervisor sources stay unchanged.
"""
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import importlib
import json
import os
import sys
import time

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
ENTRY_RELATIVE = 'scripts/operations/coach_ai_owner_startup.py'
DIAGNOSTIC_RELATIVE = 'scripts/operations/coach_ai_startup_diagnostics.py'


def utc():
    return datetime.now(timezone.utc).isoformat()


def exclusive(path, value):
    with path.open('x', encoding='utf-8') as handle:
        json.dump(value, handle, indent=2)
        handle.write('\n')
        handle.flush()
        os.fsync(handle.fileno())


def diagnostic_directory(review_arg, directory_arg):
    review = Path(review_arg).resolve()
    directory = Path(directory_arg).resolve()
    review.relative_to((ROOT/'docs').resolve())
    if (review.name != 'review.json' or directory.name != 'owner-startup'
            or directory.parent != review.parent):
        raise ValueError('startup_diagnostic_binding_required')
    return review, directory


def verify_launcher(directory):
    path = directory/'launcher-entry.json'
    if not path.exists():
        raise RuntimeError('launcher_marker_missing')
    marker = json.loads(path.read_text(encoding='utf-8-sig'))
    if marker != dict(stage='launcher_entry', status='entered', attemptLimit=1):
        raise RuntimeError('launcher_marker_invalid')


def load_plan(path, owner, journal, clock=time.time):
    def checked_path():
        actual = path.resolve(strict=True)
        actual.relative_to((ROOT/'docs').resolve())
        if actual.name != 'review.json':
            raise ValueError('exact_fresh_review_required')
        return actual
    path = journal.phase('review_path', checked_path)
    review = journal.phase('review_read', owner.read_json, path)
    auth = journal.phase('authorization_read', owner.read_json, path.parent/'authorization.json')

    def sources_and_collector():
        scope = review.get('ownerSupervision', {})
        startup = scope.get('startupDiagnostics', {})
        if (startup.get('mode') != 'safe_startup_v1'
                or startup.get('entryPath') != ENTRY_RELATIVE
                or startup.get('directoryName') != 'owner-startup'):
            raise ValueError('startup_diagnostic_binding_required')
        if ((path.parent/'session-closed.json').exists()
                or (path.parent/'owner-execution').exists()
                or (path.parent/'execution').exists()):
            raise RuntimeError('closed_or_used_session_cannot_resume')
        hashes = {}
        for relative in scope.get('sourceSha256', {}):
            source = (ROOT/relative).resolve(strict=True)
            try:
                source.relative_to((ROOT/'scripts/operations').resolve())
            except ValueError:
                raise ValueError('required_source_outside_operations') from None
            hashes[relative] = owner.digest(source)
        required = (ENTRY_RELATIVE, DIAGNOSTIC_RELATIVE,
            'scripts/operations/coach_ai_recording_owner.py',
            'scripts/operations/coach_ai_owned_windows_process.py')
        if any(relative not in hashes for relative in required):
            raise ValueError('startup_diagnostic_source_pins_required')
        collector = (ROOT/scope['collectorPath']).resolve(strict=True)
        collector.relative_to((ROOT/'scripts/operations').resolve())
        relative = str(collector.relative_to(ROOT)).replace('\\','/')
        if collector.suffix != '.py' or relative not in hashes:
            raise ValueError('sealed_python_collector_required')
        return hashes, collector

    hashes, collector = journal.phase('source_validation', sources_and_collector)
    seal = journal.phase('seal_read', owner.read_json, path.parent/'review-seal.json')
    deadline = journal.phase('review_binding', lambda: owner.validate_binding(review, auth, seal,
        now=clock(), hashes=dict(review=owner.digest(path), sources=hashes)))
    return review, collector, deadline


def run_owner(path, journal, diagnostics, *, importer=importlib.import_module,
              plan_loader=load_plan):
    def modules():
        return importer('coach_ai_recording_owner'), importer('coach_ai_owned_windows_process')
    owner, native_module = journal.phase('owner_import', modules)
    review, collector, deadline = plan_loader(path, owner, journal)
    backend = journal.phase('native_api_load', lambda: native_module.WindowsProcessApi())
    traced = diagnostics.TracingApi(backend, journal)
    journal.phase('owner_job_guard', native_module.ensure_owner_outside_job, api=traced)
    def reserve():
        files = owner.Files(path.parent, review['sessionId'])
        files.reserve()
        return files
    files = journal.phase('output_reservation', reserve)
    journal.phase('supervisor_identity', lambda: files.identity('supervisor',
        native_module.current_process_identity(api=traced)))
    os.environ[review['ownerSupervision']['approvalEnvironmentVariable']] = 'once'
    print('Startup checks passed. Starting the recorder; keep this window open.', flush=True)
    try:
        child = journal.phase('collector_start', native_module.OwnedWindowsProcess,
            [sys.executable,'-B',str(collector),'capture-readonly'], pipes=False,
            cwd=str(ROOT), api=traced,
            identity_callback=lambda identity: journal.phase('collector_identity',
                files.identity, 'collector', identity))
    except (Exception, KeyboardInterrupt):
        # Preserve the original latched failure. These independent terminal
        # receipts are attempted once; never create/restart another process.
        try:
            files.heartbeat(dict(live=False, childRunning=False, status='LAUNCH_STOPPED_NO_RETRY'))
        except Exception:
            pass
        try:
            files.result(dict(status='LAUNCH_STOPPED_NO_RETRY', childStarted=False,
                automaticRestarts=0, recaptures=0, billingChanges=0))
        except Exception:
            pass
        raise
    watch_started = False
    def watch():
        nonlocal watch_started
        watch_started = True
        return owner.supervise(child, files, deadline=deadline, session=review['sessionId'])
    try:
        result = journal.phase('recording_watch', watch)
    finally:
        # A journal failure before invoking the already-tested supervisor must
        # still close this exact owned child. Do not depend on interpreter exit.
        if not watch_started:
            try:
                child.close_owner()
            except Exception:
                # close_owner attempts each owned handle. Preserve the in-flight
                # diagnostic failure instead of replacing it with cleanup text.
                pass
    if result.get('transportStabilityPassed') is not True:
        reason = result.get('reason')
        if reason not in diagnostics.KNOWN_CODES:
            reason = 'collector_result_not_passed'
        journal.fail('recording_watch', RuntimeError(reason))
    return result


def emergency(directory, stage, exc):
    # This stdlib-only path also works if the diagnostic module cannot import.
    kind = type(exc).__name__
    if kind not in ('ImportError','ModuleNotFoundError','SyntaxError','IndentationError',
                    'PermissionError','FileNotFoundError','FileExistsError',
                    'AttributeError','TypeError','RuntimeError'):
        kind = 'OtherException'
    exclusive(directory/'bootstrap-failure.json', dict(stage=stage,
        reason='bootstrap_or_diagnostic_import_failed', exceptionClass=kind,
        at=utc(), rawExceptionTextSaved=False, tracebacksSaved=False))


def readable_failure(failure):
    reason = failure.get('reason') if failure else None
    messages = {
        'fresh_full_owner_window_required': 'The approval window expired or its timing does not match.',
        'guardian_requires_owner_outside_job': 'This window is inside another managed process.',
        'owner_source_binding_changed': 'The prepared files do not match the approved review.',
        'closed_or_used_session_cannot_resume': 'This session is closed or already attempted.',
        'required_file_missing': 'A required prepared file or approval is missing.',
        'invalid_json': 'A prepared input file cannot be read as valid JSON.',
        'access_denied': 'Windows denied access to a required local file or operation.',
        'module_import_failed': 'A required local program module could not load.',
        'source_syntax_error': 'A local program module could not be parsed.',
    }
    detail = messages.get(reason, 'The check stopped during startup or recording.')
    stage = failure.get('stage','unknown') if failure else 'unknown'
    labels = {
        'python_entry':'loading startup diagnostics', 'launcher_marker':'checking the prepared launcher',
        'owner_import':'loading the recording program', 'review_path':'locating the review',
        'review_read':'reading the review', 'authorization_read':'reading approval',
        'source_validation':'checking prepared files', 'seal_read':'reading the review seal',
        'review_binding':'checking approval and timing', 'native_api_load':'loading Windows process support',
        'owner_job_guard':'checking the recording window', 'output_reservation':'reserving local output',
        'supervisor_identity':'saving window ownership', 'collector_identity':'saving recorder ownership',
        'collector_start':'starting the recorder', 'native_create_job':'setting up process ownership',
        'native_stdio':'preparing recording output', 'native_create_suspended':'creating the recorder',
        'native_job_check':'checking Windows process ownership', 'native_job_assign':'assigning process ownership',
        'native_birth_read':'reading process identity', 'native_resume':'starting the owned process',
        'native_status':'reading process status', 'native_wait':'waiting for process cleanup',
        'native_terminate':'stopping the owned process', 'native_close':'closing process ownership',
        'recording_watch':'monitoring the recording',
    }
    return (detail + ' Stopped while ' + labels.get(stage,'checking startup')
            + '. Details were saved automatically. Do not reopen the file.')


def entry(review_arg, directory_arg, *, importer=importlib.import_module,
          runner=run_owner, output=print):
    try:
        path, directory = diagnostic_directory(review_arg, directory_arg)
        directory.mkdir(parents=True, exist_ok=True)
        exclusive(directory/'bootstrap-entry.json', dict(stage='python_bootstrap_entry',
            status='entered', at=utc(), attemptLimit=1))
    except Exception:
        output('Startup stopped: the diagnostic location is invalid, used or unwritable. Do not reopen.')
        return 64
    try:
        diagnostics = importer('coach_ai_startup_diagnostics')
    except (Exception, KeyboardInterrupt, SystemExit) as exc:
        try:
            emergency(directory, 'diagnostic_module_import', exc)
        except Exception:
            pass
        output('Startup stopped: the diagnostic module could not load. No recording started. Do not reopen.')
        return 65
    try:
        journal_error = diagnostics.StartupJournalError
        if not isinstance(journal_error, type) or not issubclass(journal_error, Exception):
            raise TypeError('invalid_diagnostic_error_type')
        journal = diagnostics.Journal(directory)
        if any(not callable(getattr(journal, name, None))
               for name in ('python_entry','phase','fail','finish')):
            raise TypeError('invalid_diagnostic_recorder')
    except (Exception, KeyboardInterrupt, SystemExit) as exc:
        try:
            emergency(directory, 'diagnostic_journal_init', exc)
        except Exception:
            pass
        output('Startup stopped: the diagnostic recorder could not initialize. No recording started. Do not reopen.')
        return 66
    final_attempted = False
    try:
        journal.python_entry()
        journal.phase('launcher_marker', verify_launcher, directory)
        result = runner(path, journal, diagnostics, importer=importer)
        complete = (result.get('transportStabilityPassed') is True
                    and journal.first_failure is None)
        final_attempted = True
        final = journal.finish('recording_complete' if complete else 'stopped')
        if complete and final['status'] == 'recording_complete' and final['firstFailure'] is None:
            output('Recording complete. The saved result is ready for review; billing is unchanged.')
            return 0
        output(readable_failure(journal.first_failure))
        return 21
    except journal_error:
        # A failed receipt write is a stop. Do not try that write again or allow
        # an unrecorded launch. Existing process ownership performs its cleanup.
        output('Startup diagnostics could not be saved. The check stopped. Do not reopen the file.')
        return 22
    except (Exception, KeyboardInterrupt, SystemExit) as exc:
        try:
            journal.fail(journal.current_stage or 'python_entry', exc)
            if not final_attempted:
                final_attempted = True
                journal.finish('startup_failed')
        except Exception:
            output('The check stopped and its final diagnostic could not be saved. Do not reopen.')
            return 22
        output(readable_failure(journal.first_failure))
        return 20


if __name__ == '__main__':
    if len(sys.argv) != 4 or sys.argv[1] != 'owner-window':
        raise SystemExit('Prepared diagnostic owner-window command required; no recording started.')
    raise SystemExit(entry(sys.argv[2],sys.argv[3]))
